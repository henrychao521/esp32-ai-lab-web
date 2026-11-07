// perfboard-view.js — 畫布上的「萬用板」檢視：正面／背面切換、板型、拖曳元件、旋轉、焊接順序與警示、PNG／SVG 匯出。
// 版面由 perfboard.js 產生；手動擺過的位置記在 doc.perfboard.place[id] = { c, r, rot }，其餘元件自動繞開。
import { buildPerfboard, BOARD_SIZES, PITCH } from "./perfboard.js";

export function mountPerfboard(sim, { viewport, toast = () => {} }) {
  const toggle = viewport.querySelector(".sch-toggle");
  const btn = document.createElement("button"); btn.dataset.v = "pb"; btn.textContent = "萬用板"; toggle.appendChild(btn);
  const layer = document.createElement("div"); layer.className = "sch-layer pb-layer"; layer.hidden = true;
  layer.innerHTML = `<div class="sch-canvas"></div>
    <div class="pb-bar"><select id="pb-size">${Object.entries(BOARD_SIZES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</select><button id="pb-side" class="icon">看背面</button><button id="pb-rot" class="icon" title="把選到的元件轉 90°（也可按 R）">⟳ 旋轉</button><button id="pb-steps" class="icon">焊接順序</button></div>
    <div class="sch-tools"><button id="pb-fit" class="icon" title="縮放到全部">⤢</button><button id="pb-relayout" class="icon" title="全部重新自動排列（清掉手動拖過的位置）">↺</button><button id="pb-png" class="icon" title="下載 PNG">PNG</button><button id="pb-svg" class="icon" title="下載 SVG">SVG</button></div>
    <div class="sch-hint pb-hint">拖元件可換位置（會自動對齊孔位並重走錫橋）；點一下再按「旋轉」轉 90°。板子（排母）也可以拖。</div>
    <div class="pb-panel" hidden><div class="pb-panel-hd"><b>焊接順序與提醒</b><button class="icon pb-panel-x">✕</button></div><ol id="pb-steplist"></ol><div id="pb-warn"></div></div>`;
  viewport.appendChild(layer);
  const canvas = layer.querySelector(".sch-canvas"); const $ = (id) => layer.querySelector("#" + id);
  let built = null, side = "front", size = (sim.doc.perfboard && sim.doc.perfboard.size) || "5x7", view = { x: 0, y: 0, z: 1 }, needFit = true, timer = null, selId = null;
  $("pb-size").value = size;
  const manual = () => { sim.doc.perfboard = sim.doc.perfboard || {}; sim.doc.perfboard.place = sim.doc.perfboard.place || {}; return sim.doc.perfboard.place; };

  function rebuild() {
    if (!sim.result) return;
    built = buildPerfboard({ doc: sim.doc, nets: sim.result.nets.nets, size });
    // 手動位置放不下：丟掉那筆，提醒，重排一次
    const bad = built.warnings.filter((w) => w.code === "MANUAL_BAD");
    if (bad.length && sim.doc.perfboard?.place) { for (const w of bad) delete sim.doc.perfboard.place[w.part]; toast(bad[0].brief, "warn"); return rebuild(); }
    canvas.innerHTML = side === "front" ? built.svgFront : built.svgBack;
    if (selId && !(selId in built.place)) selId = null;
    if (selId) canvas.querySelector(`.pb-part[data-id="${selId}"]`)?.classList.add("selected");
    $("pb-steplist").innerHTML = built.steps.map((s) => `<li>${s.replace(/^\d+\.\s*/, "")}</li>`).join("");
    $("pb-warn").innerHTML = built.warnings.map((w) => `<div class="pb-w ${w.code === "NO_SPACE" || w.code === "BOARD_TOO_BIG" ? "bad" : ""}">${w.brief}</div>`).join("");
    const hard = built.warnings.find((w) => w.code === "NO_SPACE" || w.code === "BOARD_TOO_BIG");
    if (hard && size === "5x7") { size = "7x9"; $("pb-size").value = size; toast("5×7 放不下，改用 7×9"); return rebuild(); }
    if (needFit) { fit(); needFit = false; } else apply();
  }
  const schedule = () => { if (layer.hidden) return; clearTimeout(timer); timer = setTimeout(rebuild, 80); };
  function apply() { canvas.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`; }
  function fit() {
    if (!built) return; const r = viewport.getBoundingClientRect();
    // 上方要留給「麵包板｜簡圖｜萬用板」切換鈕與板型／旋轉那一排（手機版兩排各約 44px）
    const top = (layer.querySelector(".pb-bar")?.getBoundingClientRect().bottom || r.top + 90) - r.top + 8;
    const z = Math.max(0.3, Math.min(3, Math.min((r.width - (r.width < 600 ? 100 : 60)) / built.w, (r.height - top - 20) / built.h)));
    view = { z, x: Math.max(10, (r.width - (r.width < 600 ? 60 : 0) - built.w * z) / 2), y: Math.max(top, (r.height - top - built.h * z) / 2 + top) }; apply();
  }
  function show(v) { layer.hidden = v !== "pb"; if (v === "pb") rebuild(); }
  viewport.addEventListener("simview", (e) => show(e.detail));
  $("pb-size").addEventListener("change", function () { size = this.value; sim.doc.perfboard = { ...(sim.doc.perfboard || {}), size }; needFit = true; rebuild(); });
  $("pb-side").addEventListener("click", function () { side = side === "front" ? "back" : "front"; this.textContent = side === "front" ? "看背面" : "看正面"; rebuild(); });
  $("pb-steps").addEventListener("click", () => { const p = layer.querySelector(".pb-panel"); p.hidden = !p.hidden; });
  layer.querySelector(".pb-panel-x").addEventListener("click", () => { layer.querySelector(".pb-panel").hidden = true; });
  $("pb-fit").addEventListener("click", fit);
  $("pb-relayout").addEventListener("click", () => { if (sim.doc.perfboard) sim.doc.perfboard.place = {}; selId = null; needFit = true; rebuild(); toast("已重新自動排列"); });
  // 旋轉：選到的元件（或板子）順時針轉 90°；位置不變，放不下會退回並提醒
  function rotate() {
    if (!built || !selId) { toast("先點一個元件，再按旋轉", "info"); return; }
    const cur = built.place[selId]; const m = manual();
    m[selId] = { c: cur.c, r: cur.r, rot: ((cur.rot || 0) + 90) % 360 };
    rebuild(); if (built.place[selId] && (built.place[selId].rot || 0) === m[selId]?.rot) toast(`${selId === "board" ? "板子" : selId} 已轉到 ${m[selId].rot}°`);
  }
  $("pb-rot").addEventListener("click", rotate);
  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $("pb-svg").addEventListener("click", () => { if (built) download(new Blob([side === "front" ? built.svgFront : built.svgBack], { type: "image/svg+xml" }), `perfboard-${side}.svg`); });
  $("pb-png").addEventListener("click", async () => {
    if (!built) return; const svg = side === "front" ? built.svgFront : built.svgBack;
    const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas"); c.width = built.w * 3; c.height = built.h * 3; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    c.toBlob((b) => download(b, `perfboard-${side}.png`), "image/png");
  });

  // ---- 互動：拖元件（對齊孔位）、點選、平移、縮放（滑鼠拖、滾輪、兩指） ----
  let drag = null; const pointers = new Map();
  const toLocal = (cx, cy) => { const r = viewport.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
  const mirror = () => (side === "front" ? 1 : -1);   // 背面左右鏡像：往右拖＝欄數減少
  layer.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button,select,.pb-panel")) return;
    pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pointers.size === 2) { if (drag?.kind === "part") drag.el?.removeAttribute("transform"); const [a, b] = [...pointers.values()]; drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: view.z, c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } }; return; }
    try { layer.setPointerCapture(ev.pointerId); } catch {}
    const g = ev.target.closest && ev.target.closest(".pb-part");
    if (g && built) { const [lx, ly] = toLocal(ev.clientX, ev.clientY); drag = { kind: "part", id: g.dataset.id, el: g, sx: lx, sy: ly, dc: 0, dr: 0, moved: false }; return; }
    drag = { kind: "pan", sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
  });
  layer.addEventListener("pointermove", (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!drag) return;
    if (drag.kind === "pinch" && pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const z = Math.max(0.3, Math.min(4, drag.z0 * d / drag.d0)); const r = viewport.getBoundingClientRect(); const ox = (drag.c0[0] - r.left - drag.v0.x) / drag.z0, oy = (drag.c0[1] - r.top - drag.v0.y) / drag.z0; view = { z, x: c[0] - r.left - ox * z, y: c[1] - r.top - oy * z }; apply(); return; }
    if (drag.kind === "pan") { view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; drag.moved = true; apply(); return; }
    if (drag.kind === "part") {
      const [lx, ly] = toLocal(ev.clientX, ev.clientY); const dx = lx - drag.sx, dy = ly - drag.sy;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      drag.dc = Math.round(dx / PITCH); drag.dr = Math.round(dy / PITCH);   // 對齊孔位（畫面上的格），背面再換成欄位方向
      drag.el.setAttribute("transform", `translate(${drag.dc * PITCH},${drag.dr * PITCH})`); drag.el.classList.add("ghost");
    }
  });
  const end = (ev) => {
    pointers.delete(ev.pointerId); if (!drag) return;
    if (drag.kind === "part") {
      drag.el.classList.remove("ghost");
      if (drag.moved && (drag.dc || drag.dr)) {
        const cur = built.place[drag.id]; manual()[drag.id] = { c: cur.c + drag.dc * mirror(), r: cur.r + drag.dr, rot: cur.rot || 0 }; selId = drag.id; rebuild();
      } else { drag.el.removeAttribute("transform"); selId = selId === drag.id ? null : drag.id; for (const g of canvas.querySelectorAll(".pb-part")) g.classList.toggle("selected", g.dataset.id === selId); if (selId && sim.select) sim.select(selId === "board" ? "board" : selId); }
    } else if (drag.kind === "pan" && !drag.moved) { selId = null; for (const g of canvas.querySelectorAll(".pb-part")) g.classList.remove("selected"); }
    drag = pointers.size === 2 ? drag : null;
  };
  layer.addEventListener("pointerup", end); layer.addEventListener("pointercancel", end);
  layer.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = viewport.getBoundingClientRect(); const f = ev.deltaY < 0 ? 1.1 : 0.9; const z = Math.max(0.3, Math.min(4, view.z * f)); const px = ev.clientX - r.left, py = ev.clientY - r.top; view = { z, x: px - (px - view.x) * z / view.z, y: py - (py - view.y) * z / view.z }; apply(); }, { passive: false });
  const prevStructure = sim.onStructure; sim.onStructure = () => { prevStructure && prevStructure(); schedule(); };
  return { show, rebuild, rotate, get visible() { return !layer.hidden; }, get built() { return built; }, get selected() { return selId; } };
}
