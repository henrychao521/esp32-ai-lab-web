// perfboard-view.js — 畫布上的「萬用板」檢視：正面／背面切換、板型、焊接順序與警示、PNG／SVG 匯出。
// 版面由 perfboard.js 產生；平移縮放與簡圖檢視同一套手勢。
import { buildPerfboard, BOARD_SIZES } from "./perfboard.js";

export function mountPerfboard(sim, { viewport, toast = () => {} }) {
  const toggle = viewport.querySelector(".sch-toggle");
  const btn = document.createElement("button"); btn.dataset.v = "pb"; btn.textContent = "萬用板"; toggle.appendChild(btn);
  const layer = document.createElement("div"); layer.className = "sch-layer pb-layer"; layer.hidden = true;
  layer.innerHTML = `<div class="sch-canvas"></div>
    <div class="pb-bar"><select id="pb-size">${Object.entries(BOARD_SIZES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select><button id="pb-side" class="icon">看背面</button><button id="pb-steps" class="icon">焊接順序</button></div>
    <div class="sch-tools"><button id="pb-fit" class="icon" title="縮放到全部">⤢</button><button id="pb-png" class="icon" title="下載 PNG">PNG</button><button id="pb-svg" class="icon" title="下載 SVG">SVG</button></div>
    <div class="pb-panel" hidden><div class="pb-panel-hd"><b>焊接順序與提醒</b><button class="icon pb-panel-x">✕</button></div><ol id="pb-steplist"></ol><div id="pb-warn"></div></div>`;
  viewport.appendChild(layer);
  const canvas = layer.querySelector(".sch-canvas"); const $ = (id) => layer.querySelector("#" + id);
  let built = null, side = "front", size = (sim.doc.perfboard && sim.doc.perfboard.size) || "5x7", view = { x: 0, y: 0, z: 1 }, needFit = true, timer = null;
  $("pb-size").value = size;

  function rebuild() {
    if (!sim.result) return;
    built = buildPerfboard({ doc: sim.doc, nets: sim.result.nets.nets, size });
    canvas.innerHTML = side === "front" ? built.svgFront : built.svgBack;
    $("pb-steplist").innerHTML = built.steps.map((s) => `<li>${s.replace(/^\d+\.\s*/, "")}</li>`).join("");
    $("pb-warn").innerHTML = built.warnings.map((w) => `<div class="pb-w ${w.code === "NO_SPACE" || w.code === "BOARD_TOO_BIG" ? "bad" : ""}">${w.brief}</div>`).join("");
    const hard = built.warnings.find((w) => w.code === "NO_SPACE" || w.code === "BOARD_TOO_BIG");
    if (hard && size === "5x7") { size = "7x9"; $("pb-size").value = size; toast("5×7 放不下，改用 7×9"); return rebuild(); }
    if (needFit) { fit(); needFit = false; } else apply();
  }
  const schedule = () => { if (layer.hidden) return; clearTimeout(timer); timer = setTimeout(rebuild, 80); };
  function apply() { canvas.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; }
  function fit() { if (!built) return; const r = viewport.getBoundingClientRect(); const z = Math.max(0.3, Math.min(3, Math.min((r.width - (r.width < 600 ? 100 : 60)) / built.w, (r.height - 110) / built.h))); view = { z, x: Math.max(10, (r.width - (r.width < 600 ? 60 : 0) - built.w * z) / 2), y: Math.max(52, (r.height - built.h * z) / 2) }; apply(); }
  function show(v) { layer.hidden = v !== "pb"; if (v === "pb") rebuild(); }
  viewport.addEventListener("simview", (e) => show(e.detail));
  $("pb-size").addEventListener("change", function () { size = this.value; sim.doc.perfboard = { ...(sim.doc.perfboard || {}), size }; needFit = true; rebuild(); });
  $("pb-side").addEventListener("click", function () { side = side === "front" ? "back" : "front"; this.textContent = side === "front" ? "看背面" : "看正面"; rebuild(); });
  $("pb-steps").addEventListener("click", () => { const p = layer.querySelector(".pb-panel"); p.hidden = !p.hidden; });
  layer.querySelector(".pb-panel-x").addEventListener("click", () => { layer.querySelector(".pb-panel").hidden = true; });
  $("pb-fit").addEventListener("click", fit);
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $("pb-svg").addEventListener("click", () => { if (built) download(new Blob([side === "front" ? built.svgFront : built.svgBack], { type: "image/svg+xml" }), `perfboard-${side}.svg`); });
  $("pb-png").addEventListener("click", async () => {
    if (!built) return; const svg = side === "front" ? built.svgFront : built.svgBack;
    const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas"); c.width = built.w * 3; c.height = built.h * 3; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    c.toBlob((b) => download(b, `perfboard-${side}.png`), "image/png");
  });
  // 平移縮放（滑鼠拖、滾輪、兩指）
  let drag = null; const pointers = new Map();
  layer.addEventListener("pointerdown", (ev) => { if (ev.target.closest("button,select,.pb-panel")) return; pointers.set(ev.pointerId, [ev.clientX, ev.clientY]); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: view.z, c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } }; return; } layer.setPointerCapture(ev.pointerId); drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; });
  layer.addEventListener("pointermove", (ev) => { if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]); if (!drag) return; if (drag.kind === "pinch" && pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const z = Math.max(0.3, Math.min(4, drag.z0 * d / drag.d0)); const r = viewport.getBoundingClientRect(); const ox = (drag.c0[0] - r.left - drag.v0.x) / drag.z0, oy = (drag.c0[1] - r.top - drag.v0.y) / drag.z0; view = { z, x: c[0] - r.left - ox * z, y: c[1] - r.top - oy * z }; apply(); return; } if (drag.kind === "pan") { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; apply(); } });
  const end = (ev) => { pointers.delete(ev.pointerId); drag = pointers.size === 2 ? drag : null; };
  layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
  layer.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = viewport.getBoundingClientRect(); const f = ev.deltaY < 0 ? 1.1 : 0.9; const z = Math.max(0.3, Math.min(4, view.z * f)); const px = ev.clientX - r.left, py = ev.clientY - r.top; view = { z, x: px - (px - view.x) * z / view.z, y: py - (py - view.y) * z / view.z }; apply(); }, { passive: false });
  const prevStructure = sim.onStructure; sim.onStructure = () => { prevStructure && prevStructure(); schedule(); };
  return { show, rebuild, get visible() { return !layer.hidden; } };
}
