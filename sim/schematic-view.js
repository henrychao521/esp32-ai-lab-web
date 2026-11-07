// schematic-view.js — 畫布上的「麵包板／簡圖」切換與簡圖檢視（平移、縮放、拖符號、即時亮滅、匯出）。
// 簡圖本身由 schematic.js 產生；這裡只負責 DOM 與互動。
import { buildSchematic } from "./schematic.js";

export function mountSchematic(sim, { viewport, toast = () => {} }) {
  const toggle = document.createElement("div"); toggle.className = "sch-toggle";
  toggle.innerHTML = `<button data-v="bb" class="on">麵包板</button><button data-v="sch">簡圖</button>`;
  const layer = document.createElement("div"); layer.className = "sch-layer"; layer.hidden = true;
  layer.innerHTML = `<div class="sch-canvas"></div>
    <div class="sch-tools"><button id="sch-fit" class="icon" title="縮放到全部">⤢</button><button id="sch-relayout" class="icon" title="重新自動排列（清掉手動拖過的位置）">↺</button><button id="sch-allpins" class="icon" title="板子列出全部腳位">#</button><button id="sch-png" class="icon" title="下載簡圖 PNG">PNG</button><button id="sch-svg" class="icon" title="下載簡圖 SVG">SVG</button></div>
    <div class="sch-hint">電源腳接到 3V3／5V 符號、GND 接到接地符號，不另外拉回板子（和課本一樣）。點符號可在麵包板上選到同一個元件；拖符號可調位置。</div>`;
  viewport.append(toggle, layer);
  const canvas = layer.querySelector(".sch-canvas");
  const $ = (id) => layer.querySelector("#" + id);
  let showAll = false, svgEl = null, built = null, view = { x: 0, y: 0, z: 1 }, needFit = true, timer = null;

  function states() {
    const r = sim.result, ui = sim.ui || {}, st = {};
    if (!r) return st;
    for (const [id, s] of Object.entries(r.parts || {})) st[id] = { on: !!s.on, burned: !!s.burned, pressed: !!ui[id]?.pressed, value: ui[id]?.value };
    for (const [id, u] of Object.entries(ui)) st[id] = { ...(st[id] || {}), pressed: !!u.pressed, value: u.value };
    return st;
  }
  function rebuild() {
    if (!sim.result) return;
    const sel = sim.selected;
    built = buildSchematic({ doc: sim.doc, nets: sim.result.nets.nets, states: states(), showAllPins: showAll });
    canvas.innerHTML = built.svg; svgEl = canvas.firstElementChild;
    svgEl.setAttribute("width", built.w); svgEl.setAttribute("height", built.h);
    if (sel && svgEl.querySelector(`[data-id="${sel}"]`)) svgEl.querySelector(`[data-id="${sel}"]`).classList.add("selected");
    if (needFit) { fit(); needFit = false; } else apply();
  }
  const schedule = () => { if (layer.hidden) return; clearTimeout(timer); timer = setTimeout(rebuild, 60); };
  function apply() { canvas.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; }
  function fit() {
    if (!built) return; const r = viewport.getBoundingClientRect();
    const z = Math.max(0.3, Math.min(3, Math.min((r.width - (r.width < 600 ? 100 : 60)) / built.w, (r.height - 100) / built.h)));
    view = { z, x: Math.max(10, (r.width - (r.width < 600 ? 60 : 0) - built.w * z) / 2), y: Math.max(48, (r.height - built.h * z) / 2) }; apply();
  }
  function show(v) {
    layer.hidden = v !== "sch"; viewport.classList.toggle("sch-on", v !== "bb");
    if (v === "sch") rebuild();
  }
  toggle.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; for (const x of toggle.querySelectorAll("button")) x.classList.toggle("on", x === b); show(b.dataset.v); viewport.dispatchEvent(new CustomEvent("simview", { detail: b.dataset.v })); });
  $("sch-fit").addEventListener("click", fit);
  $("sch-relayout").addEventListener("click", () => { if (sim.doc.schematic) sim.doc.schematic.positions = {}; needFit = true; rebuild(); toast("已重新排列"); });
  $("sch-allpins").addEventListener("click", function () { showAll = !showAll; this.classList.toggle("on", showAll); needFit = true; rebuild(); });
  $("sch-svg").addEventListener("click", () => { if (!built) return; download(new Blob([built.svg], { type: "image/svg+xml" }), "schematic.svg"); });
  $("sch-png").addEventListener("click", async () => {
    if (!built) return;
    const img = new Image(); const url = URL.createObjectURL(new Blob([built.svg], { type: "image/svg+xml" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas"); c.width = built.w * 2; c.height = built.h * 2; const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    c.toBlob((b) => download(b, "schematic.png"), "image/png");
  });
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  // ---- 互動：拖符號、點選、平移、縮放（滑鼠滾輪、兩指） ----
  let drag = null; const pointers = new Map();
  const toLocal = (cx, cy) => { const r = viewport.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
  layer.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button")) return;
    pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: view.z, c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } }; return; }
    try { layer.setPointerCapture(ev.pointerId); } catch {}
    const g = ev.target.closest && ev.target.closest(".sch-part");
    if (g && g.dataset.id !== "board") { const [lx, ly] = toLocal(ev.clientX, ev.clientY); const p = built.positions[g.dataset.id]; drag = { kind: "part", id: g.dataset.id, sx: lx, sy: ly, ox: p.x, oy: p.y, moved: false }; return; }
    if (g) { drag = { kind: "click", id: "board" }; }
    else drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
  });
  layer.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!drag) return;
    if (drag.kind === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const z = Math.max(0.3, Math.min(4, drag.z0 * d / drag.d0)); const r = viewport.getBoundingClientRect();
      const ox = (drag.c0[0] - r.left - drag.v0.x) / drag.z0, oy = (drag.c0[1] - r.top - drag.v0.y) / drag.z0;
      view = { z, x: c[0] - r.left - ox * z, y: c[1] - r.top - oy * z }; apply(); return;
    }
    if (drag.kind === "pan") { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; drag.moved = true; apply(); }
    if (drag.kind === "part") {
      const [lx, ly] = toLocal(ev.clientX, ev.clientY); const dx = lx - drag.sx, dy = ly - drag.sy;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) { sim.doc.schematic = sim.doc.schematic || { positions: {} }; sim.doc.schematic.positions[drag.id] = { x: Math.round(drag.ox + dx), y: Math.round(drag.oy + dy) }; const g = svgEl.querySelector(`[data-id="${drag.id}"]`); if (g) g.setAttribute("transform", g.getAttribute("transform").replace(/translate\([^)]*\)/, `translate(${drag.ox + dx},${drag.oy + dy})`)); }
    }
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId); if (!drag) return;
    if (drag.kind === "part") { if (drag.moved) rebuild(); else { sim.select(drag.id); rebuild(); } }
    else if (drag.kind === "click") { sim.select("board"); rebuild(); }
    else if (drag.kind === "pan" && !drag.moved) { sim.select(null); rebuild(); }
    drag = pointers.size === 2 ? drag : null;
  };
  layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
  layer.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = viewport.getBoundingClientRect(); const f = ev.deltaY < 0 ? 1.1 : 0.9; const z = Math.max(0.3, Math.min(4, view.z * f)); const px = ev.clientX - r.left, py = ev.clientY - r.top; view = { z, x: px - (px - view.x) * z / view.z, y: py - (py - view.y) * z / view.z }; apply(); }, { passive: false });

  // 電路變動或狀態變動時重畫（只在簡圖顯示中）
  sim.onState = schedule; sim.onStructure = () => { needFit = needFit || !built; schedule(); };
  return { show, rebuild, get visible() { return !layer.hidden; } };
}
