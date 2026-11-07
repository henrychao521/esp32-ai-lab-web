// symbols.js — 電路簡圖符號庫（IEC 風格，課本用的畫法）。純函式，Node 可測。
// 每個符號：{ w, h, pins: { 腳名: { x, y, dir } }, svg(state) }，座標以符號左上角為原點，dir 是導線離開的方向（l/r/t/b）。
// 腳位點（x, y）就是導線要接上的位置；符號本身已含 STUB 長的腳線。
// 模組類（OLED、HC-SR04、DHT22…）沒有標準符號，一律畫成「有腳位名稱的方塊」（blockSymbol）。
import { PARTS } from "./circuit.js";

export const STUB = 16;          // 腳線長度
const PITCH = 20;                // 方塊腳位間距
const FONT = "font-family='-apple-system,PingFang TC,Noto Sans TC,Helvetica,Arial,sans-serif'";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const txt = (x, y, s, opt = {}) => `<text x="${x}" y="${y}" ${FONT} font-size="${opt.size || 10}" text-anchor="${opt.anchor || "middle"}" dominant-baseline="${opt.base || "middle"}" fill="${opt.fill || "var(--sch-ink,#1b1f24)"}"${opt.weight ? ` font-weight="${opt.weight}"` : ""}>${esc(s)}</text>`;

/** 方塊符號：left/right/top/bottom 各一串腳名；title 寫在方塊中央。 */
export function blockSymbol({ title, left = [], right = [], top = [], bottom = [], minW = 70 }) {
  const rows = Math.max(left.length, right.length, 1);
  const cols = Math.max(top.length, bottom.length, 0);
  // 文字寬度估計（CJK 10px、其他 6px），方塊要放得下「左腳名＋標題＋右腳名」不重疊
  const tw = (t) => [...String(t)].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 10 : 6), 0);
  const maxL = Math.max(0, ...left.map(tw)), maxR = Math.max(0, ...right.map(tw));
  const bodyW = Math.max(minW, cols * PITCH + 20, maxL + tw(title) + maxR + 28);
  const bodyH = Math.max(rows * PITCH + 10, 40);
  const x0 = STUB, y0 = (top.length ? STUB : 0);
  const w = bodyW + STUB * 2, h = bodyH + (top.length ? STUB : 0) + (bottom.length ? STUB : 0);
  const pins = {};
  left.forEach((n, i) => { pins[n] = { x: 0, y: y0 + 15 + i * PITCH, dir: "l" }; });
  right.forEach((n, i) => { pins[n] = { x: w, y: y0 + 15 + i * PITCH, dir: "r" }; });
  top.forEach((n, i) => { pins[n] = { x: x0 + 15 + i * PITCH, y: 0, dir: "t" }; });
  bottom.forEach((n, i) => { pins[n] = { x: x0 + 15 + i * PITCH, y: h, dir: "b" }; });
  const svg = () => {
    let s = `<rect x="${x0}" y="${y0}" width="${bodyW}" height="${bodyH}" rx="2" class="sch-body"/>`;
    for (const [n, p] of Object.entries(pins)) {
      if (p.dir === "l") s += `<line x1="0" y1="${p.y}" x2="${x0}" y2="${p.y}" class="sch-pin"/>` + txt(x0 + 4, p.y, n, { anchor: "start", size: 9 });
      if (p.dir === "r") s += `<line x1="${w - STUB}" y1="${p.y}" x2="${w}" y2="${p.y}" class="sch-pin"/>` + txt(w - STUB - 4, p.y, n, { anchor: "end", size: 9 });
      if (p.dir === "t") s += `<line x1="${p.x}" y1="0" x2="${p.x}" y2="${y0}" class="sch-pin"/>` + `<text x="${p.x}" y="${y0 + 4}" ${FONT} font-size="8" text-anchor="start" transform="rotate(90 ${p.x} ${y0 + 4})" fill="var(--sch-ink,#1b1f24)">${esc(n)}</text>`;
      if (p.dir === "b") s += `<line x1="${p.x}" y1="${h - STUB}" x2="${p.x}" y2="${h}" class="sch-pin"/>` + `<text x="${p.x}" y="${h - STUB - 4}" ${FONT} font-size="8" text-anchor="end" transform="rotate(90 ${p.x} ${h - STUB - 4})" fill="var(--sch-ink,#1b1f24)">${esc(n)}</text>`;
    }
    s += txt(x0 + bodyW / 2, y0 + bodyH / 2, title, { size: 10, weight: 600 });
    return s;
  };
  return { w, h, pins, svg, block: true };
}

