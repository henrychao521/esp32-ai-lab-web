// schematic.js — 從電路資料（元件＋網路表）產生電路簡圖 SVG。純函式，Node 可測。
// 規則式佈局：板子在最左；元件依「離板子幾步」分欄往右；3V3／5V 腳接電源軌符號（往上）、GND 接接地符號（往下），
// 不把電源線拉回板子（課本畫法，也避免全圖被電源線纏住）；訊號網路用正交線＋垂直幹線，三線以上交會處畫黑點。
import { PARTS } from "./circuit.js";
import { BOARD_ART, DEVKIT_PINMAP } from "./catalog.js";
import { symbolFor, boardSymbol, railSymbol, groundSymbol, SCH_CSS, STUB } from "./symbols.js";

const POWER = new Set(["3V3", "5V", "VIN"]);
const COL_GAP = 90;      // 欄與欄之間（放幹線的走廊）
const ROW_GAP = 34;      // 同欄元件上下間距
const RAIL_H = 30;       // 電源／接地符號佔的高度

/** 板子腳位：求解器用的 ref（board:16、board:GND）→ 印刷名（G16、D9、GND.1…） */
export function printedPinName(board, ref) {
  const key = ref.replace(/^board:/, "");
  if (board === "devkit") { for (const [name, v] of Object.entries(DEVKIT_PINMAP)) if (String(v) === key) return name; return key; }
  const art = BOARD_ART[board]; if (!art) return key;
  const e = art.pins.find((q) => String(q[3]) === key); return e ? e[0] : key;
}

/**
 * @param {object} o
 * @param {object} o.doc        模擬器的 doc（board、parts、schematic?）
 * @param {object} o.nets       buildNets 的 nets：{ root: [refs] }（含 bb:* 會被略過）
 * @param {object} [o.states]   每個元件的狀態（LED on、按鍵 pressed…），畫亮滅用
 * @param {boolean} [o.showAllPins] 板子列出全部腳位
 * @returns {{svg:string, w:number, h:number, nets:Object<string,string[]>, positions:Object}}
 */
