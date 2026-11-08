// perfboard.js — 萬用板（洞洞板）版面：把電路的網路表映射到 2.54 mm 孔洞網格，背面用錫橋連線、
// 接不過去的用正面跳線；輸出正面圖（元件、跳線）與背面鏡像圖（錫橋、焊點），加焊接順序與短路警示。純函式，Node 可測。
import { PARTS } from "./circuit.js";
import { DEVKIT_PINS, DEVKIT_PINMAP } from "./catalog.js";
import { printedPinName } from "./schematic.js";

// 元件值標示：電容是 µF，其他（電阻）是 Ω
const fmtValue = (p) => (p.type === "capacitor" ? String(p.attrs.value).replace(/u$/, "µ") + "F" : p.attrs.value + "Ω");
export const BOARD_SIZES = { "5x7": { cols: 18, rows: 24, label: "5×7 cm（18×24 孔）" }, "7x9": { cols: 24, rows: 30, label: "7×9 cm（24×30 孔）" } };
export const PITCH = 12;   // 畫圖用：一個孔 12 px

/** 元件腳位佔孔：每支腳 [名稱, dc, dr]（相對元件原點的孔偏移）；body 是正面外形（孔單位）。 */
const FOOT = {
  resistor: { pins: [["1", 0, 0], ["2", 4, 0]], body: [1, -0.4, 2, 0.8], tall: 0 },
  led: { pins: [["A", 0, 0], ["C", 1, 0]], body: [-0.5, -0.6, 2, 1.2], tall: 1 },
  pushbutton: { pins: [["1.l", 0, 0], ["1.r", 2, 0], ["2.l", 0, 2], ["2.r", 2, 2]], body: [-0.5, -0.5, 3, 3], tall: 2 },
  "slide-switch": { pins: [["1", 0, 0], ["2", 1, 0], ["3", 2, 0]], body: [-0.5, -0.6, 3, 1.2], tall: 2 },
  potentiometer: { pins: [["GND", 0, 0], ["SIG", 1, 0], ["VCC", 2, 0]], body: [-0.5, -2.2, 3, 2.6], tall: 3 },
  buzzer: { pins: [["1", 0, 0], ["2", 3, 0]], body: [-0.5, -1.5, 4, 3], tall: 3 },
  servo: { pins: [["GND", 0, 0], ["V+", 1, 0], ["PWM", 2, 0]], body: [-0.5, -0.6, 3, 1.2], tall: 1, header: true },
  "photoresistor-sensor": { pins: [["VCC", 0, 0], ["GND", 1, 0], ["DO", 2, 0], ["AO", 3, 0]], body: [-0.5, -3.2, 4, 3.6], tall: 2, header: true },
  "led-bar-graph": { pins: Array.from({ length: 10 }, (_, i) => ["A" + (i + 1), i, 0]).concat(Array.from({ length: 10 }, (_, i) => ["C" + (i + 1), i, 3])), body: [-0.5, -0.5, 10, 4], tall: 2 },
  "rgb-led": { pins: [["R", 0, 0], ["COM", 1, 0], ["G", 2, 0], ["B", 3, 0]], body: [-0.5, -0.8, 4, 1.6], tall: 1 },
  ssd1306: { pins: [["DATA", 0, 0], ["CLK", 1, 0], ["DC", 2, 0], ["RST", 3, 0], ["CS", 4, 0], ["3V3", 5, 0], ["VIN", 6, 0], ["GND", 7, 0]], body: [-0.5, -5.2, 8, 5.6], tall: 2, header: true },
  lcd1602: { pins: [["GND", 0, 0], ["VCC", 1, 0], ["SDA", 2, 0], ["SCL", 3, 0]], body: [-0.5, -3.2, 16, 3.6], tall: 2, header: true },
  "hc-sr04": { pins: [["VCC", 0, 0], ["TRIG", 1, 0], ["ECHO", 2, 0], ["GND", 3, 0]], body: [-1.5, -3.2, 7, 3.6], tall: 2, header: true },
  dht22: { pins: [["VCC", 0, 0], ["SDA", 1, 0], ["NC", 2, 0], ["GND", 3, 0]], body: [-0.5, -3.2, 4, 3.6], tall: 2, header: true },
  "neopixel-strip": { pins: [["GND", 0, 0], ["VCC", 1, 0], ["DIN", 2, 0], ["DOUT", 9, 0]], body: [-0.5, -1.2, 10, 1.6], tall: 1, header: true },
  pir: { pins: [["VCC", 0, 0], ["OUT", 1, 0], ["GND", 2, 0]], body: [-1, -3.2, 5, 3.6], tall: 3, header: true },
  relay: { pins: [["VCC", 0, 0], ["GND", 1, 0], ["IN", 2, 0], ["NO", 0, 5], ["COM", 1, 5], ["NC", 2, 5]], body: [-0.5, -0.5, 4, 6], tall: 3, header: true },
  capacitor: { pins: [["+", 0, 0], ["-", 1, 0]], body: [-0.6, -2.4, 2.2, 2.8], tall: 2 },
  diode: { pins: [["A", 0, 0], ["K", 3, 0]], body: [0.8, -0.4, 1.4, 0.8], tall: 0 },
  npn: { pins: [["E", 0, 0], ["B", 1, 0], ["C", 2, 0]], body: [-0.5, -1.6, 3, 2], tall: 1 },
  ne555: { pins: [["GND", 0, 0], ["TRIG", 1, 0], ["OUT", 2, 0], ["RESET", 3, 0], ["CTRL", 3, 3], ["THR", 2, 3], ["DIS", 1, 3], ["VCC", 0, 3]], body: [-0.5, 0.5, 4, 2], tall: 1 },
  acsource: { pins: [["+", 0, 0], ["-", 1, 0]], body: [-0.5, -1.6, 2, 2], tall: 2, header: true },
  lm358: { pins: [["OUT1", 0, 0], ["IN1-", 1, 0], ["IN1+", 2, 0], ["GND", 3, 0], ["IN2+", 3, 3], ["IN2-", 2, 3], ["OUT2", 1, 3], ["VCC", 0, 3]], body: [-0.5, 0.5, 4, 2], tall: 1 },
  gate: { pins: [["A", 0, 0], ["B", 1, 0], ["Y", 2, 0], ["VCC", 0, 2], ["GND", 2, 2]], body: [-0.5, 0.4, 3, 1.2], tall: 1 },
  stepper: { pins: [["A-", 0, 0], ["A+", 1, 0], ["B+", 2, 0], ["B-", 3, 0]], body: [-0.5, -0.6, 4, 1.2], tall: 1, header: true },
  joystick: { pins: [["VCC", 0, 0], ["VERT", 1, 0], ["HORZ", 2, 0], ["SEL", 3, 0], ["GND", 4, 0]], body: [-0.5, -3.2, 5, 3.6], tall: 3, header: true },
};
/** 板子（插排母）：pins [印刷名, dc, dr]，body 外形（孔單位）。 */
function boardFoot(board) {
  if (board === "tqt_pro") return { pins: [["5V", 0, 0], ["GND", 1, 0], ["3V3", 2, 0], ["G16", 3, 0], ["G17", 4, 0], ["G18", 5, 0], ["G48", 6, 0]], body: [-1.5, -6.5, 10, 7.2], title: "T-QT Pro" };
  if (board === "xiao_esp32s3") return { pins: [["D0", 0, 0], ["D1", 0, 1], ["D2", 0, 2], ["D3", 0, 3], ["D4", 0, 4], ["D5", 0, 5], ["D6", 0, 6], ["5V", 6, 0], ["GND", 6, 1], ["3V3", 6, 2], ["D10", 6, 3], ["D9", 6, 4], ["D8", 6, 5], ["D7", 6, 6]], body: [-0.5, -1, 7, 8.2], title: "XIAO ESP32S3" };
  if (board === "tdisplay_s3") { const L = ["3V3", "GND", "G43", "G44", "G18", "G17", "G21", "G16", "G1", "G2", "G3", "G10", "G11", "G12", "G13"]; return { pins: L.map((n, i) => [n, 0, i]).concat([["5V", 9, 0], ["GND", 9, 1], ["3V3", 9, 2]]), body: [-0.5, -1, 10, 16.2], title: "T-Display S3" }; }
  // Arduino UNO：做成擴充板（shield）的排針位置——上排數位、下排電源＋類比，左右順序與上下間距照 UNO 實際排針（catalog BOARD_ART 的座標換算成孔距，
  // D7／D8 之間、VIN／A0 之間那段半格空隙取整成空一格）；兩排中間就是放元件的地方。下排標籤畫在排針下方（第 4 欄 "b"），才不會和上排疊在一起。
  // SCL／SDA／AREF 在 GND 左邊、超出 5×7 板寬，而且 SDA／SCL 就是 A4／A5，所以不畫。（2026-11-08 使用者：洞洞板接線位置跟板子本身對不起來）
  if (board === "uno") {
    const top = [["GND", 0], ["D13", 1], ["D12", 2], ["D11", 3], ["D10", 4], ["D9", 5], ["D8", 6], ["D7", 8], ["D6", 9], ["D5", 10], ["D4", 11], ["D3", 12], ["D2", 13], ["D1", 14], ["D0", 15]];
    const bot = [["IOREF", 2], ["RESET", 3], ["3V3", 4], ["5V", 5], ["GND", 6], ["GND", 7], ["VIN", 8], ["A0", 10], ["A1", 11], ["A2", 12], ["A3", 13], ["A4", 14], ["A5", 15]];
    return { pins: top.map(([n, c]) => [n, c, 0]).concat(bot.map(([n, c]) => [n, c, 19, "b"])), body: [-0.5, -2.0, 16, 3.3], titleBelow: true, title: "Arduino UNO 擴充板排針（上：數位　下：電源／類比）" };
  }
  // 電源供應器（無開發板）：萬用板上只有一組三孔電源端子（接到電源供應器或 9V 電池扣）
  if (board === "power") return { pins: [["9V", 0, 0], ["5V", 1, 0], ["GND", 2, 0]], body: [-0.5, -2.2, 3, 2.7], title: "電源端子" };
  // devkit：DEVKIT_PINS 的 x 小的是左排，依 y 排序
  const left = DEVKIT_PINS.filter((p) => p[1] < 50).sort((a, b) => a[2] - b[2]), right = DEVKIT_PINS.filter((p) => p[1] >= 50).sort((a, b) => a[2] - b[2]);
  return { pins: left.map((p, i) => [p[0], 0, i]).concat(right.map((p, i) => [p[0], 10, i])), body: [-0.5, -1, 11, left.length + 1.2], title: "ESP32 DevKit" };
}