/** 兩腳水平元件的共用外框：左腳 a、右腳 b，中間 body 寬 BODY。 */
function twoPin(a, b, body, draw) {
  const w = STUB * 2 + body, h = 30;
  return { w, h, pins: { [a]: { x: 0, y: 15, dir: "l" }, [b]: { x: w, y: 15, dir: "r" } },
    svg: (st = {}) => `<line x1="0" y1="15" x2="${STUB}" y2="15" class="sch-pin"/><line x1="${w - STUB}" y1="15" x2="${w}" y2="15" class="sch-pin"/>` + draw(STUB, st) };
}

export const SYMBOLS = {
  // IEC 60617：電阻是長方形
  resistor: () => twoPin("1", "2", 40, (x) => `<rect x="${x}" y="9" width="40" height="12" class="sch-body"/>`),
  // LED：二極體＋兩支小箭頭；亮時三角形填色
  led: () => twoPin("A", "C", 36, (x, st) => {
    const c = x + 18; const fill = st.on ? (st.color || "#e33") : "none"; const burned = st.burned;
    return `<line x1="${x}" y1="15" x2="${c - 8}" y2="15" class="sch-pin"/><polygon points="${c - 8},6 ${c - 8},24 ${c + 8},15" class="sch-body" fill="${fill}"/><line x1="${c + 8}" y1="6" x2="${c + 8}" y2="24" class="sch-body"/><line x1="${c + 8}" y1="15" x2="${x + 36}" y2="15" class="sch-pin"/>` +
      `<g class="sch-arrows" transform="translate(${c + 1},1)"><path d="M0,4 l6,-6 M3,-2 l3,0 l0,3 M6,6 l6,-6 M9,0 l3,0 l0,3" class="sch-body"/></g>` +
      (burned ? `<path d="M${c - 10},4 l20,22 M${c + 10},4 l-20,22" stroke="#c33" stroke-width="2"/>` : "") +
      (st.on && !burned ? `<circle cx="${c}" cy="15" r="14" fill="${st.color || "#e33"}" opacity=".18"/>` : "");
  }),
  // 蜂鳴器：半圓＋兩腳
  buzzer: () => twoPin("1", "2", 36, (x, st) => `<path d="M${x + 4},21 a14,14 0 0 1 28,0 z" class="sch-body"${st.on ? ' fill="#fbbf24"' : ""}/><line x1="${x}" y1="15" x2="${x + 4}" y2="15" class="sch-pin"/><line x1="${x + 32}" y1="15" x2="${x + 36}" y2="15" class="sch-pin"/>` + (st.on ? `<path d="M${x + 24},4 a10,10 0 0 1 0,22 M${x + 28},0 a16,16 0 0 1 0,30" class="sch-body" opacity=".5"/>` : "")),
  // 按鍵（常開）：兩個接點＋斜桿；按下時桿子壓平。腳 1.l/1.r 是同一點、2.l/2.r 是同一點
  pushbutton: () => {
    const w = STUB * 2 + 40, h = 30;
    return { w, h, pins: { 1: { x: 0, y: 20, dir: "l" }, 2: { x: w, y: 20, dir: "r" } }, alias: { "1.l": "1", "1.r": "1", "2.l": "2", "2.r": "2" },
      svg: (st = {}) => `<line x1="0" y1="20" x2="${STUB + 8}" y2="20" class="sch-pin"/><line x1="${w - STUB - 8}" y1="20" x2="${w}" y2="20" class="sch-pin"/><circle cx="${STUB + 8}" cy="20" r="2" class="sch-dot"/><circle cx="${w - STUB - 8}" cy="20" r="2" class="sch-dot"/>` +
        (st.pressed ? `<line x1="${STUB + 8}" y1="20" x2="${w - STUB - 8}" y2="20" class="sch-body"/>` : `<line x1="${STUB + 8}" y1="20" x2="${w - STUB - 8}" y2="10" class="sch-body"/>`) +
        `<line x1="${w / 2}" y1="${st.pressed ? 20 : 15}" x2="${w / 2}" y2="4" class="sch-body"/><line x1="${w / 2 - 6}" y1="4" x2="${w / 2 + 6}" y2="4" class="sch-body"/>` };
  },
  // 滑動開關 SPDT：2 是共用腳（左），1、3 在右
  "slide-switch": () => {
    const w = STUB * 2 + 40, h = 40;
    return { w, h, pins: { 2: { x: 0, y: 20, dir: "l" }, 1: { x: w, y: 10, dir: "r" }, 3: { x: w, y: 30, dir: "r" } },
      svg: (st = {}) => `<line x1="0" y1="20" x2="${STUB + 6}" y2="20" class="sch-pin"/><line x1="${w - STUB - 6}" y1="10" x2="${w}" y2="10" class="sch-pin"/><line x1="${w - STUB - 6}" y1="30" x2="${w}" y2="30" class="sch-pin"/><circle cx="${STUB + 6}" cy="20" r="2" class="sch-dot"/><circle cx="${w - STUB - 6}" cy="10" r="2" class="sch-dot"/><circle cx="${w - STUB - 6}" cy="30" r="2" class="sch-dot"/>` +
        `<line x1="${STUB + 6}" y1="20" x2="${w - STUB - 8}" y2="${st.value ? 30 : 10}" class="sch-body"/>` };
  },
  // 可變電阻：直立電阻＋滑動箭頭（VCC 上、GND 下、SIG 右）
  potentiometer: () => {
    const w = STUB * 2 + 30, h = STUB * 2 + 50;
    return { w, h, pins: { VCC: { x: 15 + STUB - 8, y: 0, dir: "t" }, GND: { x: 15 + STUB - 8, y: h, dir: "b" }, SIG: { x: w, y: h / 2, dir: "r" } },
      svg: (st = {}) => { const cx = 15 + STUB - 8; return `<line x1="${cx}" y1="0" x2="${cx}" y2="${STUB}" class="sch-pin"/><line x1="${cx}" y1="${h - STUB}" x2="${cx}" y2="${h}" class="sch-pin"/><rect x="${cx - 6}" y="${STUB}" width="12" height="50" class="sch-body"/>` +
        `<line x1="${w}" y1="${h / 2}" x2="${cx + 14}" y2="${h / 2}" class="sch-pin"/><polygon points="${cx + 14},${h / 2} ${cx + 20},${h / 2 - 4} ${cx + 20},${h / 2 + 4}" class="sch-dot"/>` + txt(cx + 26, h / 2 - 10, Math.round((st.value ?? 0.5) * 100) + "%", { size: 8, anchor: "start" }); } };
  },
  // 步進馬達：方塊＋ M 圓圈
  stepper: () => blockSymbol({ title: "步進馬達", left: ["A-", "A+", "B+", "B-"] }),
  servo: () => blockSymbol({ title: "伺服馬達", left: ["PWM", "V+", "GND"] }),
  "photoresistor-sensor": () => blockSymbol({ title: "光敏模組", left: ["VCC", "GND", "DO", "AO"] }),
  "led-bar-graph": () => blockSymbol({ title: "LED 長條", left: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"], right: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"], minW: 60 }),
  "rgb-led": () => blockSymbol({ title: "RGB LED", left: ["R", "G", "B"], right: ["COM"] }),
  ssd1306: () => blockSymbol({ title: "OLED SSD1306", left: ["DATA", "CLK", "DC", "RST", "CS"], right: ["3V3", "VIN", "GND"], minW: 90 }),
  lcd1602: () => blockSymbol({ title: "LCD1602 (I2C)", left: ["SDA", "SCL"], right: ["VCC", "GND"], minW: 90 }),
  "hc-sr04": () => blockSymbol({ title: "HC-SR04", left: ["TRIG", "ECHO"], right: ["VCC", "GND"], minW: 80 }),
  dht22: () => blockSymbol({ title: "DHT22", left: ["SDA", "NC"], right: ["VCC", "GND"] }),
  "neopixel-strip": () => blockSymbol({ title: "NeoPixel ×8", left: ["DIN"], right: ["DOUT", "VCC", "GND"], minW: 80 }),
  pir: () => blockSymbol({ title: "PIR", left: ["OUT"], right: ["VCC", "GND"] }),
  relay: () => blockSymbol({ title: "繼電器模組", left: ["IN", "VCC", "GND"], right: ["NO", "COM", "NC"], minW: 80 }),
  joystick: () => blockSymbol({ title: "搖桿", left: ["VERT", "HORZ", "SEL"], right: ["VCC", "GND"] }),
};