export function buildSchematic({ doc, nets, states = {}, showAllPins = false }) {
  const board = doc.board, parts = doc.parts || {};
  const manual = (doc.schematic && doc.schematic.positions) || {};
  // ---- 1. 整理網路：去掉麵包板孔；分類電源／接地／訊號 ----
  const netList = [];
  for (const [root, members] of Object.entries(nets)) {
    const refs = members.filter((r) => !r.startsWith("bb:"));
    const partRefs = refs.filter((r) => !r.startsWith("board:") && parts[r.split(":")[0]]);
    const boardRefs = refs.filter((r) => r.startsWith("board:"));
    if (partRefs.length + boardRefs.length < 2) continue;
    const power = boardRefs.map((r) => r.slice(6)).find((n) => POWER.has(n));
    const gnd = boardRefs.some((r) => r.slice(6) === "GND");
    netList.push({ id: root, refs: [...partRefs, ...boardRefs], partRefs, boardRefs, kind: power ? "power" : gnd ? "gnd" : "signal", label: power || (gnd ? "GND" : "") });
  }
  // ---- 2. 符號與腳位別名 ----
  const syms = {};
  for (const [id, p] of Object.entries(parts)) { const s = symbolFor(p.type); s.id = id; s.type = p.type; syms[id] = s; }
  const pinKey = (ref) => { const [id, pin] = [ref.split(":")[0], ref.slice(ref.indexOf(":") + 1)]; const s = syms[id]; return s ? (s.alias && s.alias[pin]) || pin : pin; };
  // ---- 3. 板子方塊：只列用到的訊號腳；電源腳在上、GND 在下 ----
  const usedBoard = new Set(); for (const n of netList) for (const r of n.boardRefs) usedBoard.add(r.slice(6));
  const allSignal = board === "devkit" ? Object.entries(DEVKIT_PINMAP).filter(([, v]) => typeof v === "number").map(([k]) => k) : (BOARD_ART[board]?.pins || []).filter((q) => typeof q[3] === "number").map((q) => q[0]);
  const usedSignalNames = [...usedBoard].filter((k) => !POWER.has(k) && k !== "GND").map((k) => printedPinName(board, "board:" + k));
  const signalNames = showAllPins ? allSignal : usedSignalNames.sort((a, b) => allSignal.indexOf(a) - allSignal.indexOf(b));
  const powerNames = [...usedBoard].filter((k) => POWER.has(k));
  const gndNames = usedBoard.has("GND") ? ["GND"] : [];
  const boardTitle = BOARD_ART[board]?.title || (board === "devkit" ? "ESP32 DevKit" : board);
  const bsym = boardSymbol(boardTitle, signalNames, powerNames, gndNames); bsym.id = "board";
  // 板子腳位 ref → 符號腳名（印刷名）
  const boardPinName = (ref) => { const k = ref.slice(6); return POWER.has(k) || k === "GND" ? k : printedPinName(board, ref); };
  // ---- 4. 分欄：BFS，從板子出發沿訊號網路 ----
  const depth = {}; const adj = {};
  for (const n of netList) if (n.kind === "signal") {
    const ids = [...new Set(n.partRefs.map((r) => r.split(":")[0]))]; const hasBoard = n.boardRefs.length > 0;
    for (const a of ids) { adj[a] = adj[a] || new Set(); if (hasBoard) adj[a].add("board"); for (const b of ids) if (a !== b) adj[a].add(b); }
  }
  const queue = ["board"]; depth.board = 0;
  for (const [a, set] of Object.entries(adj)) if (set.has("board")) { depth[a] = 1; queue.push(a); }
  while (queue.length) { const a = queue.shift(); for (const b of (adj[a] || [])) if (depth[b] === undefined) { depth[b] = depth[a] + 1; queue.push(b); } }
  for (const id of Object.keys(parts)) if (depth[id] === undefined) depth[id] = 1;   // 只接電源／GND 或完全沒接的：放第 1 欄
  // 兩腳水平元件：若「右腳」接到更靠板子的東西就左右翻轉
  for (const [id, s] of Object.entries(syms)) {
    if (s.block || Object.keys(s.pins).length !== 2) continue;
    const [pa, pb] = Object.keys(s.pins);   // 左、右
    const near = (pin) => { const n = netList.find((x) => x.kind === "signal" && x.partRefs.some((r) => r.split(":")[0] === id && pinKey(r) === pin)); if (!n) return 99; if (n.boardRefs.length) return 0; return Math.min(...n.partRefs.map((r) => r.split(":")[0]).filter((o) => o !== id).map((o) => depth[o] ?? 99), 99); };
    if (near(pb) < near(pa)) s.flip = true;
  }
  // ---- 5. 擺位置 ----
  const cols = {}; for (const id of Object.keys(parts)) (cols[depth[id]] = cols[depth[id]] || []).push(id);
  const maxDepth = Math.max(0, ...Object.keys(cols).map(Number));
  const pos = { board: { x: 0, y: 0 } };
  let x = bsym.w + COL_GAP;
  const colX = { 0: 0 };
  for (let d = 1; d <= maxDepth; d++) {
    const ids = cols[d] || []; if (!ids.length) continue;
    // 同欄排序：照它接到的前一欄元件的 y（重心），沒有就照 id
    ids.sort((a, b) => (anchorY(a) - anchorY(b)) || a.localeCompare(b));
    colX[d] = x;
    let y = 0; const colW = Math.max(...ids.map((i) => syms[i].w));
    for (const id of ids) { pos[id] = { x, y }; y += syms[id].h + ROW_GAP + (needsRail(id) ? RAIL_H : 0); }
    x += colW + COL_GAP;
  }
  function needsRail(id) { return netList.some((n) => n.kind !== "signal" && n.partRefs.some((r) => r.split(":")[0] === id)); }
  function anchorY(id) {
    const ys = [];
    for (const n of netList) if (n.kind === "signal" && n.partRefs.some((r) => r.split(":")[0] === id)) {
      for (const r of n.partRefs) { const o = r.split(":")[0]; if (o !== id && pos[o] && depth[o] < depth[id]) ys.push(pos[o].y); }
      if (n.boardRefs.length) ys.push(0);
    }
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e6;
  }
  // 每欄垂直置中對齊板子中線
  const boardMid = bsym.h / 2;
  for (const d of Object.keys(cols)) { const ids = cols[d]; const last = ids[ids.length - 1]; const total = pos[last].y + syms[last].h; const off = boardMid - total / 2; for (const id of ids) pos[id].y += off; }
  // 手動拖過的位置優先
  for (const [id, p] of Object.entries(manual)) if (pos[id]) pos[id] = { x: p.x, y: p.y };
  // ---- 6. 腳位絕對座標 ----
  const pinAbs = (ref) => {
    if (ref.startsWith("board:")) { const p = bsym.pins[boardPinName(ref)]; return p ? { x: pos.board.x + p.x, y: pos.board.y + p.y, dir: p.dir } : null; }
    const id = ref.split(":")[0], s = syms[id]; if (!s || !pos[id]) return null;
    const p = s.pins[pinKey(ref)]; if (!p) return null;
    const px = s.flip ? s.w - p.x : p.x; const dir = s.flip ? ({ l: "r", r: "l" }[p.dir] || p.dir) : p.dir;
    return { x: pos[id].x + px, y: pos[id].y + p.y, dir };
  };
  // ---- 7. 畫線 ----
  let wires = "", junctions = "", rails = "";
  const drawnNets = {};
  // 電源／接地：每支腳自己接符號
  for (const n of netList) {
    if (n.kind === "signal") continue;
    const seen = new Set();
    for (const r of n.refs) {
      const key = r.startsWith("board:") ? "board:" + boardPinName(r) : r.split(":")[0] + ":" + pinKey(r);
      if (seen.has(key)) continue; seen.add(key);
      const p = pinAbs(r); if (!p) continue;
      (drawnNets[n.id] = drawnNets[n.id] || []).push(r);
      const up = n.kind === "power";
      let ax = p.x, ay = p.y;
      if (p.dir === "l" || p.dir === "r") { const dx = p.dir === "l" ? -12 : 12; wires += `<path class="sch-wire" d="M${p.x},${p.y} h${dx} v${up ? -10 : 10}"/>`; ax = p.x + dx; ay = p.y + (up ? -10 : 10); }
      else if ((p.dir === "t") !== up) { const dy = p.dir === "t" ? -8 : 8; wires += `<path class="sch-wire" d="M${p.x},${p.y} v${dy} h14 v${up ? -14 : 14}"/>`; ax = p.x + 14; ay = p.y + dy + (up ? -14 : 14); }
      rails += up ? railSymbol(ax, ay, n.label) : groundSymbol(ax, ay);
    }
  }
  // 訊號：先算每個網路的端點，幹線放在「最左端點所在欄」右邊的走廊
  const colOf = (ref) => ref.startsWith("board:") ? 0 : depth[ref.split(":")[0]];
  let channelY = -40;   // 跨欄的網路走上方走廊，每條網路一層
  const used = {};      // 走廊 x → 已用的 y 區間，避免幹線疊在一起
  function trunkX(col) { const left = col === 0 ? bsym.w : colX[col] + Math.max(...(cols[col] || []).map((i) => syms[i].w)); const k = String(col); used[k] = (used[k] || 0) + 1; return left + 14 + ((used[k] - 1) % 5) * 12; }
  for (const n of netList) {
    if (n.kind !== "signal") continue;
    const seen = new Set(); const ends = [];
    for (const r of n.refs) { const key = r.startsWith("board:") ? "board:" + boardPinName(r) : r.split(":")[0] + ":" + pinKey(r); if (seen.has(key)) continue; seen.add(key); const p = pinAbs(r); if (p) ends.push({ ...p, ref: r, col: colOf(r) }); }
    if (ends.length < 2) continue;
    drawnNets[n.id] = ends.map((e) => e.ref);
    const minCol = Math.min(...ends.map((e) => e.col)), maxCol = Math.max(...ends.map((e) => e.col));
    const tx = trunkX(minCol);
    if (maxCol - minCol <= 1) {
      // 相鄰兩欄：每個端點水平到幹線，幹線垂直連起來
      const ys = ends.map((e) => e.y); const y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (const e of ends) wires += `<path class="sch-wire" d="M${e.x},${e.y} H${tx}"/>`;
      if (y1 > y0) wires += `<path class="sch-wire" d="M${tx},${y0} V${y1}"/>`;
      for (const e of ends) if (e.y > y0 && e.y < y1) junctions += `<circle class="sch-junction" cx="${tx}" cy="${e.y}" r="2.6"/>`;
      if (ends.length > 2) { const cnt = {}; for (const e of ends) cnt[e.y] = (cnt[e.y] || 0) + 1; for (const [y, c] of Object.entries(cnt)) if (c > 1 && (Number(y) === y0 || Number(y) === y1)) junctions += `<circle class="sch-junction" cx="${tx}" cy="${y}" r="2.6"/>`; }
    } else {
      // 跨欄：走上方走廊，避免穿過中間欄的元件
      channelY -= 14; const cy = channelY;
      const xs = ends.map((e) => (e.col === minCol ? tx : trunkX(e.col)));
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      ends.forEach((e, i) => { wires += `<path class="sch-wire" d="M${e.x},${e.y} H${xs[i]} V${cy}"/>`; });
      wires += `<path class="sch-wire" d="M${minX},${cy} H${maxX}"/>`;
      for (let i = 0; i < xs.length; i++) if (xs[i] > minX && xs[i] < maxX) junctions += `<circle class="sch-junction" cx="${xs[i]}" cy="${cy}" r="2.6"/>`;
    }
  }
  // ---- 8. 元件符號 ----
  let body = "";
  const place = (s, id, p, st) => `<g class="sch-part" data-id="${id}" transform="translate(${p.x},${p.y})${s.flip ? ` translate(${s.w},0) scale(-1,1)` : ""}">${s.svg(st)}</g>`;
  body += place(bsym, "board", pos.board, {});
  for (const [id, s] of Object.entries(syms)) {
    const st = states[id] || {}; const p = parts[id];
    if (p.type === "led") st.color = ledColor(p.attrs?.color);
    body += place(s, id, pos[id], st);
    const label = (p.label || id) + (p.attrs?.value ? " " + p.attrs.value + "Ω" : "");
    body += `<text class="sch-label" x="${pos[id].x + s.w / 2}" y="${pos[id].y + s.h + 12}" text-anchor="middle" dominant-baseline="middle">${label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  }
  // ---- 9. 外框與 SVG ----
  let minX = 0, minY = Math.min(0, channelY - 10), maxX = bsym.w, maxY = bsym.h;
  for (const [id, p] of Object.entries(pos)) { const s = id === "board" ? bsym : syms[id]; minX = Math.min(minX, p.x - 30); maxX = Math.max(maxX, p.x + s.w + 30); minY = Math.min(minY, p.y - RAIL_H - 10); maxY = Math.max(maxY, p.y + s.h + RAIL_H + 16); }
  const PAD = 24; const w = maxX - minX + PAD * 2, h = maxY - minY + PAD * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - PAD} ${minY - PAD} ${w} ${h}" width="${w}" height="${h}" class="sch"><style>${SCH_CSS}</style><g class="sch-wires">${wires}${junctions}${rails}</g><g class="sch-parts">${body}</g></svg>`;
  return { svg, w, h, viewBox: [minX - PAD, minY - PAD, w, h], nets: drawnNets, positions: pos };
}

function ledColor(c) { return { red: "#e33", green: "#2ca84a", blue: "#2f6fe6", yellow: "#e8c21a", orange: "#f08a24", white: "#ddd" }[(c || "red").toLowerCase()] || "#e33"; }

/** 對帳：簡圖畫出來的每個網路，端點集合是否與求解器網路一致（只比有兩個以上非麵包板端點的網路）。 */
export function checkNets(drawn, nets) {
  const norm = (arr) => [...new Set(arr.map((r) => r.replace(/:(1|2)\.(l|r)$/, ":$1")))].sort().join(",");
  const want = {}; for (const [root, m] of Object.entries(nets)) { const refs = m.filter((r) => !r.startsWith("bb:")); const n = norm(refs); if (n.split(",").length >= 2) want[root] = n; }
  const missing = [], wrong = [];
  for (const [root, s] of Object.entries(want)) { if (!drawn[root]) missing.push(root); else if (norm(drawn[root]) !== s) wrong.push({ root, want: s, got: norm(drawn[root]) }); }
  return { ok: !missing.length && !wrong.length, missing, wrong, total: Object.keys(want).length };
}