/** 把腳位表順時針轉 rot 度（0/90/180/270；孔單位，以元件原點為中心）。 */
export function rotFoot(foot, rot = 0) {
  const k = ((Math.round(rot / 90) % 4) + 4) % 4; if (!k) return foot;
  const R = ([x, y]) => { for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };
  const pins = foot.pins.map(([n, dc, dr, ...rest]) => { const [x, y] = R([dc, dr]); return [n, x, y, ...rest]; });
  const [bx, by, bw, bh] = foot.body; const cs = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(R);
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]); const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { ...foot, pins, body: [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0], rot: k * 90 };
}
/** 某個元件（或 "board"）的腳位表（未旋轉）。 */
export function footFor(doc, id) {
  if (id === "board") return boardFoot(doc.board);
  const p = (doc.parts || {})[id]; if (!p) return null;
  return FOOT[p.type] || { pins: (PARTS[p.type]?.pins || []).map((n, i) => [n, i, 0]), body: [-0.5, -1.2, (PARTS[p.type]?.pins || []).length, 1.6], tall: 2 };
}

const key = (c, r) => c + "," + r;
const POWER = new Set(["3V3", "5V", "VIN", "GND", "9V"]);

/**
 * @param {object} o
 * @param {object} o.doc    模擬器 doc（board、parts、perfboard?）
 * @param {object} o.nets   求解器網路表 { root: [refs] }
 * @param {string} [o.size] "5x7" | "7x9"
 */