/** 取得某元件型別的符號；沒有專屬畫法的用方塊（腳位照 PARTS 表）。 */
export function symbolFor(type) {
  if (SYMBOLS[type]) return SYMBOLS[type]();
  const pins = (PARTS[type] || { pins: [] }).pins;
  return blockSymbol({ title: (PARTS[type] || {}).label || type, left: pins });
}

/** 板子方塊：右側列訊號腳，上側電源腳，下側 GND。used = 有接線的腳（印刷名）；showAll 時列全部。 */
export function boardSymbol(name, signalPins, powerPins, gndPins) {
  return blockSymbol({ title: name, right: signalPins, top: powerPins, bottom: gndPins, minW: Math.max(90, name.length * 8 + 24) });
}

/** 電源軌符號（往上）：短橫線＋標籤；回傳 svg 與高度。錨點在 (x, y) 腳位點，線往上畫。 */
export function railSymbol(x, y, label) {
  return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y - 14}" class="sch-wire"/><line x1="${x - 8}" y1="${y - 14}" x2="${x + 8}" y2="${y - 14}" class="sch-body" stroke-width="2"/>` + txt(x, y - 22, label, { size: 9, weight: 600 });
}
/** 接地符號（往下）：三條漸短橫線。 */
export function groundSymbol(x, y) {
  return `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + 12}" class="sch-wire"/><line x1="${x - 9}" y1="${y + 12}" x2="${x + 9}" y2="${y + 12}" class="sch-body" stroke-width="2"/><line x1="${x - 6}" y1="${y + 16}" x2="${x + 6}" y2="${y + 16}" class="sch-body" stroke-width="2"/><line x1="${x - 3}" y1="${y + 20}" x2="${x + 3}" y2="${y + 20}" class="sch-body" stroke-width="2"/>`;
}

export const SCH_CSS = `
.sch-body{fill:none;stroke:var(--sch-ink,#1b1f24);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.sch-pin{stroke:var(--sch-ink,#1b1f24);stroke-width:1.2}
.sch-dot{fill:var(--sch-ink,#1b1f24)}
.sch-wire{fill:none;stroke:var(--sch-wire,#0b5fff);stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round}
.sch-junction{fill:var(--sch-wire,#0b5fff)}
.sch-label{font-size:10px;fill:var(--sch-muted,#6b7280)}
.sch-part.selected .sch-body{stroke:var(--sch-accent,#ff6a2b);stroke-width:2}
.sch-part{cursor:pointer}
`;
