// analog-elements.js — 自繪的類比元件（Wokwi 元件庫沒有）：電解電容、二極體、NPN 電晶體（TO-92）、NE555（DIP-8）。
// 尺寸與腳位要和 catalog.js 的 CATALOG／PIN_TABLE 一致。屬性：capacitor voltage、diode on、npn on、ne555 out。
const SVGH = `xmlns="http://www.w3.org/2000/svg"`;
const PIN = (x, y, n) => `<rect x="${x - 2.5}" y="${y - 10}" width="5" height="10" fill="#c9a227" stroke="#7a6418" stroke-width=".6"/><text x="${x}" y="${y - 12}" fill="#333" font-size="6" text-anchor="middle" font-family="sans-serif">${n}</text>`;

class SimCapacitor extends HTMLElement {   // 36×60，腳在下緣：+ (10,60)、- (26,60)
  static get observedAttributes() { return ["voltage", "value"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "+", x: 10, y: 60 }, { name: "-", x: 26, y: 60 }]; }
  render() {
    const v = Number(this.getAttribute("voltage") || 0), val = this.getAttribute("value") || "100µF";
    const fill = Math.max(0, Math.min(1, v / 5));
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="36" height="60" viewBox="0 0 36 60">
      <rect x="4" y="2" width="28" height="44" rx="4" fill="#1d2b6b" stroke="#0e1540"/>
      <rect x="4" y="2" width="28" height="6" rx="2" fill="#3b4a9a"/>
      <rect x="24" y="8" width="7" height="36" fill="#e8e8e8"/><text x="27.5" y="30" fill="#1d2b6b" font-size="8" text-anchor="middle" font-family="sans-serif" transform="rotate(-90 27.5 30)">− − −</text>
      <text x="14" y="24" fill="#fff" font-size="6.5" text-anchor="middle" font-family="sans-serif">${val}</text><text x="14" y="33" fill="#9fb0ff" font-size="5.5" text-anchor="middle" font-family="sans-serif">25V</text>
      <rect x="6" y="${40 - fill * 10}" width="4" height="${fill * 10}" fill="#ffd54a" opacity=".85"/>
      <line x1="10" y1="46" x2="10" y2="52" stroke="#888" stroke-width="2"/><line x1="26" y1="46" x2="26" y2="52" stroke="#888" stroke-width="2"/>
      ${PIN(10, 60, "+")}${PIN(26, 60, "−")}</svg>`;
  }
}
class SimDiode extends HTMLElement {   // 60×22，腳在左右：A (0,11)、K (60,11)
  static get observedAttributes() { return ["on", "model"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "A", x: 0, y: 11 }, { name: "K", x: 60, y: 11 }]; }
  render() {
    const on = this.getAttribute("on") === "true", model = this.getAttribute("model") || "1N4007";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="60" height="22" viewBox="0 0 60 22">
      <line x1="0" y1="11" x2="60" y2="11" stroke="#999" stroke-width="2.2"/>
      <rect x="16" y="4" width="28" height="14" rx="2" fill="#1a1a1a" stroke="#000"/>
      <rect x="37" y="4" width="4" height="14" fill="#ddd"/>
      <text x="29" y="13.5" fill="#bbb" font-size="5" text-anchor="middle" font-family="sans-serif">${model}</text>
      ${on ? `<circle cx="8" cy="11" r="3" fill="#ffb300" opacity=".9"/>` : ""}
      <text x="4" y="5" fill="#333" font-size="5.5" font-family="sans-serif">A</text><text x="52" y="5" fill="#333" font-size="5.5" font-family="sans-serif">K</text></svg>`;
  }
}
class SimNPN extends HTMLElement {   // 44×50 TO-92，腳在下緣：E (10,50)、B (22,50)、C (34,50)
  static get observedAttributes() { return ["on", "model"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "E", x: 10, y: 50 }, { name: "B", x: 22, y: 50 }, { name: "C", x: 34, y: 50 }]; }
  render() {
    const on = this.getAttribute("on") === "true", model = this.getAttribute("model") || "2N2222";
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="44" height="50" viewBox="0 0 44 50">
      <path d="M6 30 L6 18 A16 16 0 0 1 38 18 L38 30 Z" fill="#222" stroke="#000"/>
      <rect x="6" y="28" width="32" height="4" fill="#111"/>
      <text x="22" y="20" fill="#ccc" font-size="6" text-anchor="middle" font-family="sans-serif">${model}</text>
      <text x="22" y="27" fill="#888" font-size="5" text-anchor="middle" font-family="sans-serif">NPN</text>
      ${on ? `<circle cx="38" cy="8" r="3" fill="#ffb300" opacity=".9"/>` : ""}
      <line x1="10" y1="32" x2="10" y2="42" stroke="#999" stroke-width="2"/><line x1="22" y1="32" x2="22" y2="42" stroke="#999" stroke-width="2"/><line x1="34" y1="32" x2="34" y2="42" stroke="#999" stroke-width="2"/>
      ${PIN(10, 50, "E")}${PIN(22, 50, "B")}${PIN(34, 50, "C")}</svg>`;
  }
}
class SimNE555 extends HTMLElement {   // 90×60 DIP-8：下緣 1～4（GND TRIG OUT RESET，x 15/35/55/75），上緣 8～5（VCC DIS THR CTRL，x 15/35/55/75）
  static get observedAttributes() { return ["out"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "GND", x: 15, y: 60 }, { name: "TRIG", x: 35, y: 60 }, { name: "OUT", x: 55, y: 60 }, { name: "RESET", x: 75, y: 60 }, { name: "CTRL", x: 75, y: 0 }, { name: "THR", x: 55, y: 0 }, { name: "DIS", x: 35, y: 0 }, { name: "VCC", x: 15, y: 0 }]; }
  render() {
    const out = this.getAttribute("out") === "true";
    const top = [["VCC", 15], ["DIS", 35], ["THR", 55], ["CTRL", 75]], bot = [["GND", 15], ["TRIG", 35], ["OUT", 55], ["RESET", 75]];
    this.shadowRoot.innerHTML = `<svg ${SVGH} width="90" height="60" viewBox="0 0 90 60">
      <rect x="4" y="12" width="82" height="36" rx="2" fill="#2a2a2a" stroke="#000"/>
      <circle cx="12" cy="42" r="2.5" fill="#111" stroke="#555"/><path d="M4 30 a4 4 0 0 0 0 0" fill="#444"/>
      <rect x="4" y="27" width="4" height="6" fill="#555"/>
      <text x="45" y="27" fill="#ddd" font-size="8" text-anchor="middle" font-family="sans-serif">NE555P</text>
      <text x="45" y="37" fill="#888" font-size="5.5" text-anchor="middle" font-family="sans-serif">TIMER</text>
      <circle cx="78" cy="20" r="2.5" fill="${out ? "#3f3" : "#243"}"/><text x="78" y="29" fill="#aaa" font-size="4.5" text-anchor="middle" font-family="sans-serif">OUT</text>
      ${top.map(([n, x]) => `<rect x="${x - 2.5}" y="0" width="5" height="12" fill="#c9a227" stroke="#7a6418" stroke-width=".6"/><text x="${x}" y="18" fill="#bbb" font-size="4.5" text-anchor="middle" font-family="sans-serif">${n}</text>`).join("")}
      ${bot.map(([n, x]) => `<rect x="${x - 2.5}" y="48" width="5" height="12" fill="#c9a227" stroke="#7a6418" stroke-width=".6"/><text x="${x}" y="46" fill="#bbb" font-size="4.5" text-anchor="middle" font-family="sans-serif">${n}</text>`).join("")}
    </svg>`;
  }
}
if (typeof customElements !== "undefined") {
  if (!customElements.get("sim-capacitor")) customElements.define("sim-capacitor", SimCapacitor);
  if (!customElements.get("sim-diode")) customElements.define("sim-diode", SimDiode);
  if (!customElements.get("sim-npn")) customElements.define("sim-npn", SimNPN);
  if (!customElements.get("sim-ne555")) customElements.define("sim-ne555", SimNE555);
}