export function buildPerfboard({ doc, nets, size = "5x7" }) {
  const B = BOARD_SIZES[size] || BOARD_SIZES["5x7"]; const C = B.cols, R = B.rows;
  const board = doc.board, parts = doc.parts || {};
  const warnings = [];
  // ---- 1. 網路：ref → netId；只留非麵包板端點 ----
  const netOf = {}; const netPins = {}; let n = 0;
  for (const [root, members] of Object.entries(nets)) {
    const refs = members.filter((r) => !r.startsWith("bb:")).filter((r) => r.startsWith("board:") ? true : parts[r.split(":")[0]]);
    if (refs.length < 2) continue;
    const id = "n" + (n++); netPins[id] = refs; for (const r of refs) netOf[r] = id;
  }
  // ---- 2. 腳位→孔：先擺板子，再擺元件 ----
  const occ = new Map();     // "c,r" → { ref, net, part }
  const place = {};          // part id → { c, r, rot }
  const feet = {};           // part id → 實際用的（已旋轉）腳位表
  const manual = (doc.perfboard && doc.perfboard.place) || {};   // 使用者拖過／轉過的位置
  const bf0 = boardFoot(board);
  const bf = manual.board ? rotFoot(bf0, manual.board.rot || 0) : bf0;
  const bodyCells = (foot, c0, r0) => { const [bx, by, bw, bh] = foot.body; const cells = []; for (let c = Math.floor(c0 + bx); c < Math.ceil(c0 + bx + bw); c++) for (let r = Math.floor(r0 + by); r < Math.ceil(r0 + by + bh); r++) cells.push([c, r]); return cells; };
  const fits = (foot, c0, r0) => { for (const [c, r] of bodyCells(foot, c0, r0)) { if (c < 0 || r < 0 || c >= C || r >= R) return false; const o = occ.get(key(c, r)); if (o && (o.body || o.part === "board")) return false;   /* 本體也不能蓋到板子的排針（UNO 下排在 body 外） */ } for (const [, dc, dr] of foot.pins) { const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= C || r >= R || occ.get(key(c, r))) return false; } return true; };
  const put = (foot, id, c0, r0, refOf) => { for (const [c, r] of bodyCells(foot, c0, r0)) if (!occ.get(key(c, r))) occ.set(key(c, r), { body: true, part: id }); for (const [name, dc, dr, side] of foot.pins) { const ref = refOf(name); occ.set(key(c0 + dc, r0 + dr), { ref, net: netOf[ref] || null, part: id, pin: name }); if (side === "b") for (const k of [1, 2]) if (!occ.get(key(c0 + dc, r0 + dr + k))) occ.set(key(c0 + dc, r0 + dr + k), { body: true, part: id }); } place[id] = { c: c0, r: r0, rot: foot.rot || 0 }; feet[id] = foot; };
  // 板子：有手動位置就用，否則放左上（body 在腳位上方或左方）
  let bc0 = Math.max(1, Math.ceil(-bf.body[0])), br0 = Math.max(1, Math.ceil(-bf.body[1]));
  if (manual.board) { if (fits(bf, manual.board.c, manual.board.r)) { bc0 = manual.board.c; br0 = manual.board.r; } else warnings.push({ code: "MANUAL_BAD", part: "board", brief: `${bf.title} 放到那裡會超出板子，退回自動位置` }); }
  if (!fits(bf, bc0, br0)) warnings.push({ code: "BOARD_TOO_BIG", brief: `${bf.title} 放不進 ${B.label}，改用大一點的板子` });
  const boardRefOf = (name) => { const base = name.replace(/\.\d$/, ""); if (POWER.has(base)) return "board:" + base; const ref = Object.keys(netOf).find((r) => r.startsWith("board:") && printedPinName(board, r) === name); if (ref) return ref; if (board === "devkit") { const v = DEVKIT_PINMAP[name]; if (v != null) return "board:" + v; } return "board:" + name; };
  put(bf, "board", bc0, br0, (name) => boardRefOf(name));
  // 手動擺過的元件先放（放不下就警示並退回自動），其餘依「和板子／已擺元件的連線」決定順序，掃描空位挑分數最好的
  const auto = [];
  for (const id of Object.keys(parts).sort()) {
    const m = manual[id]; if (!m) { auto.push(id); continue; }
    const foot = rotFoot(footFor(doc, id), m.rot || 0);
    if (fits(foot, m.c, m.r)) put(foot, id, m.c, m.r, (name) => id + ":" + name);
    else { warnings.push({ code: "MANUAL_BAD", part: id, brief: `${id} 放到那裡會和別的元件重疊或超出板子，退回自動位置` }); auto.push(id); }
  }
  const ids = auto.sort((a, b) => conn(b) - conn(a));
  function conn(id) { return Object.values(netPins).filter((refs) => refs.some((r) => r.split(":")[0] === id) && refs.some((r) => r.startsWith("board:"))).length; }
  const pinCell = (ref) => { for (const [k, o] of occ) if (o.ref === ref) { const [c, r] = k.split(",").map(Number); return [c, r]; } return null; };
  for (const id of ids) {
    const p = parts[id]; const foot = footFor(doc, id);
    let best = null;
    for (let r0 = 0; r0 < R; r0++) for (let c0 = 0; c0 < C; c0++) {
      if (!fits(foot, c0, r0)) continue;
      // 分數：這個元件每支腳到同網路已擺腳位的曼哈頓距離總和（越小越好），再加一點靠左上的偏好
      let s = 0, cnt = 0;
      for (const [name, dc, dr] of foot.pins) { const net = netOf[id + ":" + name]; if (!net) continue; for (const ref of netPins[net]) { if (ref.split(":")[0] === id) continue; const cell = pinCell(ref); if (!cell) continue; s += Math.abs(cell[0] - (c0 + dc)) + Math.abs(cell[1] - (r0 + dr)); cnt++; } }
      // 要留走線空間：腳位的四鄰若是別的元件腳位或本體，扣分（錫橋才有路可走）
      let crowd = 0;
      for (const [, dc, dr] of foot.pins) for (const [ec, er] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const o = occ.get(key(c0 + dc + ec, r0 + dr + er)); if (o && o.part !== id) crowd += o.ref ? 3 : 1; }
      const score = (cnt ? s / cnt : 0) * 10 + crowd * 4 + r0 * 0.3 + c0 * 0.1 + (cnt ? 0 : 50);
      if (!best || score < best.score) best = { c0, r0, score };
    }
    if (!best) { warnings.push({ code: "NO_SPACE", brief: `${id}（${PARTS[p.type]?.label || p.type}）放不下，換大板子`, part: id }); continue; }
    put(foot, id, best.c0, best.r0, (name) => id + ":" + name);
  }
  // ---- 3. 背面路由：每個網路用 A* 在空孔上走，接不到就正面跳線 ----
  const bridges = [];   // [[c,r],[c,r], net]
  const jumpers = [];   // [[c,r],[c,r], net]
  // 背面走線：空孔可走；別的網路的腳位或已走線的孔不能走；元件本體下方的孔（背面）可以走
  const free = (c, r, net) => { if (c < 0 || r < 0 || c >= C || r >= R) return false; const o = occ.get(key(c, r)); if (!o) return true; if (o.net) return o.net === net; return true; };
  const order = Object.entries(netPins).sort((a, b) => (isPower(a[1]) - isPower(b[1])) || (a[1].length - b[1].length));
  function isPower(refs) { return refs.some((r) => r.startsWith("board:") && POWER.has(r.slice(6))) ? 1 : 0; }
  for (const [net, refs] of order) {
    // 同網路的所有腳位孔；板子同名腳（devkit 兩個 GND、T-Display 兩個 3V3）板內本來就相通，直接當起點，不必彼此拉錫橋
    const all = []; for (const [k, o] of occ) if (o.ref && o.net === net) all.push({ c: k.split(",").map(Number), board: o.ref.startsWith("board:") });
    if (all.length < 2) continue;
    const seeds = all.filter((x) => x.board); const tree = new Set((seeds.length ? seeds : [all[0]]).map((x) => key(...x.c)));
    const todo = all.filter((x) => !tree.has(key(...x.c))).map((x) => x.c);
    while (todo.length) {
      // 挑離樹最近的腳
      todo.sort((a, b) => dist(a, tree) - dist(b, tree)); const t = todo.shift();
      const path = astar(t, tree, net);
      if (path) { for (let i = 0; i + 1 < path.length; i++) { bridges.push([path[i], path[i + 1], net]); } for (const c of path) { tree.add(key(...c)); const o = occ.get(key(...c)) || {}; occ.set(key(...c), { ...o, net, route: true }); } }
      else { const near = [...tree].map((k) => k.split(",").map(Number)).sort((a, b) => (Math.abs(a[0] - t[0]) + Math.abs(a[1] - t[1])) - (Math.abs(b[0] - t[0]) + Math.abs(b[1] - t[1])))[0]; jumpers.push([t, near, net]); tree.add(key(...t)); }
    }
  }
  function dist(c, tree) { let d = 1e9; for (const k of tree) { const [x, y] = k.split(",").map(Number); d = Math.min(d, Math.abs(x - c[0]) + Math.abs(y - c[1])); } return d; }
  function astar(start, goals, net) {
    const sk = key(...start); if (goals.has(sk)) return [start];
    const open = [{ c: start, g: 0, f: 0, dir: null }]; const came = new Map(); const gs = new Map([[sk, 0]]);
    const h = (c) => dist(c, goals);
    while (open.length) {
      open.sort((a, b) => a.f - b.f); const cur = open.shift(); const ck = key(...cur.c);
      if (goals.has(ck)) { const path = [cur.c]; let k = ck; while (came.has(k)) { k = came.get(k); path.push(k.split(",").map(Number)); } return path; }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = [cur.c[0] + dc, cur.c[1] + dr]; const nk = key(...nc);
        if (!goals.has(nk) && !free(nc[0], nc[1], net)) continue;
        // 不穿過元件腳（別的網路）與板子本體：free 已擋；錫橋不能斜走
        const turn = cur.dir && (cur.dir[0] !== dc || cur.dir[1] !== dr) ? 0.6 : 0;
        // 貼著別的網路腳位走容易連錫短路：相鄰有別網路的腳就加價
        let adj = 0; for (const [ec, er] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const o = occ.get(key(nc[0] + ec, nc[1] + er)); if (o && o.ref && o.net && o.net !== net) adj += 1.5; }
        const g = cur.g + 1 + turn + adj;
        if (g < (gs.get(nk) ?? 1e9)) { gs.set(nk, g); came.set(nk, ck); open.push({ c: nc, g, f: g + h(nc), dir: [dc, dr] }); }
      }
      if (open.length > 4000) return null;
    }
    return null;
  }
  // ---- 4. 警示：不同網路的錫橋在相鄰孔並排（容易連錫短路）；LED 極性提醒 ----
  const seg = new Set(bridges.map(([a, b, net]) => [key(...a), key(...b), net].join("|")));
  const netAt = (c, r) => occ.get(key(c, r))?.net || null;
  let risky = 0;
  for (const [a, b, net] of bridges) {
    const horiz = a[1] === b[1];
    for (const s of [-1, 1]) { const a2 = horiz ? [a[0], a[1] + s] : [a[0] + s, a[1]], b2 = horiz ? [b[0], b[1] + s] : [b[0] + s, b[1]]; const n1 = netAt(...a2), n2 = netAt(...b2); if (n1 && n1 === n2 && n1 !== net && (seg.has([key(...a2), key(...b2), n1].join("|")) || seg.has([key(...b2), key(...a2), n1].join("|")))) risky++; }
  }
  if (risky) warnings.push({ code: "ADJACENT_BRIDGES", brief: `有 ${Math.round(risky / 2)} 處不同網路的錫橋並排在相鄰孔，焊的時候錫量少一點、焊完用萬用電表量相鄰兩條不要相通` });
  if (Object.values(parts).some((p) => p.type === "led")) warnings.push({ code: "LED_POLARITY", brief: "LED 長腳（A，正極）插在標 A 的孔，短腳插 C；插反不會亮" });
  if (jumpers.length) warnings.push({ code: "JUMPERS", brief: `有 ${jumpers.length} 條正面跳線（單芯線），先焊元件再接跳線` });
  // ---- 5. 焊接順序：矮的先焊 ----
  const orderList = Object.keys(place).filter((id) => id !== "board").map((id) => ({ id, type: parts[id].type, tall: (FOOT[parts[id].type] || { tall: 2 }).tall, label: PARTS[parts[id].type]?.label || parts[id].type })).sort((a, b) => a.tall - b.tall || a.id.localeCompare(b.id));
  const steps = orderList.map((o, i) => `${i + 1}. ${o.id}（${o.label}）`); steps.push(`${steps.length + 1}. 排母：${bf.title} 用排母插上，先焊對角兩腳固定再焊其餘`); if (jumpers.length) steps.push(`${steps.length + 1}. 正面跳線 ${jumpers.length} 條`); steps.push(`${steps.length + 1}. 背面錫橋 ${bridges.length} 段，照背面圖一段一段連，連完用電表對照網路表`);
  // ---- 6. SVG ----
  const svgFront = renderFront({ C, R, occ, place, parts, bf, jumpers, netOf, feet });
  const svgBack = renderBack({ C, R, occ, bridges, netPins, parts, bf, place, feet });
  const pinCells = {}; const netCells = {}; for (const [k, o] of occ) if (o.ref) { const c = k.split(",").map(Number); pinCells[o.ref] = c; if (o.net) (netCells[o.net] = netCells[o.net] || []).push({ c, ref: o.ref }); }
  return { netCells, size, cols: C, rows: R, place, feet, manual: Object.keys(manual), bridges, jumpers, warnings, steps, nets: netPins, pinCells, svgFront, svgBack, w: (C + 1) * PITCH, h: (R + 1) * PITCH };
}

