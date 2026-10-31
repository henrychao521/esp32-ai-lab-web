// sim.js — 電路模擬器畫布與執行整合（像 Tinkercad／Wokwi）：拖放元件、拉線、麵包板、平移縮放、復原；
// 執行時同一份 MicroPython 程式在 wasm 裡跑，Pin／PWM／ADC 狀態接到電路模型（circuit.js），元件畫面跟著動。
import { CATALOG, PIN_TABLE, DEVKIT_PINMAP, DEVKIT_PINS, BOARD_ART } from "./catalog.js";
import { solve, BOARDS, PARTS } from "./circuit.js";
import { BREADBOARD, holeAt } from "./breadboard.js";
import { toWokwiDiagram, fromWokwiDiagram } from "./diagram.js";
import { createEngine } from "./engine.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const WIRE_COLORS = ["#d33", "#111", "#2a7", "#27d", "#e90", "#a3c", "#999"];

export function createSimulator(opts) {
  const root = opts.root;                 // 容器（含 viewport、world）
  const onEvent = opts.onEvent || (() => {});
  const onWarnings = opts.onWarnings || (() => {});
  const onStatus = opts.onStatus || (() => {});

  // ---------- 狀態 ----------
  const doc = { board: opts.board || "tqt_pro", parts: {}, wires: [], boardPos: { x: 60, y: 40 }, breadboard: null };   // breadboard: {x,y}|null
  const view = { x: 20, y: 20, z: 1 };
  const ui = {};                           // 互動元件狀態 {partId: {pressed,value,light}}
  let burned = new Set(), lastResult = null, selected = null, nextIds = {};
  const undo = [], redo = [];
  let engine = null, running = false, pinState = {};   // pinState：engine.pins() 的快照 {pin: {mode, level, pull, pwm}}

  // ---------- DOM ----------
  const viewport = root.querySelector(".sim-viewport");
  const world = root.querySelector(".sim-world");
  const partsLayer = world.querySelector(".sim-parts");
  const svg = world.querySelector("svg.sim-wires");
  const pinLayer = svg.querySelector(".pins");
  const wireLayer = svg.querySelector(".wires");
  const tempWire = svg.querySelector(".temp");

  function applyView() { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; }
  function toWorld(cx, cy) { const r = viewport.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; }

  // ---------- 腳位座標 ----------
  function rot(x, y, w, h, deg) {
    if (!deg) return [x, y];
    const cx = w / 2, cy = h / 2, a = deg * Math.PI / 180, dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }
  function pinPos(ref) {
    const [id, pin] = splitRef(ref);
    if (id === "board") return boardPinPos(pin);
    if (id === "bb") { const h = BREADBOARD.holes.find((x) => x.id === pin); return h && doc.breadboard ? [doc.breadboard.x + h.x, doc.breadboard.y + h.y] : null; }
    const p = doc.parts[id]; if (!p) return null;
    const c = CATALOG[p.type]; const t = PIN_TABLE[p.type][pin]; if (!t) return null;
    const [x, y] = rot(t[0], t[1], c.w, c.h, p.rot || 0);
    return [p.x + x, p.y + y];
  }
  function boardPinPos(name) {
    const bp = doc.boardPos;
    if (doc.board === "devkit") { const e = DEVKIT_PINS.find((q) => q[0] === name); return e ? [bp.x + e[1], bp.y + e[2]] : null; }
    const art = BOARD_ART[doc.board]; const e = art.pins.find((q) => q[0] === name); return e ? [bp.x + e[1], bp.y + e[2]] : null;
  }
  const splitRef = (ref) => { const i = ref.indexOf(":"); return [ref.slice(0, i), ref.slice(i + 1)]; };
  /** 板子腳位名 → 電路模型的 ref（board:16／board:GND） */
  function boardRefOf(name) {
    if (doc.board === "devkit") { const m = DEVKIT_PINMAP[name]; return m === null || m === undefined ? null : "board:" + m; }
    const e = BOARD_ART[doc.board].pins.find((q) => q[0] === name); return e ? "board:" + e[3] : null;
  }
  function allPinRefs() {
    const out = [];
    if (doc.board === "devkit") for (const q of DEVKIT_PINS) out.push("board:" + q[0]); else for (const q of BOARD_ART[doc.board].pins) out.push("board:" + q[0]);
    for (const id of Object.keys(doc.parts)) for (const pin of CATALOG[doc.parts[id].type].pins) out.push(id + ":" + pin);
    if (doc.breadboard) for (const h of BREADBOARD.holes) out.push("bb:" + h.id);
    return out;
  }

  // ---------- 繪製 ----------
  const partEls = {};
  function render() {
    // 板子
    let boardEl = partsLayer.querySelector(".sim-board");
    if (!boardEl || boardEl.dataset.kind !== doc.board) { if (boardEl) boardEl.remove(); boardEl = makeBoardEl(); partsLayer.appendChild(boardEl); }
    boardEl.style.left = doc.boardPos.x + "px"; boardEl.style.top = doc.boardPos.y + "px";
    // 麵包板
    let bbEl = partsLayer.querySelector(".sim-bb");
    if (doc.breadboard) {
      if (!bbEl) { bbEl = document.createElement("div"); bbEl.className = "sim-bb sim-item"; bbEl.dataset.id = "bb"; bbEl.innerHTML = `<svg xmlns="${SVGNS}" width="${BREADBOARD.width}" height="${BREADBOARD.height}" viewBox="0 0 ${BREADBOARD.width} ${BREADBOARD.height}">${BREADBOARD.svg}</svg>`; partsLayer.insertBefore(bbEl, partsLayer.firstChild); }
      bbEl.style.left = doc.breadboard.x + "px"; bbEl.style.top = doc.breadboard.y + "px";
    } else if (bbEl) bbEl.remove();
    // 元件
    for (const id of Object.keys(partEls)) if (!doc.parts[id]) { partEls[id].remove(); delete partEls[id]; }
    for (const [id, p] of Object.entries(doc.parts)) {
      let el = partEls[id];
      if (!el) {
        el = document.createElement("div"); el.className = "sim-part sim-item"; el.dataset.id = id;
        const w = document.createElement(CATALOG[p.type].tag); w.id = "el-" + id; el.appendChild(w);
        const lab = document.createElement("div"); lab.className = "sim-label"; el.appendChild(lab);
        partsLayer.appendChild(el); partEls[id] = el;
      }
      el.style.left = p.x + "px"; el.style.top = p.y + "px"; el.style.transform = `rotate(${p.rot || 0}deg)`;
      el.style.width = CATALOG[p.type].w + "px"; el.style.height = CATALOG[p.type].h + "px";
      el.classList.toggle("selected", selected === id);
      const w = el.firstChild; for (const [k, v] of Object.entries(p.attrs || {})) if (w.getAttribute(k) !== String(v)) w.setAttribute(k, v);
      el.querySelector(".sim-label").textContent = id + (p.attrs?.value ? " " + p.attrs.value + "Ω" : "");
    }
    renderPins(); renderWires(); applyState();
  }
  function makeBoardEl() {
    const el = document.createElement("div"); el.className = "sim-board sim-item"; el.dataset.id = "board"; el.dataset.kind = doc.board;
    if (doc.board === "devkit") { const w = document.createElement("wokwi-esp32-devkit-v1"); w.id = "el-board"; el.appendChild(w); el.style.width = "106.6px"; el.style.height = "204.3px"; }
    else {
      const a = BOARD_ART[doc.board]; el.style.width = a.w + "px"; el.style.height = a.h + "px";
      let s = `<svg xmlns="${SVGNS}" width="${a.w}" height="${a.h}" viewBox="0 0 ${a.w} ${a.h}"><rect x="0.5" y="0.5" width="${a.w - 1}" height="${a.h - 1}" rx="8" fill="${a.color}" stroke="#555"/>`;
      s += `<text x="${a.w / 2}" y="${a.screen ? a.screen.y + a.screen.h + 12 : 14}" fill="#aaa" font-size="7" text-anchor="middle" font-family="sans-serif">${a.title}</text>`;
      for (const b of a.buttons) s += `<rect class="bbtn" data-gpio="${b.gpio}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="#333" stroke="#888"/><text x="${b.x + b.w / 2}" y="${b.y + b.h + 8}" fill="#bbb" font-size="6" text-anchor="middle" font-family="sans-serif">${b.label}</text>`;
      if (a.led) s += `<circle class="bled" cx="${a.led.x}" cy="${a.led.y}" r="4" fill="#553" stroke="#776"/>`;
      for (const [name, x, y] of a.pins) {
        const bottomRow = y > a.h - 30; const left = x < a.w / 2;
        s += `<circle cx="${x}" cy="${y}" r="3.2" fill="#111" stroke="#d4af37" stroke-width="1.2"/>`;
        s += bottomRow ? `<text x="${x}" y="${y - 6}" fill="#ddd" font-size="6.5" text-anchor="middle" font-family="sans-serif">${name}</text>`
                       : `<text x="${x + (left ? 6 : -6)}" y="${y + 2.5}" fill="#ddd" font-size="6.5" text-anchor="${left ? "start" : "end"}" font-family="sans-serif">${name}</text>`;
      }
      s += `</svg>`; el.innerHTML = s;
      if (a.screen) { const cv = document.createElement("canvas"); cv.className = "sim-screen"; cv.width = 128; cv.height = 128; cv.style.cssText = `position:absolute;left:${a.screen.x}px;top:${a.screen.y}px;width:${a.screen.w}px;height:${a.screen.h}px;background:#000;image-rendering:pixelated;border-radius:3px`; el.appendChild(cv); }
    }
    return el;
  }
  function renderPins() {
    pinLayer.innerHTML = "";
    for (const ref of allPinRefs()) {
      const p = pinPos(ref); if (!p) continue;
      const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]);
      c.setAttribute("r", ref.startsWith("bb:") ? 3.4 : 4.5); c.setAttribute("class", "pin" + (ref.startsWith("bb:") ? " hole" : "")); c.dataset.ref = ref;
      const bref = ref.startsWith("board:") ? boardRefOf(ref.slice(6)) : null;
      if (ref.startsWith("board:") && bref) { const g = Number(bref.slice(6)); const B = BOARDS[doc.board]; if (!isNaN(g) && B.reserved[g]) c.classList.add("reserved"); }
      pinLayer.appendChild(c);
    }
  }
  function renderWires() {
    wireLayer.innerHTML = "";
    doc.wires.forEach((w, i) => {
      const a = pinPos(w.a), b = pinPos(w.b); if (!a || !b) return;
      const path = document.createElementNS(SVGNS, "path");
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], bend = Math.min(40, Math.hypot(dx, dy) * 0.25);
      const nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1);
      path.setAttribute("d", `M${a[0]},${a[1]} Q${mx + nx * bend},${my + ny * bend} ${b[0]},${b[1]}`);
      path.setAttribute("stroke", w.color); path.setAttribute("class", "wire" + (selected === "wire:" + i ? " selected" : "")); path.dataset.index = i;
      wireLayer.appendChild(path);
    });
  }

  // ---------- 麵包板導通與吸附 ----------
  function breadboardLinks() {
    const links = [];
    if (!doc.breadboard) return links;
    for (const ids of Object.values(BREADBOARD.strips)) for (let i = 1; i < ids.length; i++) links.push(["bb:" + ids[0], "bb:" + ids[i]]);
    for (const [id, p] of Object.entries(doc.parts)) for (const [pin, hole] of Object.entries(p.snaps || {})) links.push([id + ":" + pin, "bb:" + hole]);
    return links;
  }
  function snapPart(id) {
    const p = doc.parts[id]; p.snaps = {};
    if (!doc.breadboard) return;
    for (const pin of CATALOG[p.type].pins) {
      const pos = pinPos(id + ":" + pin); if (!pos) continue;
      const h = holeAt(pos[0] - doc.breadboard.x, pos[1] - doc.breadboard.y, 5);
      if (h) p.snaps[pin] = h.id;
    }
    // 吸附後把元件微移，讓第一個對到的腳正好在孔中心
    const first = Object.keys(p.snaps)[0];
    if (first) { const h = BREADBOARD.holes.find((x) => x.id === p.snaps[first]); const pos = pinPos(id + ":" + first); p.x += doc.breadboard.x + h.x - pos[0]; p.y += doc.breadboard.y + h.y - pos[1]; for (const pin of Object.keys(p.snaps)) { const q = pinPos(id + ":" + pin); const hh = holeAt(q[0] - doc.breadboard.x, q[1] - doc.breadboard.y, 3); if (!hh) delete p.snaps[pin]; else p.snaps[pin] = hh.id; } }
  }

  // ---------- 電路 → 模型 ----------
  function circuitForSolver() {
    const wires = [];
    for (const w of doc.wires) {
      const a = w.a.startsWith("board:") ? boardRefOf(w.a.slice(6)) : w.a, b = w.b.startsWith("board:") ? boardRefOf(w.b.slice(6)) : w.b;
      if (a && b) wires.push([a, b]);
    }
    const parts = {}; for (const [id, p] of Object.entries(doc.parts)) parts[id] = { type: p.type, attrs: p.attrs || {} };
    return { board: doc.board, parts, wires };
  }
  function io() {
    const pins = {}, modes = {}, pulls = {}, pwm = {};
    for (const [p, s] of Object.entries(pinState)) { modes[p] = s.mode; if (s.mode === "out" || s.mode === "pwm") pins[p] = s.level; if (s.pull) pulls[p] = 1; if (s.pwm) pwm[p] = s.pwm; }
    return { pins, modes, pulls, pwm, ui, burned };
  }
  const boardButtons = () => (doc.board === "tqt_pro" ? [0, 47] : doc.board === "tdisplay_s3" ? [0, 14] : [0]);
  function tick() {
    const r = solve(circuitForSolver(), io(), breadboardLinks());
    lastResult = r; burned = new Set(r.burned);
    if (engine) {
      // 電路算出的腳位電位回灌引擎（板載按鍵的腳位由按鍵自己管）
      for (const [g, lv] of Object.entries(r.inputs)) if (!boardButtons().includes(Number(g)) && pinState[g] && pinState[g].mode === "in" && pinState[g].level !== lv) engine.setPin(Number(g), lv);
      for (const [g, raw] of Object.entries(r.adc)) if (pinState[g] && pinState[g].mode === "adc") { const v = raw / 4095 * 3.3; if (Math.abs((pinState[g].analog ?? -1) - v) > 0.002) { pinState[g].analog = v; engine.setAnalog(Number(g), v); } }
    }
    applyState(); onWarnings(r.warnings);
    return r;
  }
  function applyState() {
    const r = lastResult; if (!r) return;
    for (const [id, p] of Object.entries(doc.parts)) {
      const el = partEls[id]?.firstChild; const s = r.parts[id] || {}; if (!el) continue;
      switch (p.type) {
        case "led": el.value = !!s.on; el.brightness = s.burned ? 0 : (s.brightness ?? 1); partEls[id].classList.toggle("burned", !!s.burned); break;
        case "buzzer": el.hasSignal = !!s.on; break;
        case "servo": el.angle = s.angle ?? 90; break;
        case "led-bar-graph": el.values = s.values || []; break;
        case "rgb-led": el.ledRed = s.r || 0; el.ledGreen = s.g || 0; el.ledBlue = s.b || 0; break;
        case "pushbutton": el.pressed = !!ui[id]?.pressed; break;
        case "slide-switch": el.value = ui[id]?.value ? 1 : 0; break;
        case "potentiometer": if (el.value === undefined || Math.abs(el.value / 100 - (ui[id]?.value ?? 0.5)) > 0.02) el.value = (ui[id]?.value ?? 0.5) * 100; break;
        case "photoresistor-sensor": el.ledPower = !!s.powered; break;
      }
    }
    // 板子：板載 LED、按鍵、螢幕
    const boardEl = partsLayer.querySelector(".sim-board"); if (!boardEl || !engine) return;
    const level = (g) => (pinState[g] && (pinState[g].mode === "out" || pinState[g].mode === "pwm") ? pinState[g].level : null);
    if (doc.board === "devkit") { boardEl.firstChild.led1 = level(2) === 1; boardEl.firstChild.ledPower = true; }
    else {
      const a = BOARD_ART[doc.board];
      if (a.led) { const c = boardEl.querySelector(".bled"); const lv = level(a.led.gpio); const on = lv === null ? false : (a.led.inverted ? lv === 0 : lv === 1); c.setAttribute("fill", on ? "#ff3" : "#553"); }
      for (const b of boardEl.querySelectorAll(".bbtn")) b.setAttribute("fill", pressedButtons.has(Number(b.dataset.gpio)) ? "#777" : "#333");
      const cv = boardEl.querySelector(".sim-screen");
      if (cv && engine.capabilities.screen && engine.takeScreenDirty()) cv.getContext("2d").putImageData(new ImageData(engine.screenRGBA(), 128, 128), 0, 0);
    }
  }

  // ---------- 互動 ----------
  let drag = null;   // {kind:"part"|"pan"|"wire"|"board"|"bb", ...}
  const pressedButtons = new Set();
  const pointers = new Map();
  viewport.addEventListener("pointerdown", (ev) => {
    pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pointers.size === 2) { drag = { kind: "pinch", z0: view.z, d0: pinchDist(), c0: pinchCenter(), v0: { ...view } }; return; }
    const t = ev.target;
    const pinEl = t.closest && t.closest("circle.pin");
    if (pinEl) { ev.preventDefault(); viewport.setPointerCapture(ev.pointerId); drag = { kind: "wire", from: pinEl.dataset.ref }; const p = pinPos(drag.from); tempWire.setAttribute("d", `M${p[0]},${p[1]} L${p[0]},${p[1]}`); tempWire.style.display = "block"; return; }
    const wireEl = t.closest && t.closest("path.wire");
    if (wireEl) { select("wire:" + wireEl.dataset.index); return; }
    const item = t.closest && t.closest(".sim-item");
    if (item) {
      const id = item.dataset.id;
      if (id !== "board" && id !== "bb") {
        const p = doc.parts[id], c = CATALOG[p.type];
        if (running && c.interact) { interactStart(id, ev); select(id); return; }   // 執行中：操作元件
        select(id);
      }
      if (ev.target.closest && ev.target.closest(".bbtn")) { const g = Number(ev.target.closest(".bbtn").dataset.gpio); pressedButtons.add(g); if (engine) engine.pressButton(g, true); applyState(); drag = { kind: "bbtn", gpio: g }; viewport.setPointerCapture(ev.pointerId); return; }
      if (running && id !== "board" && id !== "bb") return;
      ev.preventDefault(); viewport.setPointerCapture(ev.pointerId);
      const [wx, wy] = toWorld(ev.clientX, ev.clientY);
      const pos = id === "board" ? doc.boardPos : id === "bb" ? doc.breadboard : doc.parts[id];
      drag = { kind: "item", id, ox: wx - pos.x, oy: wy - pos.y, moved: false };
      return;
    }
    select(null);
    drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
    viewport.setPointerCapture(ev.pointerId);
  });
  viewport.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!drag) return;
    if (drag.kind === "pinch" && pointers.size === 2) {
      const d = pinchDist(), c = pinchCenter(); const z = Math.max(0.3, Math.min(4, drag.z0 * d / drag.d0));
      const r = viewport.getBoundingClientRect(); const wx = (drag.c0[0] - r.left - drag.v0.x) / drag.z0, wy = (drag.c0[1] - r.top - drag.v0.y) / drag.z0;
      view.z = z; view.x = c[0] - r.left - wx * z; view.y = c[1] - r.top - wy * z; applyView(); return;
    }
    if (drag.kind === "pan") { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; applyView(); return; }
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    if (drag.kind === "item") {
      const pos = drag.id === "board" ? doc.boardPos : drag.id === "bb" ? doc.breadboard : doc.parts[drag.id];
      pos.x = Math.round(wx - drag.ox); pos.y = Math.round(wy - drag.oy); drag.moved = true;
      if (drag.id !== "board" && drag.id !== "bb") snapPart(drag.id);
      render(); return;
    }
    if (drag.kind === "wire") { const p = pinPos(drag.from); const near = nearestPin(wx, wy, 10); const q = near ? pinPos(near) : [wx, wy]; tempWire.setAttribute("d", `M${p[0]},${p[1]} L${q[0]},${q[1]}`); return; }
    if (drag.kind === "interact") interactMove(drag, ev);
  });
  const endPointer = (ev) => {
    pointers.delete(ev.pointerId);
    if (!drag) return;
    if (drag.kind === "wire") {
      const [wx, wy] = toWorld(ev.clientX, ev.clientY); const to = nearestPin(wx, wy, 12);
      tempWire.style.display = "none";
      if (to && to !== drag.from) { pushUndo(); doc.wires.push({ a: drag.from, b: to, color: WIRE_COLORS[$("sim-wire-color") ? Number($("sim-wire-color").value) : 0] }); select("wire:" + (doc.wires.length - 1)); render(); tick(); }
    } else if (drag.kind === "item") { if (drag.moved) { pushUndo(true); tick(); } }
    else if (drag.kind === "bbtn") { pressedButtons.delete(drag.gpio); if (engine) engine.pressButton(drag.gpio, false); applyState(); }
    else if (drag.kind === "interact") interactEnd(drag);
    drag = pointers.size === 2 ? drag : null;
  };
  viewport.addEventListener("pointerup", endPointer); viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = viewport.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top; const z = Math.max(0.3, Math.min(4, view.z * (ev.deltaY < 0 ? 1.1 : 0.9))); view.x = mx - (mx - view.x) * z / view.z; view.y = my - (my - view.y) * z / view.z; view.z = z; applyView(); }, { passive: false });
  const pinchDist = () => { const v = [...pointers.values()]; return Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) || 1; };
  const pinchCenter = () => { const v = [...pointers.values()]; return [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2]; };
  function nearestPin(wx, wy, tol) {
    let best = null, bd = tol;
    for (const ref of allPinRefs()) { const p = pinPos(ref); if (!p) continue; const d = Math.hypot(p[0] - wx, p[1] - wy); if (d < bd) { bd = d; best = ref; } }
    return best;
  }

  // 執行中的元件互動
  function interactStart(id, ev) {
    const p = doc.parts[id], kind = CATALOG[p.type].interact;
    ui[id] = ui[id] || {};
    if (kind === "press") { ui[id].pressed = true; drag = { kind: "interact", id, mode: "press" }; viewport.setPointerCapture(ev.pointerId); tick(); }
    else if (kind === "toggle") { ui[id].value = ui[id].value ? 0 : 1; tick(); }
    else if (kind === "knob" || kind === "light") { drag = { kind: "interact", id, mode: kind, sy: ev.clientY, v0: ui[id].value ?? (kind === "light" ? (ui[id].light ?? 0.5) : 0.5) }; viewport.setPointerCapture(ev.pointerId); }
  }
  function interactMove(d, ev) {
    if (d.mode === "knob" || d.mode === "light") { const v = Math.max(0, Math.min(1, d.v0 + (d.sy - ev.clientY) / 150)); if (d.mode === "knob") ui[d.id].value = v; else ui[d.id].light = v; tick(); showHint(d.id, (d.mode === "knob" ? "轉到 " : "光線 ") + Math.round(v * 100) + "%"); }
  }
  function interactEnd(d) { if (d.mode === "press") { ui[d.id].pressed = false; tick(); } hideHint(); }
  function showHint(id, text) { const el = partEls[id]; if (!el) return; el.querySelector(".sim-label").textContent = text; }
  function hideHint() { render(); }

  function select(id) { selected = id; render(); onStatus({ selected: id, part: id && !id.startsWith("wire:") ? doc.parts[id] : null, wire: id && id.startsWith("wire:") ? doc.wires[Number(id.slice(5))] : null }); }

  // ---------- 編輯動作 ----------
  function snapshot() { return JSON.stringify({ board: doc.board, parts: doc.parts, wires: doc.wires, boardPos: doc.boardPos, breadboard: doc.breadboard }); }
  let lastSnap = snapshot();
  function pushUndo(coalesceMove) { const s = snapshot(); if (s === lastSnap) return; undo.push(lastSnap); if (undo.length > 100) undo.shift(); redo.length = 0; lastSnap = s; onStatus({ undo: undo.length, redo: redo.length }); }
  function restore(s) { const d = JSON.parse(s); doc.board = d.board; doc.parts = d.parts; doc.wires = d.wires; doc.boardPos = d.boardPos; doc.breadboard = d.breadboard; lastSnap = s; selected = null; render(); tick(); onStatus({ undo: undo.length, redo: redo.length, board: doc.board }); }
  const api = {
    doc, view, get running() { return running; }, get result() { return lastResult; },
    addPart(type, x, y) {
      pushUndo(); const base = { led: "led", resistor: "r", pushbutton: "btn", "slide-switch": "sw", potentiometer: "pot", "photoresistor-sensor": "ldr", buzzer: "bz", servo: "servo", "led-bar-graph": "bar", "rgb-led": "rgb" }[type] || type;
      nextIds[base] = (nextIds[base] || 0) + 1; let id = base + nextIds[base]; while (doc.parts[id]) { nextIds[base]++; id = base + nextIds[base]; }
      const c = CATALOG[type];
      doc.parts[id] = { type, x: Math.round((x ?? 200) - c.w / 2), y: Math.round((y ?? 200) - c.h / 2), rot: 0, attrs: { ...c.attrs }, snaps: {} };
      snapPart(id); pushUndo(); select(id); tick(); return id;
    },
    addBreadboard() { if (doc.breadboard) return; pushUndo(); doc.breadboard = { x: 40, y: 320 }; pushUndo(); render(); tick(); },
    deleteSelected() {
      if (!selected) return; pushUndo();
      if (selected.startsWith("wire:")) doc.wires.splice(Number(selected.slice(5)), 1);
      else if (selected === "bb") { doc.breadboard = null; doc.wires = doc.wires.filter((w) => !w.a.startsWith("bb:") && !w.b.startsWith("bb:")); }
      else { delete doc.parts[selected]; doc.wires = doc.wires.filter((w) => !w.a.startsWith(selected + ":") && !w.b.startsWith(selected + ":")); }
      selected = null; pushUndo(); render(); tick();
    },
    rotateSelected() { if (!selected || selected.startsWith("wire:") || !doc.parts[selected]) return; pushUndo(); doc.parts[selected].rot = ((doc.parts[selected].rot || 0) + 90) % 360; snapPart(selected); pushUndo(); render(); tick(); },
    setAttr(id, k, v) { if (!doc.parts[id]) return; pushUndo(); doc.parts[id].attrs[k] = v; pushUndo(); render(); tick(); },
    setWireColor(i, color) { if (!doc.wires[i]) return; pushUndo(); doc.wires[i].color = color; pushUndo(); render(); },
    undo() { if (!undo.length) return; redo.push(lastSnap); restore(undo.pop()); },
    redo() { if (!redo.length) return; undo.push(lastSnap); restore(redo.pop()); },
    clear() { pushUndo(); doc.parts = {}; doc.wires = []; doc.breadboard = null; burned = new Set(); pushUndo(); render(); tick(); },
    async setBoard(kind) { if (!BOARDS[kind]) return; pushUndo(); doc.board = kind; doc.wires = doc.wires.filter((w) => !w.a.startsWith("board:") && !w.b.startsWith("board:")); pushUndo(); render(); if (engine) await api.attach(kind); tick(); },
    load(d) { restore(JSON.stringify({ board: d.board || "tqt_pro", parts: d.parts || {}, wires: d.wires || [], boardPos: d.boardPos || { x: 60, y: 40 }, breadboard: d.breadboard ?? null })); burned = new Set(); undo.length = 0; redo.length = 0; },
    save() { return JSON.parse(snapshot()); },
    exportWokwi() { return toWokwiDiagram(api.save()); },
    importWokwi(json) { api.load(fromWokwiDiagram(json)); },
    fit() { const r = viewport.getBoundingClientRect(); let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; const add = (x, y, w, h) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
      add(doc.boardPos.x, doc.boardPos.y, 150, 200); if (doc.breadboard) add(doc.breadboard.x, doc.breadboard.y, BREADBOARD.width, BREADBOARD.height); for (const p of Object.values(doc.parts)) add(p.x, p.y, CATALOG[p.type].w, CATALOG[p.type].h);
      const z = Math.max(0.3, Math.min(2, Math.min((r.width - 40) / (maxX - minX), (r.height - 40) / (maxY - minY)))); view.z = z; view.x = (r.width - (maxX - minX) * z) / 2 - minX * z; view.y = (r.height - (maxY - minY) * z) / 2 - minY * z; applyView(); },
    tick, render, select, get selected() { return selected; },
    resetBurned() { burned = new Set(); tick(); },

    // ---------- 執行（透過可插拔引擎介面 engine.js） ----------
    async attach(kind, engineKind) {
      if (engine) { try { await engine.stop(); } catch (e) {} }
      engine = await createEngine(engineKind || opts.engine || "micropython-wasm", { board: kind || doc.board });
      pinState = engine.pins();
      engine.onPinChange((pin, st) => { pinState[pin] = { ...(pinState[pin] || {}), ...st }; tick(); });
      engine.onConsole((m) => { if (m.t === "done") { running = false; onStatus({ running }); } if (m.t === "start") { running = true; onStatus({ running }); } onEvent(m); });
      tick(); return engine;
    },
    async run(code, name) { if (!engine) await api.attach(); burned = new Set(); const r = await engine.boot(code, name || "main.py"); if (r.ok) { running = true; onStatus({ running }); } return r; },
    async stop() { if (!engine) return true; const ok = await engine.stop(); running = false; onStatus({ running }); return ok; },
    async check(code) { if (!engine) await api.attach(); return engine.check(code); },
    cmd(c) { if (engine) engine.cmd(c); },
    get engine() { return engine; },
    get vb() { return engine && engine._vb; },
  };
  applyView(); render();
  return api;
}
