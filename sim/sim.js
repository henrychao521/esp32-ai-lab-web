// sim.js — 電路模擬器畫布與執行整合（像 Tinkercad／Wokwi）。
// 畫布：拖放元件、腳位拉線（可加轉折點、選色、標籤）、麵包板吸附與導通提示、格線吸附、平移縮放（滾輪／兩指）、多選、對齊、復原重做。
// 執行：透過 engine.js 的共用介面（docs/sim-engine-api.md），腳位事件 → 電路解法（circuit.js）→ 元件畫面與回灌輸入。
import { CATALOG, PIN_TABLE, DEVKIT_PINMAP, DEVKIT_PINS, BOARD_ART } from "./catalog.js";
import { solve, BOARDS, PARTS, DYNAMIC_TYPES, gpioName, vLogic } from "./circuit.js";
import { BREADBOARD, holeAt } from "./breadboard.js";
import { toWokwiDiagram, fromWokwiDiagram } from "./diagram.js";
import { createEngine, engineForBoard } from "./engine.js";
import { attachPart } from "./parts.js";
import { routeWire, routeAll } from "./router.js";

const SVGNS = "http://www.w3.org/2000/svg";
export const WIRE_COLORS = ["#d33", "#111", "#2a7", "#27d", "#e90", "#a3c", "#999", "#fff"];
const GRID = 8;