const COLORS = ["#d33", "#e90", "#2a7", "#36c", "#93c", "#0aa", "#c36", "#777"];
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CSS = `.pb-hole{fill:#fff;stroke:#b8a98a;stroke-width:.8}.pb-board{fill:#d9c9a3;stroke:#8a7a55}.pb-body{fill:rgba(255,255,255,.85);stroke:#333;stroke-width:1}.pb-pin{fill:#c9a227;stroke:#6b5a1e;stroke-width:.8}.pb-txt{font:7px -apple-system,PingFang TC,sans-serif;fill:#222}.pb-title{font:600 8px -apple-system,PingFang TC,sans-serif;fill:#111}.pb-bridge{stroke-width:5;stroke-linecap:round;opacity:.9}.pb-pad{fill:#aaa;stroke:#666;stroke-width:.6}.pb-jumper{fill:none;stroke-width:2.2;stroke-linecap:round}.pb-part{cursor:move}.pb-body.back{pointer-events:all}.pb-part.selected .pb-body{stroke:#0a84ff;stroke-width:2;stroke-dasharray:none}.pb-part.ghost{opacity:.55}`;
function holes(C, R) { let s = ""; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) s += `<circle class="pb-hole" cx="${(c + 1) * PITCH}" cy="${(r + 1) * PITCH}" r="2.4"/>`; return s; }
function renderFront({ C, R, occ, place, parts, bf, jumpers, netOf, feet }) {
  const W = (C + 1) * PITCH, H = (R + 1) * PITCH; let s = `<rect class="pb-board" x="2" y="2" width="${W - 4}" height="${H - 4}" rx="6"/>` + holes(C, R);
  const X = (c) => (c + 1) * PITCH, Y = (r) => (r + 1) * PITCH;
  for (const [id, p] of Object.entries(place)) {
    const foot = feet[id] || (id === "board" ? bf : { pins: [], body: [0, 0, 1, 1] });
    const [bx, by, bw, bh] = foot.body;
    s += `<g class="pb-part" data-id="${esc(id)}"><rect class="pb-body" x="${X(p.c + bx) - 0}" y="${Y(p.r + by)}" width="${bw * PITCH}" height="${bh * PITCH}" rx="3"/>`;
    for (const [name, dc, dr, side] of foot.pins) { const x = X(p.c + dc), y = Y(p.r + dr); s += `<rect class="pb-pin" x="${x - 3}" y="${y - 3}" width="6" height="6"/>`; if (side === "b") s += `<text class="pb-txt" x="${x}" y="${y + 5}" text-anchor="end" transform="rotate(-90 ${x} ${y + 5})">${esc(name)}</text>`; else if (name.length <= 1) s += `<text class="pb-txt" x="${x}" y="${y - 5}" text-anchor="middle">${esc(name)}</text>`; else s += `<text class="pb-txt" x="${x}" y="${y - 5}" text-anchor="start" transform="rotate(-90 ${x} ${y - 5})">${esc(name)}</text>`; }
    const label = id === "board" ? bf.title : id + (parts[id].attrs?.value ? " " + fmtValue(parts[id]) : "");
    s += id === "board" ? `<text class="pb-title" x="${X(p.c + bx) + 3}" y="${bf.titleBelow ? Y(p.r + 1) + 3 : Y(p.r + by) + 9}">${esc(label)}</text>` : `<text class="pb-title" x="${X(p.c + bx)}" y="${Y(p.r + by) - 2}">${esc(label)}</text>`;
    s += `</g>`;
  }
  jumpers.forEach(([a, b, net], i) => { const col = COLORS[i % COLORS.length]; const mx = (X(a[0]) + X(b[0])) / 2, my = (Y(a[1]) + Y(b[1])) / 2 - 10; s += `<path class="pb-jumper" stroke="${col}" d="M${X(a[0])},${Y(a[1])} Q${mx},${my} ${X(b[0])},${Y(b[1])}"/>`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${CSS}</style>${s}<text class="pb-title" x="${W / 2}" y="${H - 3}" text-anchor="middle">正面（元件面）</text></svg>`;
}
function renderBack({ C, R, occ, bridges, netPins, parts, bf, place, feet }) {
  const W = (C + 1) * PITCH, H = (R + 1) * PITCH;
  // 背面鏡像：x 翻轉
  const X = (c) => W - (c + 1) * PITCH, Y = (r) => (r + 1) * PITCH;
  let s = `<rect class="pb-board" x="2" y="2" width="${W - 4}" height="${H - 4}" rx="6"/>` + holes(C, R).replace(/cx="([\d.]+)"/g, (m, v) => `cx="${W - Number(v)}"`);
  const netIdx = Object.fromEntries(Object.keys(netPins).map((n, i) => [n, i]));
  for (const [k, o] of occ) if (o.ref) { const [c, r] = k.split(",").map(Number); s += `<circle class="pb-pad" cx="${X(c)}" cy="${Y(r)}" r="4.2"/>`; }
  for (const [a, b, net] of bridges) s += `<line class="pb-bridge" stroke="${COLORS[netIdx[net] % COLORS.length]}" x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"/>`;
  for (const [k, o] of occ) if (o.ref) { const [c, r] = k.split(",").map(Number); const name = o.pin; s += name.length <= 1 ? `<text class="pb-txt" x="${X(c)}" y="${Y(r) + 11}" text-anchor="middle" fill="#333">${esc(name)}</text>` : `<text class="pb-txt" x="${X(c) + 3}" y="${Y(r) + 6}" text-anchor="end" fill="#333" transform="rotate(-90 ${X(c) + 3} ${Y(r) + 6})">${esc(name)}</text>`; }
  for (const [id, p] of Object.entries(place)) { const foot = feet[id] || (id === "board" ? bf : { body: [0, 0, 1, 1] }); const [bx, by, bw, bh] = foot.body; s += `<g class="pb-part" data-id="${esc(id)}"><rect class="pb-body back" fill="none" stroke="#999" stroke-dasharray="3 2" x="${X(p.c + bx + bw) }" y="${Y(p.r + by)}" width="${bw * PITCH}" height="${bh * PITCH}" rx="3"/>` + `<text class="pb-title" x="${X(p.c + bx + bw) + 3}" y="${Y(p.r + by) + 9}" fill="#666">${esc(id === "board" ? bf.title : id)}</text></g>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${CSS}</style>${s}<text class="pb-title" x="${W / 2}" y="${H - 3}" text-anchor="middle">背面（焊接面，左右鏡像）</text></svg>`;
}

/** 對帳：錫橋＋跳線連出來的連通集合，是否與網路表一致（每個網路的腳位同一群、不同網路不同群）。 */
export function checkPerfboard(res) {
  const par = new Map(); const find = (x) => { if (!par.has(x)) par.set(x, x); while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; }; const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
  for (const [a, b] of res.bridges) union(key(...a), key(...b)); for (const [a, b] of res.jumpers) union(key(...a), key(...b));
  // 板子同名腳板內相通
  for (const list of Object.values(res.netCells)) { const byRef = {}; for (const { c, ref } of list) if (ref.startsWith("board:")) { if (byRef[ref]) union(key(...byRef[ref]), key(...c)); else byRef[ref] = c; } }
  const problems = []; const groupNet = {};
  for (const [net, refs] of Object.entries(res.nets)) {
    const cells = (res.netCells[net] || []).map((x) => x.c);
    const placed = new Set((res.netCells[net] || []).map((x) => x.ref)); const missing = refs.filter((r) => !placed.has(r));
    if (missing.length) problems.push(`${net}：有腳位沒擺上板（${missing.join(" ")}）`);
    const groups = new Set(cells.map((c) => find(key(...c))));
    if (groups.size > 1) problems.push(`${net}：腳位沒全部連起來（分成 ${groups.size} 群）`);
    for (const g of groups) { if (groupNet[g] && groupNet[g] !== net) problems.push(`${net} 和 ${groupNet[g]} 連在一起（短路）`); groupNet[g] = net; }
  }
  return { ok: !problems.length, problems, bridges: res.bridges.length, jumpers: res.jumpers.length };
}
