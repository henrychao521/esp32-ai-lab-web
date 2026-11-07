// router.js — 麵包板畫布的自動整線：直角走線、避開元件外框、並行線錯開（2026-11-07，使用者：走線要乾淨）。
// 用格子 A*（10 px 一格）：元件／板子／麵包板外框加 margin 當障礙；起點與終點在元件邊上，所以允許在起終點附近的小泡泡裡穿過障礙走出來。
// 回傳的是中間轉折點（不含兩端腳位），直接塞進 wire.pts。

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * @param {object} o
 * @param {[number,number]} o.a 起點（世界座標）
 * @param {[number,number]} o.b 終點
 * @param {{x:number,y:number,w:number,h:number}[]} o.obstacles 障礙外框
 * @param {Set<string>} [o.used] 已被別條線用掉的格子（"c,r"），走到要加價（讓線錯開）
 * @param {number} [o.grid] 格距 px
 * @param {number} [o.margin] 障礙外擴 px
 * @returns {[number,number][]|null} 轉折點（空陣列＝直線即可）
 */
export function routeWire({ a, b, obstacles, used = new Set(), grid = 10, margin = 5 }) {
  const xs = [a[0], b[0], ...obstacles.flatMap((o) => [o.x, o.x + o.w])], ys = [a[1], b[1], ...obstacles.flatMap((o) => [o.y, o.y + o.h])];
  const pad = 60;
  const minX = Math.floor((Math.min(...xs) - pad) / grid), minY = Math.floor((Math.min(...ys) - pad) / grid);
  const maxX = Math.ceil((Math.max(...xs) + pad) / grid), maxY = Math.ceil((Math.max(...ys) + pad) / grid);
  const W = maxX - minX + 1, H = maxY - minY + 1;
  if (W * H > 250000) return null;   // 太大就不整（避免卡住）
  const toCell = (p) => [Math.round(p[0] / grid) - minX, Math.round(p[1] / grid) - minY];
  const toPt = (c) => [(c[0] + minX) * grid, (c[1] + minY) * grid];
  const blocked = new Uint16Array(W * H);   // 0＝空，n＝第 n 個障礙（1 起算；含 margin 外圈）
  const body = new Uint8Array(W * H);       // 1＝在元件本體裡（不含 margin）：盡量不要穿
  obstacles.forEach((o, oi) => {
    const c0 = Math.floor((o.x - margin) / grid) - minX, c1 = Math.ceil((o.x + o.w + margin) / grid) - minX;
    const r0 = Math.floor((o.y - margin) / grid) - minY, r1 = Math.ceil((o.y + o.h + margin) / grid) - minY;
    for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(W - 1, c1); c++) {
      if (!blocked[r * W + c]) blocked[r * W + c] = oi + 1;
      const x = (c + minX) * grid, y = (r + minY) * grid;
      if (x > o.x + 2 && x < o.x + o.w - 2 && y > o.y + 2 && y < o.y + o.h - 2) body[r * W + c] = 1;
    }
  });
  const s = toCell(a), g = toCell(b);
  // 腳位在元件邊上或板子裡：只允許在「自己那個元件」的外框裡、離腳位 BUBBLE 格內穿過，不能借道別的元件
  const inObs = (p) => obstacles.findIndex((o) => p[0] >= o.x - margin && p[0] <= o.x + o.w + margin && p[1] >= o.y - margin && p[1] <= o.y + o.h + margin) + 1;
  const sObs = inObs(a), gObs = inObs(b);
  const BUBBLE = 5;
  const dS = (c) => Math.abs(c[0] - s[0]) + Math.abs(c[1] - s[1]), dG = (c) => Math.abs(c[0] - g[0]) + Math.abs(c[1] - g[1]);
  // 腳位所屬的元件（含板子）整個外框都可以走（被鄰居包住時還走得出來），每格加價 2；別的元件只有腳位附近 BUBBLE 格可借道，每格加價 5
  const own = (c, ob) => (ob === sObs && sObs) || (ob === gObs && gObs);
  const near = (c, ob) => own(c, ob) || dS(c) <= BUBBLE || dG(c) <= BUBBLE;
  const foreign = (c, ob) => !own(c, ob);
  const key = (c) => c[0] + "," + c[1];
  const h = (c) => Math.abs(c[0] - g[0]) + Math.abs(c[1] - g[1]);
  // A*：狀態含方向（轉彎加價）
  const open = [{ c: s, dir: -1, gc: 0, f: h(s) }]; const best = new Map(); const came = new Map();
  best.set(key(s) + "|-1", 0);
  let found = null, iter = 0;
  while (open.length && iter++ < 150000) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.c[0] === g[0] && cur.c[1] === g[1]) { found = cur; break; }
    for (let d = 0; d < 4; d++) {
      const nc = [cur.c[0] + DIRS[d][0], cur.c[1] + DIRS[d][1]];
      if (nc[0] < 0 || nc[1] < 0 || nc[0] >= W || nc[1] >= H) continue;
      const ob = blocked[nc[1] * W + nc[0]]; const isBlocked = ob !== 0; const inBody = body[nc[1] * W + nc[0]] === 1;
      if (isBlocked && !near(nc, ob)) continue;
      if (isBlocked && inBody && foreign(nc, ob)) continue;         // 別人的本體絕不穿
      let step = 1;
      if (cur.dir !== -1 && cur.dir !== d) step += 2;              // 轉彎
      if (used.has(key(nc))) step += 6;                             // 和別條線重疊：寧可多轉一次也要錯開
      if (isBlocked) step += foreign(nc, ob) ? 5 : (inBody ? 8 : 1);   // 自己的 margin 便宜、自己的本體很貴（只在被包住時才穿）、借道鄰居 margin 加 5
      const gc = cur.gc + step, k = key(nc) + "|" + d;
      if (gc < (best.get(k) ?? 1e9)) { best.set(k, gc); came.set(k, key(cur.c) + "|" + cur.dir); open.push({ c: nc, dir: d, gc, f: gc + h(nc) }); }
    }
  }
  if (!found) return null;
  // 回溯
  const path = []; let k = key(found.c) + "|" + found.dir;
  while (k) { const [ck] = k.split("|"); path.push(ck.split(",").map(Number)); k = came.get(k); }
  path.reverse();
  for (const c of path) used.add(key(c));
  // 只留轉折點
  const corners = [];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i - 1], c = path[i], n = path[i + 1];
    if ((c[0] - p[0]) !== (n[0] - c[0]) || (c[1] - p[1]) !== (n[1] - c[1])) corners.push(toPt(c));
  }
  // 起終點不在格點上：第一／最後一個轉折點對齊腳位的 x 或 y，讓線從腳位直直出去
  if (corners.length) {
    const first = corners[0], last = corners[corners.length - 1];
    if (Math.abs(first[0] - a[0]) < grid) first[0] = a[0]; else if (Math.abs(first[1] - a[1]) < grid) first[1] = a[1];
    if (Math.abs(last[0] - b[0]) < grid) last[0] = b[0]; else if (Math.abs(last[1] - b[1]) < grid) last[1] = b[1];
  }
  return corners;
}

/** 整條電路：長線先走（它們最需要繞），把 used 一路傳下去讓線錯開。回傳 {index: pts}。 */
export function routeAll(wires, obstacles, opts = {}) {
  const used = new Set(); const out = {};
  const order = wires.map((w, i) => ({ i, w, len: Math.abs(w.a[0] - w.b[0]) + Math.abs(w.a[1] - w.b[1]) })).sort((p, q) => q.len - p.len);
  for (const { i, w } of order) { const pts = routeWire({ a: w.a, b: w.b, obstacles, used, ...opts }); if (pts) out[i] = pts; }
  return out;
}