export function createSimulator(opts) {
  const root = opts.root;
  const onEvent = opts.onEvent || (() => {});
  const onWarnings = opts.onWarnings || (() => {});
  const onStatus = opts.onStatus || (() => {});
  const onHover = opts.onHover || (() => {});

  // ---------- 狀態 ----------
  const doc = { board: opts.board || "tqt_pro", parts: {}, wires: [], boardPos: { x: 60, y: 40 }, breadboard: null };
  const view = { x: 20, y: 20, z: 1 };
  const ui = {};
  let burned = new Set(), lastResult = null, nextIds = {};
  let selection = new Set();       // "partId" | "wire:3" | "board" | "bb"
  const undoStack = [], redoStack = [];
  let engine = null, running = false, pinState = {}, gridSnap = true, shortNets = [];
  let lastEngineKind = opts.engine || "micropython-wasm";   // 使用者為 ESP32 板子選的引擎（UNO 一律用引擎 C）
  let hlWires = new Set();          // 步驟提示：高亮的線
  let cards = null;                 // part_cards.json（說明小卡與腳位說明）
  const partRuntime = {};           // 元件層的執行期狀態（解碼器畫面、燈條顏色、步進角度）
  const attached = {};              // partId → detach()
  let screenDirty = false; const takeDirty = () => { const d = screenDirty; screenDirty = false; return d; };
  const wiringListeners = new Set();

  // ---------- DOM ----------
  const viewport = root.querySelector(".sim-viewport");
  const world = root.querySelector(".sim-world");
  const partsLayer = world.querySelector(".sim-parts");
  const svg = world.querySelector("svg.sim-wires");
  const pinLayer = svg.querySelector(".pins"), wireLayer = svg.querySelector(".wires"), tempWire = svg.querySelector(".temp"), hiLayer = svg.querySelector(".hi");

  function applyView() { world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; onStatus({ view: { ...view } }); }
  function toWorld(cx, cy) { const r = viewport.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; }
  const snap = (v) => (gridSnap ? Math.round(v / GRID) * GRID : Math.round(v));

  // ---------- 腳位 ----------
  function rot(x, y, w, h, deg) { if (!deg) return [x, y]; const cx = w / 2, cy = h / 2, a = deg * Math.PI / 180, dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; }
  const splitRef = (ref) => { const i = ref.indexOf(":"); return [ref.slice(0, i), ref.slice(i + 1)]; };
  function pinPos(ref, near) {
    const [id, pin] = splitRef(ref);
    if (id === "board") return boardPinPos(pin, near);
    if (id === "bb") { const h = BREADBOARD.holes.find((x) => x.id === pin); return h && doc.breadboard ? [doc.breadboard.x + h.x, doc.breadboard.y + h.y] : null; }
    const p = doc.parts[id]; if (!p) return null;
    const c = CATALOG[p.type], t = PIN_TABLE[p.type][pin]; if (!t) return null;
    const [x, y] = rot(t[0], t[1], c.w, c.h, p.rot || 0); return [p.x + x, p.y + y];
  }
  function boardPinPos(name, near) {
    const bp = doc.boardPos; const list = (doc.board === "devkit" ? DEVKIT_PINS : BOARD_ART[doc.board].pins).filter((q) => q[0] === name);
    if (!list.length) return null; let e = list[0];
    const d = (q) => Math.hypot(bp.x + q[1] - near[0], bp.y + q[2] - near[1]);
    if (near && list.length > 1) e = list.reduce((b, q) => (d(q) < d(b) ? q : b), list[0]);   // 同名腳位（T-Display 兩排都有 GND／3V3）挑離線另一端最近的那個
    return [bp.x + e[1], bp.y + e[2]];
  }
  /** 一條線的兩端座標；板子同名腳位會挑離對方最近的 */
  function wireEnds(w) { const a0 = pinPos(w.a); const b = pinPos(w.b, a0); const a = pinPos(w.a, b); return [a, b]; }
  function boardRefOf(name) {
    if (doc.board === "devkit") { const m = DEVKIT_PINMAP[name]; return m === null || m === undefined ? null : "board:" + m; }
    const e = BOARD_ART[doc.board].pins.find((q) => q[0] === name); return e ? "board:" + e[3] : null;
  }
  function boardPinNames() { return doc.board === "devkit" ? DEVKIT_PINS.map((q) => q[0]) : BOARD_ART[doc.board].pins.map((q) => q[0]); }
  function allPinRefs() {
    const out = boardPinNames().map((n) => "board:" + n);
    for (const id of Object.keys(doc.parts)) for (const pin of CATALOG[doc.parts[id].type].pins) out.push(id + ":" + pin);
    if (doc.breadboard) for (const h of BREADBOARD.holes) out.push("bb:" + h.id);
    return out;
  }
  /** 腳位說明（給懸停與屬性面板）：名稱、功能、目前電壓 */
  function pinInfo(ref) {
    const [id, pin] = splitRef(ref);
    const B = BOARDS[doc.board];
    let title = ref, desc = "", gpio = null, reserved = null, volt = nodeVoltage(ref);
    if (id === "board") {
      const bref = boardRefOf(pin); const m = bref ? bref.slice(6) : null; gpio = m !== null && !isNaN(Number(m)) ? Number(m) : null;
      title = pin;
      if (gpio !== null) {
        const bc = cards?.boards?.[doc.board]?.pins?.[gpio];
        const caps = [B.adc.includes(gpio) ? (doc.board === "uno" ? "類比輸入 analogRead" : "ADC") : null, B.input_only.includes(gpio) ? "只能輸入" : (B.pwm ? (B.pwm.includes(gpio) ? "PWM analogWrite" : null) : "PWM"), doc.board === "uno" && gpio === 18 ? "I2C SDA" : null, doc.board === "uno" && gpio === 19 ? "I2C SCL" : null].filter(Boolean);
        desc = doc.board === "uno" ? `${gpioName("uno", gpio)}（腳號 ${gpio}${caps.length ? "；" + caps.join("、") : "；數位輸入／輸出"}）${B.onboard?.[gpio] ? "，" + B.onboard[gpio] : ""}${bc ? "：" + bc.desc : ""}` : `GPIO${gpio}（${caps.join("、")}）${bc ? "：" + bc.desc : ""}`;
        if (B.reserved[gpio]) reserved = B.reserved[gpio];
      } else if (m) desc = cards?.boards?.[doc.board]?.power?.[m] || (doc.board === "uno" ? { "3V3": "3.3 V 電源輸出（最多約 50 mA）", "5V": "5 V 電源（USB 供電）", VIN: "外接電源輸入（7～12 V；用 USB 供電時約 5 V）", GND: "接地（負極）" } : { "3V3": "3.3 V 電源輸出", "5V": "USB 5 V", VIN: "USB 5 V（VIN）", GND: "接地（負極）" })[m] || m;
      else desc = "不可接（" + pin + "）";
    } else if (id === "bb") { title = "麵包板 " + pin; const h = BREADBOARD.holes.find((x) => x.id === pin); desc = h ? (h.strip.startsWith("top") || h.strip.startsWith("bot") ? "電源軌，整列相通" : "同一欄 5 孔相通") : ""; }
    else { const p = doc.parts[id]; title = id + " 的 " + pin; const pc = cards?.parts?.[p.type]?.pins; desc = pc ? (pc[pin] || (p.type === "led-bar-graph" ? pc[pin[0] + "1"] : "") || "") : ""; }
    return { ref, title, desc, gpio, reserved, volt };
  }
  function nodeVoltage(ref) {
    if (!lastResult) return null;
    const [id, pin] = splitRef(ref);
    const r = id === "board" ? boardRefOf(pin) : ref; if (!r) return null;
    const root = lastResult.nets.find(r); const v = lastResult.nodeV[root]; return v === undefined ? null : v;
  }

  // ---------- 繪製 ----------
  const partEls = {};
  function render() {
    let boardEl = partsLayer.querySelector(".sim-board");
    if (!boardEl || boardEl.dataset.kind !== doc.board) { if (boardEl) boardEl.remove(); boardEl = makeBoardEl(); partsLayer.appendChild(boardEl); }
    boardEl.style.left = doc.boardPos.x + "px"; boardEl.style.top = doc.boardPos.y + "px"; boardEl.classList.toggle("selected", selection.has("board"));
    let bbEl = partsLayer.querySelector(".sim-bb");
    if (doc.breadboard) {
      if (!bbEl) { bbEl = document.createElement("div"); bbEl.className = "sim-bb sim-item"; bbEl.dataset.id = "bb"; bbEl.innerHTML = `<svg xmlns="${SVGNS}" width="${BREADBOARD.width}" height="${BREADBOARD.height}" viewBox="0 0 ${BREADBOARD.width} ${BREADBOARD.height}">${BREADBOARD.svg}</svg>`; partsLayer.insertBefore(bbEl, partsLayer.firstChild); }
      bbEl.style.left = doc.breadboard.x + "px"; bbEl.style.top = doc.breadboard.y + "px"; bbEl.classList.toggle("selected", selection.has("bb"));
    } else if (bbEl) bbEl.remove();
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
      el.classList.toggle("selected", selection.has(id));
      // 元件圖的屬性＝目錄預設值 ＋ 這個元件自己的；少了預設（例如步進馬達 size=17）元件會畫成別的尺寸，腳位就對不上接線
      const w = el.firstChild; for (const [k, v] of Object.entries({ ...(CATALOG[p.type].attrs || {}), ...(p.attrs || {}) })) if (w.getAttribute(k) !== String(v)) w.setAttribute(k, v);
      el.querySelector(".sim-label").textContent = p.label || (id + (p.attrs?.value ? " " + (p.type === "capacitor" ? String(p.attrs.value).replace(/u$/, "µ") + "F" : p.attrs.value + "Ω") : ""));   // 電容標 µF，不是 Ω
    }
    renderPins(); renderWires(); applyState(); onStatus({ bounds: bounds() });
  }
  function makeBoardEl() {
    const el = document.createElement("div"); el.className = "sim-board sim-item"; el.dataset.id = "board"; el.dataset.kind = doc.board;
    if (doc.board === "devkit") { const w = document.createElement("wokwi-esp32-devkit-v1"); w.id = "el-board"; el.appendChild(w); el.style.width = "106.6px"; el.style.height = "204.3px"; }
    else {
      const a = BOARD_ART[doc.board]; el.style.width = a.w + "px"; el.style.height = a.h + "px";
      const pcb = a.pcb || { x: 0.5, y: 0.5, w: a.w - 1, h: a.h - 1, rx: 8 };
      let s = `<svg xmlns="${SVGNS}" width="${a.w}" height="${a.h}" viewBox="0 0 ${a.w} ${a.h}"><rect x="${pcb.x}" y="${pcb.y}" width="${pcb.w}" height="${pcb.h}" rx="${pcb.rx ?? 8}" fill="${a.color}" stroke="${a.stroke || "#555"}"/>`;
      if (a.art) s += a.art;   // 板子自己的外觀（UNO：排針座、USB、DC 插座、晶片）
      if (!a.hideTitle) s += `<text x="${a.w / 2}" y="${a.screen ? a.screen.y + a.screen.h + 12 : 14}" fill="#aaa" font-size="7" text-anchor="middle" font-family="sans-serif">${a.title}</text>`;
      for (const b of a.buttons) s += `<rect class="bbtn" data-gpio="${b.gpio}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" fill="#333" stroke="#888"/><text x="${b.x + b.w / 2}" y="${b.y + b.h + 8}" fill="#bbb" font-size="6" text-anchor="middle" font-family="sans-serif">${b.label}</text>`;
      if (a.led) s += `<circle class="bled" cx="${a.led.x}" cy="${a.led.y}" r="4" fill="#553" stroke="#776"/>`;
      for (const [name, x, y, g] of a.pins) {
        const bottomRow = y > a.h - 30 && x > 16 && x < a.w - 16, left = x < a.w / 2;
        s += `<circle cx="${x}" cy="${y}" r="3.2" fill="#111" stroke="#d4af37" stroke-width="1.2"/>`;
        if (a.vlabels && (y < 30 || bottomRow)) {   // 排針間距 9.6 px：字直排，上排往下、下排往上
          const ty = y < 30 ? y + 7 : y - 7, lab = name + (a.pwmMark && a.pwmMark.includes(g) ? "~" : "");
          s += `<text x="${x}" y="${ty}" transform="rotate(${y < 30 ? 90 : -90} ${x} ${ty})" fill="#fff" font-size="5.6" dominant-baseline="middle" font-family="sans-serif">${lab}</text>`; continue;
        }
        s += bottomRow ? `<text x="${x}" y="${y - 6}" fill="#ddd" font-size="6.5" text-anchor="middle" font-family="sans-serif">${name}</text>` : `<text x="${x + (left ? 6 : -6)}" y="${y + 2.5}" fill="#ddd" font-size="6.5" text-anchor="${left ? "start" : "end"}" font-family="sans-serif">${name}</text>`;
      }
      s += `</svg>`; el.innerHTML = s;
      if (a.screen) { const cv = document.createElement("canvas"); cv.className = "sim-screen"; cv.width = a.screen.native ? a.screen.native[0] : 128; cv.height = a.screen.native ? a.screen.native[1] : 128; cv.style.cssText = `position:absolute;left:${a.screen.x}px;top:${a.screen.y}px;width:${a.screen.w}px;height:${a.screen.h}px;background:#000;image-rendering:pixelated;border-radius:3px`; el.appendChild(cv); }
    }
    return el;
  }
  function renderPins() {
    pinLayer.innerHTML = "";
    const B = BOARDS[doc.board];
    for (const ref of allPinRefs()) {
      const p = pinPos(ref); if (!p) continue;
      const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]);
      c.setAttribute("r", ref.startsWith("bb:") ? 3.6 : 5); /* 腳位熱區 5 px（LED 兩腳相距 10 px，再大會重疊） */ c.setAttribute("class", "pin" + (ref.startsWith("bb:") ? " hole" : "")); c.dataset.ref = ref;
      if (ref.startsWith("board:")) { const bref = boardRefOf(ref.slice(6)); const g = bref ? Number(bref.slice(6)) : NaN; if (!bref) c.classList.add("na"); else if (!isNaN(g) && B.reserved[g]) c.classList.add("reserved"); }
      pinLayer.appendChild(c);
    }
  }
  function wirePath(w) {
    const [a, b] = wireEnds(w); if (!a || !b) return null;
    const pts = [a, ...(w.pts || []), b];
    // 沒有轉折點：自動整線開著就畫直線（整線器算出來是直的），關著才畫微彎的曲線
    if (pts.length === 2 && !autoWire) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, bend = Math.min(40, L * 0.25); return `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2 - dy / L * bend},${(a[1] + b[1]) / 2 + dx / L * bend} ${b[0]},${b[1]}`; }
    return "M" + pts.map((p) => p[0] + "," + p[1]).join(" L");
  }
  function renderWires() {
    wireLayer.innerHTML = "";
    const hits = document.createElementNS(SVGNS, "g"); hits.setAttribute("class", "wire-hits"); wireLayer.appendChild(hits);
    doc.wires.forEach((w, i) => { const d = wirePath(w); if (!d) return; const h = document.createElementNS(SVGNS, "path"); h.setAttribute("d", d); h.setAttribute("class", "wire-hit"); h.dataset.index = i; hits.appendChild(h); });
    doc.wires.forEach((w, i) => {
      const d = wirePath(w); if (!d) return;
      const hl = hlWires.has(i);
      const sel = selection.has("wire:" + i), isShort = shortNets.length && [w.a, w.b].some((r) => shortNets.includes(netOf(r)));
      const path = document.createElementNS(SVGNS, "path"); path.setAttribute("d", d); path.setAttribute("stroke", isShort ? "#f00" : w.color);
      path.setAttribute("class", "wire" + (sel ? " selected" : "") + (isShort ? " short" : "") + (hl ? " hl" : "") + (hlWires.size && !hl ? " dim" : "")); path.dataset.index = i; wireLayer.appendChild(path);
      if (w.label) { const m = midpoint(w); const t = document.createElementNS(SVGNS, "text"); t.setAttribute("x", m[0]); t.setAttribute("y", m[1] - 6); t.setAttribute("class", "wire-label"); t.textContent = w.label; wireLayer.appendChild(t); }
      if (sel) for (const [k, pt] of (w.pts || []).entries()) { const h = document.createElementNS(SVGNS, "circle"); h.setAttribute("cx", pt[0]); h.setAttribute("cy", pt[1]); h.setAttribute("r", 5); h.setAttribute("class", "wp"); h.dataset.wire = i; h.dataset.pt = k; wireLayer.appendChild(h); }
    });
  }
  function midpoint(w) { const [a, b] = wireEnds(w); const pts = [a, ...(w.pts || []), b]; const m = pts[Math.floor((pts.length - 1) / 2)], n = pts[Math.ceil((pts.length - 1) / 2)]; return [(m[0] + n[0]) / 2, (m[1] + n[1]) / 2]; }
  function netOf(ref) { if (!lastResult) return null; const [id, pin] = splitRef(ref); const r = id === "board" ? boardRefOf(pin) : ref; return r ? lastResult.nets.find(r) : null; }
  function highlightStrip(holeId) {
    hiLayer.innerHTML = "";
    if (!holeId || !doc.breadboard) return;
    const h = BREADBOARD.holes.find((x) => x.id === holeId); if (!h) return;
    for (const id of BREADBOARD.strips[h.strip] || []) { const q = BREADBOARD.holes.find((x) => x.id === id); const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("cx", doc.breadboard.x + q.x); c.setAttribute("cy", doc.breadboard.y + q.y); c.setAttribute("r", 4.2); c.setAttribute("class", "strip-hi"); hiLayer.appendChild(c); }
  }

  // ---------- 麵包板 ----------
  function breadboardLinks() {
    const links = []; if (!doc.breadboard) return links;
    for (const ids of Object.values(BREADBOARD.strips)) for (let i = 1; i < ids.length; i++) links.push(["bb:" + ids[0], "bb:" + ids[i]]);
    for (const [id, p] of Object.entries(doc.parts)) for (const [pin, hole] of Object.entries(p.snaps || {})) links.push([id + ":" + pin, "bb:" + hole]);
    return links;
  }
  function snapPart(id) {
    const p = doc.parts[id]; p.snaps = {}; if (!doc.breadboard) return;
    for (const pin of CATALOG[p.type].pins) { const pos = pinPos(id + ":" + pin); if (!pos) continue; const h = holeAt(pos[0] - doc.breadboard.x, pos[1] - doc.breadboard.y, 5); if (h) p.snaps[pin] = h.id; }
    const first = Object.keys(p.snaps)[0];
    if (first) { const h = BREADBOARD.holes.find((x) => x.id === p.snaps[first]); const pos = pinPos(id + ":" + first); p.x += doc.breadboard.x + h.x - pos[0]; p.y += doc.breadboard.y + h.y - pos[1]; for (const pin of Object.keys(p.snaps)) { const q = pinPos(id + ":" + pin); const hh = holeAt(q[0] - doc.breadboard.x, q[1] - doc.breadboard.y, 3); if (!hh) delete p.snaps[pin]; else p.snaps[pin] = hh.id; } }
  }

  // ---------- 電路 ↔ 引擎 ----------
  function circuitForSolver() {
    const wires = [];
    for (const w of doc.wires) { const a = w.a.startsWith("board:") ? boardRefOf(w.a.slice(6)) : w.a, b = w.b.startsWith("board:") ? boardRefOf(w.b.slice(6)) : w.b; if (a && b) wires.push([a, b]); }
    const parts = {}; for (const [id, p] of Object.entries(doc.parts)) parts[id] = { type: p.type, attrs: p.attrs || {} };
    return { board: doc.board, parts, wires };
  }
  function io() {
    const pins = {}, modes = {}, pulls = {}, pwm = {};
    for (const [p, s] of Object.entries(pinState)) { if (s.idle) continue; /* 引擎 C 回報全部 20 支腳；程式沒碰過的不算「用了」 */ modes[p] = s.mode; if (s.mode === "out" || s.mode === "pwm") pins[p] = s.level; if (s.pull) pulls[p] = 1; if (s.pwm) pwm[p] = s.pwm; }
    return { pins, modes, pulls, pwm, ui, burned };
  }
  const boardButtons = () => (doc.board === "tqt_pro" ? [0, 47] : doc.board === "tdisplay_s3" ? [0, 14] : doc.board === "uno" ? [99] : [0]);
  let stoppedForShort = false;
  let lastStructure = "";
  // ---------- 暫態時間步進（電容、555）：有這類元件時每一幀走好幾個 dt，探針記錄節點電壓給示波器 ----------
  let dynState = {}, dynLoop = null, simT = 0, dynLastReal = 0, dynLag = 0; const PROBE_MAX = 4000, FRAME_BUDGET_MS = 10;
  // 步長：只有電容（RC）用 1 ms 就很準；有 555 用 0.2 ms（音頻 555 追不上即時就放慢，不會卡住畫面）
  const dtFor = () => { let dt = 1e-3; for (const p of Object.values(doc.parts)) { if (p.type === "ne555") dt = Math.min(dt, 2e-4); if (p.type === "acsource") dt = Math.min(dt, 1 / ((parseFloat(p.attrs?.freq) || 50) * 50)); } return Math.max(2e-5, dt); };
  let netsCache = null, netsKey = "";
  const probes = [];            // 節點參考（例如 "c1:+"、"board:4"）
  const probeData = {};         // ref → [[t, v], ...]
  const hasDyn = () => Object.values(doc.parts).some((p) => DYNAMIC_TYPES.has(p.type));
  function solveStep(dt) {
    const c = circuitForSolver(), links = breadboardLinks();
    const key = JSON.stringify(c.wires) + "|" + Object.keys(c.parts).join() + "|" + JSON.stringify(links);
    if (key !== netsKey) { netsKey = key; netsCache = null; }
    const r = solve(c, { ...io(), prevV: lastResult ? lastResult.nodeV : {}, dyn: { dt, state: dynState, t: simT }, nets: netsCache }, links);
    netsCache = r.nets;
    if (r.dynState) dynState = r.dynState;
    return r;
  }
  let dynBusy = false;
  function dynFrame(ts) {
    dynLoop = null;
    if (!hasDyn()) { dynLastReal = 0; return; }
    if (dynBusy) return; dynBusy = true;
    try { dynFrameBody(ts); } finally { dynBusy = false; }
    if (hasDyn() && !dynLoop) dynLoop = requestAnimationFrame(dynFrame);
  }
  function dynFrameBody(ts) {
    const DT = dtFor(); const PROBE_EVERY = DT >= 1e-3 ? 1 : 5;
    const real = dynLastReal ? Math.min(0.05, (ts - dynLastReal) / 1000) : DT * 10; dynLastReal = ts;
    const want = Math.max(1, Math.round((real + dynLag) / DT)); dynLag = 0;
    let r = null, k = 0, done = 0; const t0 = performance.now();
    for (let i = 0; i < want; i++) {
      r = solveStep(DT); simT += DT; done++;
      if ((++k % PROBE_EVERY) === 0) for (const ref of probes) { const root = r.nets.find(ref); const arr = probeData[ref] || (probeData[ref] = []); arr.push([simT, r.nodeV[root] ?? 0]); if (arr.length > PROBE_MAX) arr.splice(0, arr.length - PROBE_MAX); }
      if (performance.now() - t0 > FRAME_BUDGET_MS) break;   // 這一幀算不完：剩下的時間丟掉（模擬變慢但畫面不卡）
    }
    if (r) commit(r);
  }
  function ensureDynLoop() { if (hasDyn() && !dynLoop && !dynBusy) { dynLastReal = 0; dynLoop = requestAnimationFrame(dynFrame); } }
  function resetDynamic() { dynState = {}; simT = 0; dynLastReal = 0; for (const k of Object.keys(probeData)) probeData[k] = []; }
  let inTick = false;
  function tick() {
    // 引擎事件（腳位變化）會呼叫 tick，而 commit 又會 setPin 觸發事件：防重入，否則暫態電路會無限遞迴
    if (inTick) return lastResult;
    inTick = true;
    try {
      // 有暫態元件時不能用 dt=0 的直流解（電容會變開路、555 誤判），改走一小步
      const dt = hasDyn() ? dtFor() : 0;
      const r = solveStep(dt); if (dt) simT += dt; ensureDynLoop();
      return commit(r);
    } finally { inTick = false; }
  }
  function commit(r) {
    const structure = Object.keys(doc.parts).join() + "|" + doc.wires.map((w) => w.a + w.b).join() + "|" + JSON.stringify(Object.values(doc.parts).map((p) => p.snaps));
    if (structure !== lastStructure) { lastStructure = structure; lastResult = r; queueMicrotask(syncAttachments); if (api.onStructure) queueMicrotask(api.onStructure); }
    for (const w of r.warnings) if (w.code === "LED_BURN" && !burned.has(w.part) && !r.burned.every((k) => burned.has(k))) { toast(w.brief + "，看「問題」分頁", "warn"); break; }
    lastResult = r; burned = new Set(r.burned);
    shortNets = r.warnings.filter((w) => (w.code === "SHORT" || w.code === "SUPPLY_MIX") && w.net).map((w) => w.net);
    if (engine) {
      for (const [g, lv] of Object.entries(r.inputs)) if (!boardButtons().includes(Number(g)) && pinState[g] && pinState[g].mode === "in" && pinState[g].level !== lv) { pinState[g].level = lv; engine.setPin(Number(g), lv); }
      const VL = vLogic(doc.board);
      for (const [g, raw] of Object.entries(r.adc)) if (pinState[g] && pinState[g].mode === "adc") { const v = raw / 4095 * VL; if (Math.abs((pinState[g].analog ?? -1) - v) > 0.002) { pinState[g].analog = v; engine.setAnalog(Number(g), v); } }
      if (shortNets.length && running && !stoppedForShort) { stoppedForShort = true; engine.stop(); onEvent({ t: "err", s: "⚠ 短路：模擬已暫停，畫紅的線就是直通的路徑。修好接線再按執行。\n" }); }
      if (!shortNets.length) stoppedForShort = false;
    }
    applyState(); renderWires(); onWarnings(r.warnings); if (api.onState) api.onState(r);
    return r;
  }
  function applyState() {
    const r = lastResult; if (!r) return;
    for (const [id, p] of Object.entries(doc.parts)) {
      const el = partEls[id]?.firstChild; const s = r.parts[id] || {}; if (!el) continue;
      switch (p.type) {
        case "led": el.value = !!s.on; el.brightness = s.burned ? 0 : (s.brightness ?? 1); partEls[id].classList.toggle("burned", !!s.burned); break;
        case "buzzer": el.hasSignal = !!s.on; partEls[id].classList.toggle("buzzing", !!s.on); break;
        case "servo": el.angle = s.angle ?? 90; break;
        case "led-bar-graph": el.values = s.values || []; break;
        case "rgb-led": el.ledRed = s.r || 0; el.ledGreen = s.g || 0; el.ledBlue = s.b || 0; break;
        case "pushbutton": el.pressed = !!ui[id]?.pressed; break;
        case "slide-switch": el.value = ui[id]?.value ? 1 : 0; break;
        case "potentiometer": if (el.value === undefined || Math.abs(el.value / 100 - (ui[id]?.value ?? 0.5)) > 0.02) el.value = (ui[id]?.value ?? 0.5) * 100; break;
        case "photoresistor-sensor": el.ledPower = !!s.powered; break;
        case "ssd1306": { const rt = partRuntime[id]; if (rt?.decoder && (rt.decoder.dirty || !rt.painted) && el.imageData) { rt.decoder.toRGBA(el.imageData.data); rt.decoder.dirty = false; rt.painted = true; el.redraw && el.redraw(); } break; }
        case "lcd1602": { const rt = partRuntime[id]; if (rt?.decoder) { if (rt.decoder.dirty || !rt.painted) { el.characters = rt.decoder.characters(); rt.decoder.dirty = false; rt.painted = true; } el.backlight = !!s.powered && rt.decoder.backlight; el.cursor = rt.decoder.cursor; el.blink = rt.decoder.blink; } else el.backlight = false; break; }
        case "neopixel-strip": { const rt = partRuntime[id]; if (el.setPixel && el.shadowRoot && el.shadowRoot.querySelector("g.pixel")) { const cols = rt?.colors || []; for (let i = 0; i < 8; i++) { const c = s.powered && cols[i] ? cols[i] : [0, 0, 0]; try { el.setPixel(0, i, { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 }); } catch (e) {} } } break; }
        case "stepper": { const rt = partRuntime[id]; el.angle = rt?.angle ?? 0; break; }
        case "joystick": { const u = ui[id] || {}; el.xValue = u.x ?? 0; el.yValue = u.y ?? 0; el.pressed = !!u.pressed; break; }
        case "relay": el.setAttribute("energized", s.energized ? "true" : "false"); el.setAttribute("powered", s.powered ? "true" : "false"); break;
        case "capacitor": el.setAttribute("voltage", (s.v ?? 0).toFixed(2)); el.setAttribute("value", String(p.attrs?.value || "100u").replace(/u$/, "µF")); break;
        case "diode": el.setAttribute("on", s.on ? "true" : "false"); el.setAttribute("model", p.attrs?.model || "1N4007"); break;
        case "npn": el.setAttribute("on", s.on ? "true" : "false"); el.setAttribute("model", p.attrs?.model || "2N2222"); break;
        case "ne555": el.setAttribute("out", s.q ? "true" : "false"); break;
        case "acsource": el.setAttribute("voltage", (s.v ?? 0).toFixed(2)); el.setAttribute("vpk", p.attrs?.vpk || "5"); el.setAttribute("freq", p.attrs?.freq || "50"); break;
        case "lm358": el.setAttribute("out1", (s.out1 ?? 0).toFixed(2)); el.setAttribute("out2", (s.out2 ?? 0).toFixed(2)); break;
        case "gate": el.setAttribute("kind", p.attrs?.kind || "AND"); el.setAttribute("y", s.y ? "true" : "false"); break;
      }
    }
    const boardEl = partsLayer.querySelector(".sim-board"); if (!boardEl || !engine) return;
    const level = (g) => (pinState[g] && (pinState[g].mode === "out" || pinState[g].mode === "pwm") ? pinState[g].level : null);
    if (doc.board === "devkit") { boardEl.firstChild.led1 = level(2) === 1; boardEl.firstChild.ledPower = true; }
    else {
      const a = BOARD_ART[doc.board];
      if (a.led) { const c = boardEl.querySelector(".bled"); const lv = level(a.led.gpio); const on = lv === null ? false : (a.led.inverted ? lv === 0 : lv === 1); c.setAttribute("fill", on ? "#ff3" : "#553"); }
      for (const b of boardEl.querySelectorAll(".bbtn")) b.setAttribute("fill", pressedButtons.has(Number(b.dataset.gpio)) ? "#777" : "#333");
      const cv = boardEl.querySelector(".sim-screen");
      if (cv && engine.capabilities.screen && (engine.takeScreenDirty ? engine.takeScreenDirty() : takeDirty())) { const rgba = engine.screenRGBA(); if (rgba) { const [sw, sh] = engine.screenSize ? engine.screenSize() : [128, 128]; if (rgba.length >= sw * sh * 4) cv.getContext("2d").putImageData(new ImageData(rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer || rgba), sw, sh), 0, 0); } }
    }
  }

  // ---------- 互動 ----------
  let drag = null; const pointers = new Map(); const pressedButtons = new Set();
  let wireMode = false;
  // 精準選取（手機）：手指按住時游標顯示在指尖左上方，點選／拉線都以游標位置為準，手指不會遮住目標
  const PREC = { dx: -34, dy: -42 };
  const cursorEl = document.createElement("div"); cursorEl.className = "sim-cursor"; viewport.appendChild(cursorEl);
  const precise = (ev) => api.precise && ev.pointerType === "touch";
  const MAGNET = 16;   // 游標離腳位、麵包板孔、轉折點 16 px 內就吸上去（螢幕像素）
  function toScreen(wx, wy) { const r = viewport.getBoundingClientRect(); return [r.left + view.x + wx * view.z, r.top + view.y + wy * view.z]; }
  const evPt = (ev) => {
    if (!precise(ev)) return [ev.clientX, ev.clientY];
    const raw = [ev.clientX + PREC.dx, ev.clientY + PREC.dy];
    const [wx, wy] = toWorld(raw[0], raw[1]);
    const near = nearestPin(wx, wy, MAGNET / view.z); if (near) return toScreen(...pinPos(near));
    for (const w of doc.wires) for (const pt of (w.pts || [])) if (Math.hypot(pt[0] - wx, pt[1] - wy) * view.z < MAGNET) return toScreen(pt[0], pt[1]);
    return raw;
  };
  const under = (ev) => { const [x, y] = evPt(ev); const el = document.elementFromPoint(x, y); return el && viewport.contains(el) ? el : viewport; };
  const evTarget = (ev) => (precise(ev) ? under(ev) : ev.target);
  let cursorTimer = null;
  function showCursor(ev) { if (!precise(ev)) return; const r = viewport.getBoundingClientRect(); const [x, y] = evPt(ev); cursorEl.style.left = (x - r.left) + "px"; cursorEl.style.top = (y - r.top) + "px"; cursorEl.style.display = "block"; clearTimeout(cursorTimer); }
  function hideCursor() { clearTimeout(cursorTimer); cursorTimer = setTimeout(() => { cursorEl.style.display = "none"; }, 350); }
  viewport.addEventListener("pointerdown", (ev) => {
    pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pointers.size === 2) { drag = { kind: "pinch", z0: view.z, d0: pinchDist(), c0: pinchCenter(), v0: { ...view } }; return; }
    if (ev.pointerType === "touch" && ev.target.closest && ev.target.closest("button,select,input,textarea,#steps")) { pointers.delete(ev.pointerId); return; }
    showCursor(ev);
    const t = evTarget(ev);
    if (t.closest && t.closest("button,select,input,textarea,#steps")) { pointers.delete(ev.pointerId); return; }   // 浮動按鈕、步驟框：交給它們自己，不當成平移
    const wp = t.closest && t.closest("circle.wp");
    if (wp) { ev.preventDefault(); viewport.setPointerCapture(ev.pointerId); drag = { kind: "wp", wire: Number(wp.dataset.wire), pt: Number(wp.dataset.pt) }; return; }
    const pinEl = t.closest && t.closest("circle.pin");
    if (pinEl) {
      const ref = pinEl.dataset.ref;
      if (ref.startsWith("board:") && !boardRefOf(ref.slice(6))) { toast("這支腳（" + ref.slice(6) + "）不能接線"); return; }
      ev.preventDefault(); viewport.setPointerCapture(ev.pointerId); drag = { kind: "wire", from: ref }; const p = pinPos(ref); tempWire.setAttribute("d", `M${p[0]},${p[1]} L${p[0]},${p[1]}`); tempWire.style.display = "block"; return;
    }
    const wireEl = t.closest && t.closest("path.wire,path.wire-hit");
    if (wireEl) { select("wire:" + wireEl.dataset.index, ev.shiftKey); return; }
    const item = t.closest && t.closest(".sim-item");
    if (item) {
      const id = item.dataset.id;
      if (id !== "board" && id !== "bb") {
        const p = doc.parts[id], c = CATALOG[p.type];
        if (running && c.interact && !wireMode) { interactStart(id, ev); select(id); return; }
        select(id, ev.shiftKey);
      } else select(id, ev.shiftKey);
      if (t.closest && t.closest(".bbtn")) { const g = Number(t.closest(".bbtn").dataset.gpio); pressedButtons.add(g); if (engine) engine.pressButton(g); applyState(); drag = { kind: "bbtn", gpio: g }; viewport.setPointerCapture(ev.pointerId); return; }
      if (running && id !== "board" && id !== "bb") return;
      ev.preventDefault(); viewport.setPointerCapture(ev.pointerId);
      const [wx, wy] = toWorld(...evPt(ev));
      const ids = selection.has(id) ? [...selection].filter((s) => !s.startsWith("wire:")) : [id];
      drag = { kind: "items", ids, start: [wx, wy], orig: Object.fromEntries(ids.map((s) => [s, { ...posOf(s) }])), moved: false };
      return;
    }
    select(null);
    // 觸控：單指按空白處不平移（平移、縮放都交給兩指），改成「瞄準」：手指移動時游標跟著走，放開選游標下的線或元件
    if (ev.pointerType === "touch") { drag = { kind: "aim" }; viewport.setPointerCapture(ev.pointerId); return; }
    drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; viewport.setPointerCapture(ev.pointerId);
  });
  const posOf = (id) => (id === "board" ? doc.boardPos : id === "bb" ? doc.breadboard : doc.parts[id]);
  viewport.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (drag) showCursor(ev);
    const [wx, wy] = toWorld(...evPt(ev));
    if (!drag) { hover(evTarget(ev)); return; }
    if (drag.kind === "pinch" && pointers.size === 2) {
      const d = pinchDist(), c = pinchCenter(); const z = Math.max(0.25, Math.min(4, drag.z0 * d / drag.d0));
      const r = viewport.getBoundingClientRect(); const ox = (drag.c0[0] - r.left - drag.v0.x) / drag.z0, oy = (drag.c0[1] - r.top - drag.v0.y) / drag.z0;
      view.z = z; view.x = c[0] - r.left - ox * z; view.y = c[1] - r.top - oy * z; applyView(); return;
    }
    if (drag.kind === "pan") { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; applyView(); return; }
    if (drag.kind === "aim") { hover(under(ev)); return; }
    if (drag.kind === "items") {
      const dx = wx - drag.start[0], dy = wy - drag.start[1];
      for (const id of drag.ids) { const o = drag.orig[id], pos = posOf(id); if (!pos || !o) continue; pos.x = snap(o.x + dx); pos.y = snap(o.y + dy); if (id !== "board" && id !== "bb") snapPart(id); }
      drag.moved = true; render(); return;
    }
    if (drag.kind === "wp") { const w = doc.wires[drag.wire]; w.pts[drag.pt] = [Math.round(wx), Math.round(wy)]; renderWires(); return; }
    if (drag.kind === "wire") { const p = pinPos(drag.from); const near = nearestPin(wx, wy, 10); const q = near ? pinPos(near) : [wx, wy]; tempWire.setAttribute("d", `M${p[0]},${p[1]} L${q[0]},${q[1]}`); highlightStrip(near && near.startsWith("bb:") ? near.slice(3) : null); return; }
    if (drag.kind === "interact") interactMove(drag, ev);
  });
  const endPointer = (ev) => {
    pointers.delete(ev.pointerId); hideCursor();
    if (!drag) return;
    if (drag.kind === "wire") {
      const [wx, wy] = toWorld(...evPt(ev)); const to = nearestPin(wx, wy, 12);
      tempWire.style.display = "none"; highlightStrip(null);
      if (to && to !== drag.from) {
        if (to.startsWith("board:") && !boardRefOf(to.slice(6))) { toast("這支腳（" + to.slice(6) + "）不能接線"); }
        else {
          pushUndo(); doc.wires.push({ a: drag.from, b: to, color: WIRE_COLORS[api.wireColor] || WIRE_COLORS[0], pts: [] }); if (autoWire) routeWires([doc.wires.length - 1]); select("wire:" + (doc.wires.length - 1)); render(); tick();
          for (const ref of [drag.from, to]) { const inf = pinInfo(ref); if (inf.reserved) toast(`注意：${inf.title} 是保留腳位（${inf.reserved}）`, "warn"); }
        }
      }
    } else if (drag.kind === "items") { if (drag.moved) { if (autoWire) routeWires(doc.wires.map((w, i) => i).filter((i) => drag.ids.some((id) => doc.wires[i].a.startsWith(id + ":") || doc.wires[i].b.startsWith(id + ":")))); pushUndo(); render(); tick(); } }
    else if (drag.kind === "wp") { pushUndo(); }
    else if (drag.kind === "aim") { const t = under(ev); const w = t.closest && t.closest("path.wire,path.wire-hit"), it = t.closest && t.closest(".sim-item"); if (w) select("wire:" + w.dataset.index); else if (it) select(it.dataset.id); }
    else if (drag.kind === "bbtn") { pressedButtons.delete(drag.gpio); if (engine) engine.releaseButton(drag.gpio); applyState(); }
    else if (drag.kind === "interact") interactEnd(drag);
    drag = pointers.size === 2 ? drag : null;
  };
  viewport.addEventListener("pointerup", endPointer); viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("dblclick", (ev) => {
    const wireEl = ev.target.closest && ev.target.closest("path.wire,path.wire-hit");
    if (wireEl) { const i = Number(wireEl.dataset.index), w = doc.wires[i]; const [wx, wy] = toWorld(ev.clientX, ev.clientY); pushUndo(); w.pts = w.pts || []; w.pts.splice(nearestSegment(w, wx, wy), 0, [Math.round(wx), Math.round(wy)]); select("wire:" + i); render(); }
  });
  viewport.addEventListener("wheel", (ev) => { ev.preventDefault(); zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.1 : 0.9); }, { passive: false });
  viewport.addEventListener("pointerleave", () => { lastHover = null; onHover(null); });
  function zoomAt(cx, cy, f) { const r = viewport.getBoundingClientRect(); const mx = cx - r.left, my = cy - r.top; const z = Math.max(0.25, Math.min(4, view.z * f)); view.x = mx - (mx - view.x) * z / view.z; view.y = my - (my - view.y) * z / view.z; view.z = z; applyView(); }
  const pinchDist = () => { const v = [...pointers.values()]; return Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) || 1; };
  const pinchCenter = () => { const v = [...pointers.values()]; return [(v[0][0] + v[1][0]) / 2, (v[0][1] + v[1][1]) / 2]; };
  function nearestPin(wx, wy, tol) { let best = null, bd = tol; for (const ref of allPinRefs()) { const p = pinPos(ref); if (!p) continue; const d = Math.hypot(p[0] - wx, p[1] - wy); if (d < bd) { bd = d; best = ref; } } return best; }
  function nearestSegment(w, x, y) { const [ea, eb] = wireEnds(w); const pts = [ea, ...(w.pts || []), eb]; let best = 0, bd = 1e9; for (let i = 0; i < pts.length - 1; i++) { const d = distSeg(x, y, pts[i], pts[i + 1]); if (d < bd) { bd = d; best = i; } } return best; }
  function distSeg(x, y, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }
  let lastHover = null;
  function hover(target) {
    const pinEl = target.closest && target.closest("circle.pin");
    const ref = pinEl ? pinEl.dataset.ref : null;
    if (ref !== lastHover) { lastHover = ref; onHover(ref ? pinInfo(ref) : null); highlightStrip(ref && ref.startsWith("bb:") ? ref.slice(3) : null); }
  }
  function toast(text, kind) { onStatus({ toast: { text, kind: kind || "info" } }); }

  function interactStart(id, ev) {
    const p = doc.parts[id], kind = CATALOG[p.type].interact; ui[id] = ui[id] || {};
    if (kind === "press") { ui[id].pressed = true; drag = { kind: "interact", id, mode: "press" }; viewport.setPointerCapture(ev.pointerId); tick(); }
    else if (kind === "toggle") { ui[id].value = ui[id].value ? 0 : 1; tick(); }
    else if (kind === "knob" || kind === "light") { drag = { kind: "interact", id, mode: kind, sy: ev.clientY, v0: kind === "light" ? (ui[id].light ?? 0.5) : (ui[id].value ?? 0.5) }; viewport.setPointerCapture(ev.pointerId); }
    else if (kind === "distance") { drag = { kind: "interact", id, mode: "distance", sy: ev.clientY, v0: ui[id].distance ?? 100 }; viewport.setPointerCapture(ev.pointerId); }
    else if (kind === "motion") { ui[id].motion = true; tick(); clearTimeout(ui[id]._t); ui[id]._t = setTimeout(() => { ui[id].motion = false; tick(); }, 2500); onStatus({ toast: { text: id + "：偵測到人（OUT 高電位 2.5 秒）", kind: "info" } }); }
    else if (kind === "joystick") { const [wx, wy] = toWorld(...evPt(ev)); drag = { kind: "interact", id, mode: "joystick", cx: wx, cy: wy }; viewport.setPointerCapture(ev.pointerId); if (ev.shiftKey) { ui[id].pressed = true; } tick(); }
    else if (kind === "climate") { onStatus({ toast: { text: "溫濕度在右側屬性面板用滑桿調整", kind: "info" } }); }
  }
  function interactMove(d, ev) {
    if (d.mode === "distance") { const v = Math.max(2, Math.min(400, Math.round(d.v0 + (d.sy - ev.clientY) * 2))); ui[d.id].distance = v; tick(); const el = partEls[d.id]; if (el) el.querySelector(".sim-label").textContent = "距離 " + v + " cm"; return; }
    if (d.mode === "joystick") { const [wx, wy] = toWorld(...evPt(ev)); const x = Math.max(-1, Math.min(1, (wx - d.cx) / 40)), y = Math.max(-1, Math.min(1, (wy - d.cy) / 40)); ui[d.id].x = Math.round(x * 100) / 100; ui[d.id].y = Math.round(y * 100) / 100; tick(); return; }
    if (d.mode === "knob" || d.mode === "light") { const v = Math.max(0, Math.min(1, d.v0 + (d.sy - ev.clientY) / 150)); if (d.mode === "knob") ui[d.id].value = v; else ui[d.id].light = v; tick(); const el = partEls[d.id]; if (el) el.querySelector(".sim-label").textContent = (d.mode === "knob" ? "轉到 " : "光線 ") + Math.round(v * 100) + "%"; } }
  function interactEnd(d) { if (d.mode === "press") { ui[d.id].pressed = false; tick(); } if (d.mode === "joystick") { ui[d.id].x = 0; ui[d.id].y = 0; ui[d.id].pressed = false; tick(); } render(); }

  function select(id, add) {
    if (!id) selection = new Set(); else if (add) { if (selection.has(id)) selection.delete(id); else selection.add(id); } else selection = new Set([id]);
    render();
    const one = selection.size === 1 ? [...selection][0] : null;
    onStatus({ selected: one, selection: [...selection], part: one && doc.parts[one] ? doc.parts[one] : null, wire: one && one.startsWith("wire:") ? doc.wires[Number(one.slice(5))] : null, wireIndex: one && one.startsWith("wire:") ? Number(one.slice(5)) : null, isBoard: one === "board", isBB: one === "bb" });
  }

  // ---------- 編輯 ----------
  function snapshot() { return JSON.stringify({ board: doc.board, parts: doc.parts, wires: doc.wires, boardPos: doc.boardPos, breadboard: doc.breadboard, schematic: doc.schematic || null, perfboard: doc.perfboard || null }); }
  let lastSnap = snapshot();
  function pushUndo() { const s = snapshot(); if (s === lastSnap) return; undoStack.push(lastSnap); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; lastSnap = s; onStatus({ undo: undoStack.length, redo: redoStack.length }); }
  function restore(s) { resetDynamic(); const d = JSON.parse(s); doc.board = d.board; doc.parts = d.parts; doc.wires = d.wires; doc.boardPos = d.boardPos; doc.breadboard = d.breadboard; doc.schematic = d.schematic || null; doc.perfboard = d.perfboard || null; lastSnap = s; selection = new Set(); render(); tick(); onStatus({ undo: undoStack.length, redo: redoStack.length, board: doc.board, selected: null, selection: [] });  if (engine && engineForBoard(doc.board, lastEngineKind) !== engine.kind) { api._attaching = api.attach(doc.board, lastEngineKind).catch((e) => console.error("換板子重接引擎失敗", e)).finally(() => { api._attaching = null; }); } }
  // ---------- 自動整線（router.js）：直角、避開元件、並行線錯開 ----------
  let autoWire = (() => { try { return localStorage.getItem("sim.autowire") !== "0"; } catch { return true; } })();
  function obstacles() { return bounds().items.map((it) => ({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h, soft: it.id === "board" || it.id === "bb" })); }   // soft＝板子／麵包板：腳位在本體裡面，線可以穿；元件本體則要繞
  /** 重走指定的線（沒給＝全部）；回傳整了幾條 */
  // 找不到乾淨路徑時退一步：走 L 形（兩種轉法挑壓過元件本體比較少的），至少不會是一條斜線橫過整片麵包板
  function lPath(a, b, obs) {
    if (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1) return [];
    const hits = (p, q) => obs.filter((o) => !o.soft).reduce((n, o) => { const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]); return n + (x1 > o.x + 2 && x0 < o.x + o.w - 2 && y1 > o.y + 2 && y0 < o.y + o.h - 2 ? 1 : 0); }, 0);
    const c1 = [b[0], a[1]], c2 = [a[0], b[1]];
    return [hits(a, c1) + hits(c1, b) <= hits(a, c2) + hits(c2, b) ? c1 : c2];
  }
  function routeWires(indices) {
    const obs = obstacles(); const idx = indices || doc.wires.map((w, i) => i);
    const list = idx.map((i) => { const [a, b] = wireEnds(doc.wires[i]); return { i, a, b }; }).filter((x) => x.a && x.b);
    // 其他沒重走的線先佔格子，新線避開它們
    const used = new Set();
    for (let i = 0; i < doc.wires.length; i++) if (!idx.includes(i)) for (const p of [wireEnds(doc.wires[i])[0], ...(doc.wires[i].pts || []), wireEnds(doc.wires[i])[1]].filter(Boolean)) used.add(Math.round(p[0] / 10) + "," + Math.round(p[1] / 10));
    let n = 0;
    // 從板子腳位出發的線先垂直離開板緣 14 px 再開始找路，才不會沿著排針走、看起來像接到旁邊好幾支腳
    const brd = obs.find((o) => o.soft && o.id === "board");
    const stub = (ref, p) => {
      if (!brd || !ref.startsWith("board:")) return null;
      const d = [[p[0] - brd.x, [brd.x - 14, p[1]]], [brd.x + brd.w - p[0], [brd.x + brd.w + 14, p[1]]], [p[1] - brd.y, [p[0], brd.y - 14]], [brd.y + brd.h - p[1], [p[0], brd.y + brd.h + 14]]];
      return d.reduce((m, q) => (q[0] < m[0] ? q : m))[1];
    };
    for (const x of list.sort((p, q) => (Math.abs(q.a[0] - q.b[0]) + Math.abs(q.a[1] - q.b[1])) - (Math.abs(p.a[0] - p.b[0]) + Math.abs(p.a[1] - p.b[1])))) {
      const w = doc.wires[x.i], sa = stub(w.a, x.a), sb = stub(w.b, x.b), a = sa || x.a, b = sb || x.b;
      let pts = routeWire({ a, b, obstacles: obs, used, ownIds: sa || sb ? ["board"] : [] }); if (!pts) pts = lPath(a, b, obs);
      if (pts) { doc.wires[x.i].pts = [...(sa ? [sa] : []), ...pts, ...(sb ? [sb] : [])]; n++; }
    }
    return n;
  }
  function bounds() {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; const add = (x, y, w, h) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h); };
    const bw = doc.board === "devkit" ? [106.6, 204.3] : [BOARD_ART[doc.board].w, BOARD_ART[doc.board].h]; add(doc.boardPos.x, doc.boardPos.y, bw[0], bw[1]);
    if (doc.breadboard) add(doc.breadboard.x, doc.breadboard.y, BREADBOARD.width, BREADBOARD.height);
    for (const p of Object.values(doc.parts)) add(p.x, p.y, CATALOG[p.type].w, CATALOG[p.type].h);
    const items = Object.entries(doc.parts).map(([id, p]) => { const c = CATALOG[p.type], r = ((p.rot || 0) % 180 + 180) % 180; return r === 90 ? { id, x: p.x + (c.w - c.h) / 2, y: p.y + (c.h - c.w) / 2, w: c.h, h: c.w } : { id, x: p.x, y: p.y, w: c.w, h: c.h }; });   // 轉 90° 的元件（直放的電阻）外框也要跟著轉
    items.push({ id: "board", x: doc.boardPos.x, y: doc.boardPos.y, w: bw[0], h: bw[1] }); if (doc.breadboard) items.push({ id: "bb", x: doc.breadboard.x, y: doc.breadboard.y, w: BREADBOARD.width, h: BREADBOARD.height });
    return { minX, minY, maxX, maxY, items };
  }

  /** 元件層接上引擎：每個第二批元件一個 attachPart；接線變了就通知它們重新登記腳位 */
  const ctx = {
    gpioOf: (id, pin) => { const r = lastResult; if (!r) return null; const members = r.nets.nets[r.nets.find(id + ":" + pin)] || []; for (const m of members) { const g = /^board:(\d+)$/.exec(m); if (g) return Number(g[1]); } return null; },
    powered: (id) => !!(lastResult?.parts?.[id]?.powered ?? true),
    level: (g) => (pinState[g] ? pinState[g].level : null),
    ui,
    setState: (id, st) => { partRuntime[id] = { ...(partRuntime[id] || {}), ...st }; applyState(); },
    onWiringChange: (fn) => { wiringListeners.add(fn); return () => wiringListeners.delete(fn); },
  };
  function syncAttachments() {
    if (!engine) return;
    for (const id of Object.keys(attached)) if (!doc.parts[id]) { attached[id](); delete attached[id]; delete partRuntime[id]; }
    for (const [id, p] of Object.entries(doc.parts)) if (!attached[id] && ["ssd1306", "lcd1602", "neopixel-strip", "hc-sr04", "dht22", "stepper"].includes(p.type)) attached[id] = attachPart(engine, id, p.type, ctx);
    for (const fn of wiringListeners) { try { fn(); } catch (e) {} }
  }
  const api = {
    doc, view, get running() { return running; }, get result() { return lastResult; }, get selected() { return selection.size === 1 ? [...selection][0] : null; }, get selection() { return [...selection]; },
    wireColor: 0, get gridSnap() { return gridSnap; }, set gridSnap(v) { gridSnap = !!v; }, get wireMode() { return wireMode; }, set wireMode(v) { wireMode = !!v; },
    get autoWire() { return autoWire; }, set autoWire(v) { autoWire = !!v; try { localStorage.setItem("sim.autowire", autoWire ? "1" : "0"); } catch {} },
    /** 整理走線：全部重走（會進復原堆疊）；回傳整了幾條 */
    autoRoute(indices) { pushUndo(); const n = routeWires(indices); pushUndo(); render(); return n; },
    precise: false,   // 精準選取（手指按住時游標在左上方）
    get ui() { return ui; }, onState: null, onStructure: null,   // 簡圖檢視用：狀態變了／電路結構變了
    pinInfo, nodeVoltage, bounds, tick, render, select, toast,
    highlightWires(idx) { hlWires = new Set(idx || []); renderWires(); },
    /** 老師模式用：正規化的網路表（每個網路＝排序後的元件腳／板子腳清單，忽略麵包板孔與沒接東西的網路） */
    canonicalNets() {
      const r = lastResult || solve(circuitForSolver(), io(), breadboardLinks());
      const nets = [];
      for (const members of Object.values(r.nets.nets)) { const m = members.filter((x) => !x.startsWith("bb:")).sort(); if (m.length >= 2) nets.push(m.join("+")); }
      return nets.sort();
    },
    setCards(c) { cards = c; }, get cards() { return cards; },
    addPart(type, x, y) {
      pushUndo(); const base = { led: "led", resistor: "r", pushbutton: "btn", "slide-switch": "sw", potentiometer: "pot", "photoresistor-sensor": "ldr", buzzer: "bz", servo: "servo", "led-bar-graph": "bar", "rgb-led": "rgb" }[type] || type;
      nextIds[base] = (nextIds[base] || 0) + 1; let id = base + nextIds[base]; while (doc.parts[id]) { nextIds[base]++; id = base + nextIds[base]; }
      const c = CATALOG[type]; doc.parts[id] = { type, x: snap((x ?? 200) - c.w / 2), y: snap((y ?? 200) - c.h / 2), rot: 0, attrs: { ...c.attrs }, snaps: {} };
      snapPart(id); pushUndo(); select(id); tick(); return id;
    },
    addBreadboard(x, y) { if (doc.breadboard) { select("bb"); return; } pushUndo(); doc.breadboard = { x: snap(x ?? 40), y: snap(y ?? 320) }; pushUndo(); render(); tick(); select("bb"); },
    deleteSelected() {
      if (!selection.size) return; pushUndo();
      const wireIdx = [...selection].filter((s) => s.startsWith("wire:")).map((s) => Number(s.slice(5))).sort((a, b) => b - a);
      for (const i of wireIdx) doc.wires.splice(i, 1);
      for (const s of selection) {
        if (s === "bb") { doc.breadboard = null; doc.wires = doc.wires.filter((w) => !w.a.startsWith("bb:") && !w.b.startsWith("bb:")); for (const p of Object.values(doc.parts)) p.snaps = {}; }
        else if (doc.parts[s]) { delete doc.parts[s]; doc.wires = doc.wires.filter((w) => !w.a.startsWith(s + ":") && !w.b.startsWith(s + ":")); }
      }
      selection = new Set(); pushUndo(); render(); tick(); select(null);
    },
    rotateSelected() { let any = false; for (const s of selection) if (doc.parts[s]) { if (!any) pushUndo(); any = true; doc.parts[s].rot = ((doc.parts[s].rot || 0) + 90) % 360; snapPart(s); } if (any) { pushUndo(); render(); tick(); } },
    setAttr(id, k, v) { if (!doc.parts[id]) return; pushUndo(); doc.parts[id].attrs[k] = v; pushUndo(); render(); tick(); },
    setLabel(id, text) { if (!doc.parts[id]) return; pushUndo(); doc.parts[id].label = text || ""; pushUndo(); render(); },
    setWireColor(i, color) { if (!doc.wires[i]) return; pushUndo(); doc.wires[i].color = color; pushUndo(); render(); },
    setWireLabel(i, text) { if (!doc.wires[i]) return; pushUndo(); doc.wires[i].label = text || ""; pushUndo(); render(); },
    clearWaypoints(i) { if (!doc.wires[i]) return; pushUndo(); doc.wires[i].pts = []; pushUndo(); render(); },
    selectAll() { selection = new Set([...Object.keys(doc.parts), ...doc.wires.map((_, i) => "wire:" + i)]); render(); onStatus({ selected: null, selection: [...selection] }); },
    align(how) {
      const ids = [...selection].filter((s) => doc.parts[s]); if (ids.length < 2) return; pushUndo();
      const vals = ids.map((s) => (how === "left" ? doc.parts[s].x : how === "top" ? doc.parts[s].y : how === "hcenter" ? doc.parts[s].x + CATALOG[doc.parts[s].type].w / 2 : doc.parts[s].y + CATALOG[doc.parts[s].type].h / 2));
      const target = how === "left" || how === "top" ? Math.min(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
      for (const s of ids) { const p = doc.parts[s], c = CATALOG[p.type]; if (how === "left") p.x = target; else if (how === "top") p.y = target; else if (how === "hcenter") p.x = snap(target - c.w / 2); else p.y = snap(target - c.h / 2); snapPart(s); }
      pushUndo(); render(); tick();
    },
    undo() { if (!undoStack.length) return; redoStack.push(lastSnap); restore(undoStack.pop()); },
    redo() { if (!redoStack.length) return; undoStack.push(lastSnap); restore(redoStack.pop()); },
    clear() { pushUndo(); doc.parts = {}; doc.wires = []; doc.breadboard = null; burned = new Set(); pushUndo(); render(); tick(); select(null); },
    async setBoard(kind) { if (!BOARDS[kind]) return; pushUndo(); doc.board = kind; doc.wires = doc.wires.filter((w) => !w.a.startsWith("board:") && !w.b.startsWith("board:")); pushUndo(); render(); if (engine) await api.attach(kind, engineForBoard(kind, lastEngineKind)); tick(); onStatus({ board: kind }); },
    load(d) { restore(JSON.stringify({ board: d.board || "tqt_pro", parts: d.parts || {}, wires: (d.wires || []).map((w) => ({ pts: [], ...w })), boardPos: d.boardPos || { x: 60, y: 40 }, breadboard: d.breadboard ?? null, schematic: d.schematic || null, perfboard: d.perfboard || null })); burned = new Set(); undoStack.length = 0; redoStack.length = 0; for (const k of Object.keys(ui)) delete ui[k]; },
    save() { return JSON.parse(snapshot()); },
    exportWokwi() { return toWokwiDiagram(api.save()); },
    importWokwi(json) { api.load(fromWokwiDiagram(json)); },
    fit() { const r = viewport.getBoundingClientRect(); const b = bounds(); const z = Math.max(0.25, Math.min(2, Math.min((r.width - 40) / (b.maxX - b.minX), (r.height - 40) / (b.maxY - b.minY)))); view.z = z; view.x = (r.width - (b.maxX - b.minX) * z) / 2 - b.minX * z; view.y = (r.height - (b.maxY - b.minY) * z) / 2 - b.minY * z; applyView(); },
    zoom(f) { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); },
    panTo(wx, wy) { const r = viewport.getBoundingClientRect(); view.x = r.width / 2 - wx * view.z; view.y = r.height / 2 - wy * view.z; applyView(); },
    resetBurned() { burned = new Set(); tick(); },
    focusPart(id) { if (id === "board") { api.panTo(doc.boardPos.x + 60, doc.boardPos.y + 60); select("board"); return; } const p = doc.parts[id]; if (!p) return; api.panTo(p.x + CATALOG[p.type].w / 2, p.y + CATALOG[p.type].h / 2); select(id); },
    /** 匯出 PNG：把麵包板、板子、Wokwi 元素（shadow DOM 裡的 SVG）、線路組成一張 SVG 再畫到 canvas */
    async exportPNG(scale = 2) {
      const b = bounds();
      for (const w of doc.wires) for (const p of [wireEnds(w)[0], ...(w.pts || []), wireEnds(w)[1]]) if (p) { b.minX = Math.min(b.minX, p[0]); b.minY = Math.min(b.minY, p[1]); b.maxX = Math.max(b.maxX, p[0]); b.maxY = Math.max(b.maxY, p[1]); }   // 走線也算進範圍，不然繞出去的線會被裁掉
      const pad = 20, W = b.maxX - b.minX + pad * 2, H = b.maxY - b.minY + pad * 2;
      let s = `<svg xmlns="${SVGNS}" width="${W * scale}" height="${H * scale}" viewBox="${b.minX - pad} ${b.minY - pad} ${W} ${H}"><rect x="${b.minX - pad}" y="${b.minY - pad}" width="${W}" height="${H}" fill="#f4f4f5"/>`;
      if (doc.breadboard) s += `<g transform="translate(${doc.breadboard.x},${doc.breadboard.y})">${BREADBOARD.svg}</g>`;
      const inner = (el) => { if (!el) return ""; const sr = el.shadowRoot; const area = (s) => { const vb = (s.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number); return vb.length === 4 ? vb[2] * vb[3] : (parseFloat(s.getAttribute("width")) || 0) * (parseFloat(s.getAttribute("height")) || 0); };
        const pick = (root) => Array.from(root.querySelectorAll("svg")).sort((p, q) => area(q) - area(p))[0];   // 取最大的那個 svg（wokwi-buzzer 第一個是藏起來的小音符）
        const svgEl = el.tagName && el.tagName.toLowerCase() === "svg" ? el : pick(sr || el); return svgEl ? svgEl.outerHTML.replace(/<style[\s\S]*?<\/style>/g, "") : ""; };
      const boardEl = partsLayer.querySelector(".sim-board"); if (boardEl) s += `<g transform="translate(${doc.boardPos.x},${doc.boardPos.y})">${inner(boardEl.firstChild)}</g>`;
      for (const [id, p] of Object.entries(doc.parts)) { const c = CATALOG[p.type]; s += `<g transform="translate(${p.x},${p.y}) rotate(${p.rot || 0} ${c.w / 2} ${c.h / 2})">${inner(partEls[id].firstChild)}</g>`; }
      for (const w of doc.wires) { const d = wirePath(w); if (d) s += `<path d="${d}" fill="none" stroke="${w.color}" stroke-width="3" stroke-linecap="round"/>`; }
      s += `</svg>`;
      const img = new Image(); const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const cv = document.createElement("canvas"); cv.width = W * scale; cv.height = H * scale; cv.getContext("2d").drawImage(img, 0, 0); URL.revokeObjectURL(url);
      return cv.toDataURL("image/png");
    },

    // ---------- 執行 ----------
    get engine() { return engine; }, get vb() { return engine && engine._vb; },
    async attach(kind, engineKind) {
      if (engine) { try { await engine.stop(); } catch (e) {} }
      for (const id of Object.keys(attached)) { attached[id](); delete attached[id]; delete partRuntime[id]; }   // 換引擎：元件層全部重新登記到新引擎
      const want = engineKind || opts.engine || "micropython-wasm";
      if (!engineForBoard(kind || doc.board, want).startsWith("arduino")) lastEngineKind = want;   // UNO 用的引擎 C 不算使用者選的；換回 ESP32 板子時用回原本的
      const ek = engineForBoard(kind || doc.board, want);
      engine = await createEngine(ek, { board: kind || doc.board, onProgress: opts.onProgress });
      pinState = engine.pins();
      const touch = (g) => (pinState[g] = pinState[g] || { mode: "in", level: 0, pull: 0, pwm: null });
      engine.on("pinmode", (g, mode, pull) => { const s = touch(g); s.mode = mode; s.pull = pull; s.idle = false; if (mode === "in") s.level = -1; /* 下一次求解一定回灌輸入電位（引擎 C 的上拉預設讀 1） */ tick(); });
      engine.on("pin", (g, level) => { const s = touch(g); s.level = level; s.idle = false; tick(); });
      engine.on("pwm", (g, hz, duty) => { touch(g).pwm = hz > 0 ? { freq: hz, duty16: Math.round(duty * 65535) } : null; tick(); });
      engine.on("state", (st) => { running = st === "running"; onStatus({ running, engineState: st }); });
      let bootQuiet = engine.kind === "esp32sim";   // 真韌體開機期間（ROM 訊息、raw REPL 回應）不進主控台，第一個 start 之後才顯示
      engine.on("console", (m) => { if (m.t === "start") bootQuiet = false; if (bootQuiet && m.t === "out") return; onEvent(m); });
      engine._setBootQuiet = (v) => { bootQuiet = v && engine.kind === "esp32sim"; };
      engine.on("screen", () => { screenDirty = true; applyState(); });
      onStatus({ engine: engine.kind, capabilities: engine.capabilities, engineKind: ek }); syncAttachments(); tick(); return engine;
    },
    async run(code, name) { if (!engine) await api.attach(); if (shortNets.length) { toast("先修好短路再執行", "warn"); return { ok: false, msg: "short" }; } burned = new Set(); stoppedForShort = false; if (engine._setBootQuiet) engine._setBootQuiet(true); const r = await engine.boot({ program: code, name: name || "main.py", board: doc.board }); if (r.ok) { running = true; onStatus({ running }); } return r; },
    /** Arduino UNO（引擎 C）：開機跑一份 Intel HEX（範例預編譯的或使用者匯入的）。hex＝文字；name＝顯示用檔名 */
    async runHex(hex, name) { if (api._attaching) await api._attaching; if (!engine || !engine.capabilities.hex) await api.attach(doc.board); if (!engine.capabilities.hex) return { ok: false, msg: "這塊板子不能跑 .hex" }; if (shortNets.length) { toast("先修好短路再執行", "warn"); return { ok: false, msg: "short" }; } burned = new Set(); stoppedForShort = false; const r = await engine.boot({ hex, name: name || "sketch.hex", board: doc.board }); pinState = engine.pins(); tick(); /* 新開機：上一份程式用過的腳全部回到「沒碰過」 */ if (r.ok) { running = true; onStatus({ running }); } return r; },
    /** 直接開機跑一個韌體映像（Arduino 合併 bin；只有引擎 B）：id 相對 sim-engine/，例如 "arduino/t_qt_weather_clock.bin" */
    async runFirmware(id) { if (!engine) await api.attach(); if (!engine.capabilities.arduino) { toast("快速引擎不能跑 Arduino 映像，請切到真韌體引擎", "warn"); return { ok: false, msg: "engine" }; } burned = new Set(); stoppedForShort = false; if (engine._setBootQuiet) engine._setBootQuiet(false); const r = await engine.boot({ firmware: "arduino:" + id, board: doc.board, fresh: true }); if (r.ok) { running = true; onStatus({ running }); } return r; },
    async stop() { if (!engine) return true; const ok = await engine.stop(); running = false; if (engine.capabilities.hex) { pinState = engine.pins(); tick(); } onStatus({ running }); return ok; },
    pause() { if (engine) engine.pause(); },
    step() { if (engine) engine.step(); },
    async reset() { if (engine) await engine.reset(); for (const k of Object.keys(ui)) delete ui[k]; burned = new Set(); pinState = engine ? engine.pins() : {}; for (const id of Object.keys(partRuntime)) { const rt = partRuntime[id]; if (rt.decoder) { const T = rt.decoder.constructor; partRuntime[id] = {}; } else partRuntime[id] = {}; } for (const id of Object.keys(attached)) { attached[id](); delete attached[id]; } syncAttachments(); tick(); },
    partRuntime, ui,
    // 探針（示波器用）：節點參考，例如 "c1:+"、"u1:OUT"、"board:4"
    get probes() { return probes.slice(); },
    addProbe(ref) { if (!probes.includes(ref) && probes.length < 4) { probes.push(ref); probeData[ref] = []; ensureDynLoop(); } },
    removeProbe(ref) { const i = probes.indexOf(ref); if (i >= 0) { probes.splice(i, 1); delete probeData[ref]; } },
    clearProbes() { for (const k of Object.keys(probeData)) probeData[k] = []; },
    get probeData() { return probeData; }, get simTime() { return simT; }, get hasDynamic() { return hasDyn(); },
    /** 節點目前電壓（對 GND） */
    nodeVoltage(ref) { const r = lastResult; if (!r) return null; const root = r.nets.find(ref); return root in r.nodeV ? r.nodeV[root] : null; },
    async check(code) { if (!engine) await api.attach(); return engine.check(code); },
    cmd(c) { if (engine) engine.cmd(c); },
  };
  applyView(); render();
  return api;
}
