// analog-elements.js — 自繪的類比元件（Wokwi 元件庫沒有）：電解電容、二極體、NPN 電晶體（TO-92）、NE555（DIP-8）。
// 尺寸與腳位要和 catalog.js 的 CATALOG／PIN_TABLE 一致。屬性：capacitor voltage、diode on、npn on、ne555 out。
const SVGH = `xmlns="http://www.w3.org/2000/svg"`;
const PIN = (x, y, n) => `<rect x="${x - 2.5}" y="${y - 10}" width="5" height="10" fill="#c9a227" stroke="#7a6418" stroke-width=".6"/><text x="${x}" y="${y - 12}" fill="#333" font-size="6" text-anchor="middle" font-family="sans-serif">${n}</text>`;

// 2026-11-08 起腳位都對齊麵包板孔距 9.6 px（2.54 mm）：電容／電晶體腳距 1 格、二極體 6 格、DIP-8 腳距 1 格且兩排相距 3 格（跨中央溝槽插 e／f 列）。
const P = 9.6;
const DIP = (x, y, up) => `<rect x="${x - 2}" y="${up ? y : y - 5}" width="4" height="5" fill="#c9a227" stroke="#7a6418" stroke-width=".5"/>`;
class SimCapacitor extends HTMLElement {   // 36×60，腳在下緣、相距 1 格：+ (13.2,60)、- (22.8,60)
  static get observedAttributes() { return ["voltage", "value"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "+", x: 13.2, y: 60 }, { name: "-", x: 22.8, y: 60 }]; }
  render() {
    const v = Number(this.getAttribute("voltage") || 0), val = this.getAttribute("value") || "100µF";
    const fill = Math.max(0, Math.min(1, v / 5));
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="36" height="60" viewBox="0 0 36 60">
      <rect x="4" y="2" width="28" height="44" rx="4" fill="#1d2b6b" stroke="#0e1540"/>
      <rect x="4" y="2" width="28" height="6" rx="2" fill="#3b4a9a"/>
      <rect x="24" y="8" width="7" height="36" fill="#e8e8e8"/><text x="27.5" y="30" fill="#1d2b6b" font-size="8" text-anchor="middle" font-family="sans-serif" transform="rotate(-90 27.5 30)">− − −</text>
      <text x="14" y="24" fill="#fff" font-size="6.5" text-anchor="middle" font-family="sans-serif">${val}</text><text x="14" y="33" fill="#9fb0ff" font-size="5.5" text-anchor="middle" font-family="sans-serif">25V</text>
      <rect x="6" y="${40 - fill * 10}" width="4" height="${fill * 10}" fill="#ffd54a" opacity=".85"/>
      <line x1="13.2" y1="46" x2="13.2" y2="52" stroke="#888" stroke-width="2"/><line x1="22.8" y1="46" x2="22.8" y2="52" stroke="#888" stroke-width="2"/>
      ${PIN(13.2, 60, "+")}${PIN(22.8, 60, "−")}</svg>`;
  }
}
class SimDiode extends HTMLElement {   // 57.6×22，腳在左右、相距 6 格：A (0,11)、K (57.6,11)
  static get observedAttributes() { return ["on", "model"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "A", x: 0, y: 11 }, { name: "K", x: 57.6, y: 11 }]; }
  render() {
    const on = this.getAttribute("on") === "true", model = this.getAttribute("model") || "1N4007";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="57.6" height="22" viewBox="0 0 57.6 22">
      <line x1="0" y1="11" x2="57.6" y2="11" stroke="#999" stroke-width="2.2"/>
      <rect x="15" y="4" width="28" height="14" rx="2" fill="#1a1a1a" stroke="#000"/>
      <rect x="36" y="4" width="4" height="14" fill="#ddd"/>
      <text x="28" y="13.5" fill="#bbb" font-size="5" text-anchor="middle" font-family="sans-serif">${model}</text>
      ${on ? `<circle cx="8" cy="11" r="3" fill="#ffb300" opacity=".9"/>` : ""}
      <text x="4" y="5" fill="#333" font-size="5.5" font-family="sans-serif">A</text><text x="50" y="5" fill="#333" font-size="5.5" font-family="sans-serif">K</text></svg>`;
  }
}
class SimNPN extends HTMLElement {   // 28.8×40 TO-92，腳在下緣、相距 1 格：E (4.8,40)、B (14.4,40)、C (24,40)
  static get observedAttributes() { return ["on", "model"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "E", x: 4.8, y: 40 }, { name: "B", x: 14.4, y: 40 }, { name: "C", x: 24, y: 40 }]; }
  render() {
    const on = this.getAttribute("on") === "true", model = this.getAttribute("model") || "2N2222";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="28.8" height="40" viewBox="0 0 28.8 40">
      <path d="M1.5 24 L1.5 14 A12.9 12.9 0 0 1 27.3 14 L27.3 24 Z" fill="#222" stroke="#000"/>
      <rect x="1.5" y="22" width="25.8" height="3" fill="#111"/>
      <text x="14.4" y="15" fill="#ccc" font-size="5" text-anchor="middle" font-family="sans-serif">${model}</text>
      <text x="14.4" y="21" fill="#888" font-size="4.5" text-anchor="middle" font-family="sans-serif">NPN</text>
      ${on ? `<circle cx="24" cy="5" r="2.5" fill="#ffb300" opacity=".9"/>` : ""}
      <line x1="4.8" y1="25" x2="4.8" y2="34" stroke="#999" stroke-width="1.6"/><line x1="14.4" y1="25" x2="14.4" y2="34" stroke="#999" stroke-width="1.6"/><line x1="24" y1="25" x2="24" y2="34" stroke="#999" stroke-width="1.6"/>
      <text x="4.8" y="39.5" fill="#333" font-size="5" text-anchor="middle" font-family="sans-serif">E</text><text x="14.4" y="39.5" fill="#333" font-size="5" text-anchor="middle" font-family="sans-serif">B</text><text x="24" y="39.5" fill="#333" font-size="5" text-anchor="middle" font-family="sans-serif">C</text></svg>`;
  }
}
// DIP-8：38.4×28.8，腳距 1 格，下排 1～4 在 y=28.8、上排 8～5 在 y=0（x = 4.8＋9.6k），兩排相距 3 格
const dipX = (k) => 4.8 + P * k;
function dipSvg(title, sub, top, bot, extra = "") {
  return `<svg ${SVGH} width="38.4" height="28.8" viewBox="0 0 38.4 28.8">
      <rect x="0.5" y="4" width="37.4" height="20.8" rx="1.5" fill="#2a2a2a" stroke="#000"/>
      <path d="M0.5 11.4 a3 3 0 0 1 0 6" fill="#555"/><circle cx="4.6" cy="20.6" r="1.5" fill="#111" stroke="#555" stroke-width=".5"/>
      <text x="20" y="13.6" fill="#ddd" font-size="6" text-anchor="middle" font-family="sans-serif">${title}</text>
      <text x="20" y="20" fill="#888" font-size="3.8" text-anchor="middle" font-family="sans-serif">${sub}</text>
      ${top.map((n, k) => DIP(dipX(k), 0, true) + `<text x="${dipX(k)}" y="8" fill="#9a9a9a" font-size="2.6" text-anchor="middle" font-family="sans-serif">${n}</text>`).join("")}
      ${bot.map((n, k) => DIP(dipX(k), 28.8, false) + `<text x="${dipX(k)}" y="23.4" fill="#9a9a9a" font-size="2.6" text-anchor="middle" font-family="sans-serif">${n}</text>`).join("")}
      ${extra}</svg>`;
}
const dipPins = (top, bot) => [...bot.map((n, k) => ({ name: n, x: dipX(k), y: 28.8 })), ...top.map((n, k) => ({ name: n, x: dipX(k), y: 0 })).reverse()];
class SimNE555 extends HTMLElement {   // DIP-8：下排 GND TRIG OUT RESET、上排 VCC DIS THR CTRL
  static get observedAttributes() { return ["out"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return dipPins(["VCC", "DIS", "THR", "CTRL"], ["GND", "TRIG", "OUT", "RESET"]); }
  render() {
    const out = this.getAttribute("out") === "true";
    this.shadowRoot.innerHTML = dipSvg("NE555", "TIMER", ["VCC", "DIS", "THR", "CTRL"], ["GND", "TRIG", "OUT", "RST"], `<circle cx="34" cy="8.5" r="1.6" fill="${out ? "#3f3" : "#243"}"/>`);
  }
}
class SimACSource extends HTMLElement {   // 60×70，腳在下緣、相距 2 格：+ (20.4,70)、− (39.6,70)
  static get observedAttributes() { return ["voltage", "vpk", "freq"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "+", x: 20.4, y: 70 }, { name: "-", x: 39.6, y: 70 }]; }
  render() {
    const v = Number(this.getAttribute("voltage") || 0), vpk = this.getAttribute("vpk") || "5", f = this.getAttribute("freq") || "50";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="60" height="70" viewBox="0 0 60 70">
      <rect x="2" y="2" width="56" height="52" rx="6" fill="#2b2b2b" stroke="#111"/>
      <circle cx="30" cy="24" r="15" fill="#111" stroke="#888"/><path d="M19 24 q5.5 -10 11 0 t11 0" fill="none" stroke="#3f3" stroke-width="2"/>
      <text x="30" y="48" fill="#ddd" font-size="6.5" text-anchor="middle" font-family="sans-serif">${vpk} Vpk ${f} Hz</text>
      <rect x="44" y="${24 - Math.max(-12, Math.min(12, v * 2.4))}" width="4" height="${Math.abs(Math.max(-12, Math.min(12, v * 2.4)))}" fill="#ffd54a" opacity=".8"/>
      <line x1="20.4" y1="54" x2="20.4" y2="62" stroke="#888" stroke-width="2"/><line x1="39.6" y1="54" x2="39.6" y2="62" stroke="#888" stroke-width="2"/>
      ${PIN(20.4, 70, "+")}${PIN(39.6, 70, "−")}</svg>`;
  }
}
class SimLM358 extends HTMLElement {   // DIP-8：下排 OUT1 IN1- IN1+ GND、上排 VCC OUT2 IN2- IN2+
  static get observedAttributes() { return ["out1", "out2"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return dipPins(["VCC", "OUT2", "IN2-", "IN2+"], ["OUT1", "IN1-", "IN1+", "GND"]); }
  render() { this.shadowRoot.innerHTML = dipSvg("LM358", "DUAL OP-AMP", ["VCC", "OUT2", "IN2−", "IN2+"], ["OUT1", "IN1−", "IN1+", "GND"]); }
}
class SimGate extends HTMLElement {   // 38.4×28.8（單閘教學版，DIP 外形）：下排 A(4.8) B(14.4) Y(33.6)、上排 VCC(4.8) GND(33.6)
  static get observedAttributes() { return ["kind", "y"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "A", x: 4.8, y: 28.8 }, { name: "B", x: 14.4, y: 28.8 }, { name: "Y", x: 33.6, y: 28.8 }, { name: "VCC", x: 4.8, y: 0 }, { name: "GND", x: 33.6, y: 0 }]; }
  render() {
    const kind = this.getAttribute("kind") || "AND", on = this.getAttribute("y") === "true";
    const g = kind === "OR" || kind === "NOR" ? `<path d="M13 9 q5 5.4 0 10.8 q8 0 12 -5.4 q-4 -5.4 -12 -5.4 z" fill="#eee" stroke="#333" stroke-width=".6"/>` : kind === "XOR" ? `<path d="M13 9 q5 5.4 0 10.8 q8 0 12 -5.4 q-4 -5.4 -12 -5.4 z" fill="#eee" stroke="#333" stroke-width=".6"/><path d="M11 9 q5 5.4 0 10.8" fill="none" stroke="#333" stroke-width=".6"/>` : kind === "NOT" ? `<path d="M13 9 L24 14.4 L13 19.8 z" fill="#eee" stroke="#333" stroke-width=".6"/>` : `<path d="M13 9 h6 a5.4 5.4 0 0 1 0 10.8 h-6 z" fill="#eee" stroke="#333" stroke-width=".6"/>`;
    const bubble = /^(NAND|NOR|NOT)$/.test(kind) ? `<circle cx="26.4" cy="14.4" r="1.4" fill="#eee" stroke="#333" stroke-width=".5"/>` : "";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="38.4" height="28.8" viewBox="0 0 38.4 28.8">
      <rect x="0.5" y="4" width="37.4" height="20.8" rx="1.5" fill="#2a2a2a" stroke="#000"/>${g}${bubble}
      <text x="31" y="9" fill="#bbb" font-size="3.2" text-anchor="middle" font-family="sans-serif">74HC</text><text x="31" y="13" fill="#bbb" font-size="3.2" text-anchor="middle" font-family="sans-serif">${kind}</text>
      <circle cx="33" cy="19" r="1.6" fill="${on ? "#3f3" : "#243"}"/>
      ${DIP(4.8, 0, true)}${DIP(33.6, 0, true)}${DIP(4.8, 28.8, false)}${DIP(14.4, 28.8, false)}${DIP(33.6, 28.8, false)}
      <text x="4.8" y="23.4" fill="#9a9a9a" font-size="2.8" text-anchor="middle" font-family="sans-serif">A</text><text x="14.4" y="23.4" fill="#9a9a9a" font-size="2.8" text-anchor="middle" font-family="sans-serif">B</text><text x="33.6" y="23.4" fill="#9a9a9a" font-size="2.8" text-anchor="middle" font-family="sans-serif">Y</text>
      <text x="4.8" y="8" fill="#9a9a9a" font-size="2.6" text-anchor="middle" font-family="sans-serif">VCC</text></svg>`;
  }
}
if (typeof customElements !== "undefined") {
  if (!customElements.get("sim-acsource")) customElements.define("sim-acsource", SimACSource);
  if (!customElements.get("sim-lm358")) customElements.define("sim-lm358", SimLM358);
  if (!customElements.get("sim-gate")) customElements.define("sim-gate", SimGate);
  if (!customElements.get("sim-capacitor")) customElements.define("sim-capacitor", SimCapacitor);
  if (!customElements.get("sim-diode")) customElements.define("sim-diode", SimDiode);
  if (!customElements.get("sim-npn")) customElements.define("sim-npn", SimNPN);
  if (!customElements.get("sim-ne555")) customElements.define("sim-ne555", SimNE555);
}
