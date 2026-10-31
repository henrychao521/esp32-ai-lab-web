// relay-element.js — 自繪的繼電器模組（Wokwi 元件庫沒有）：<sim-relay energized="true">，120×70 px，腳位在下緣。
class SimRelayElement extends HTMLElement {
  static get observedAttributes() { return ["energized", "powered"]; }
  constructor() { super(); this.attachShadow({ mode: "open" }); this.render(); }
  attributeChangedCallback() { this.render(); }
  get pinInfo() { return [{ name: "VCC", x: 12, y: 64 }, { name: "GND", x: 28, y: 64 }, { name: "IN", x: 44, y: 64 }, { name: "NO", x: 76, y: 64 }, { name: "COM", x: 92, y: 64 }, { name: "NC", x: 108, y: 64 }]; }
  render() {
    const on = this.getAttribute("energized") === "true", pw = this.getAttribute("powered") === "true";
    this.shadowRoot.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="70" viewBox="0 0 120 70">
      <rect x="1" y="1" width="118" height="60" rx="4" fill="#1a3d8f" stroke="#0d2a6b"/>
      <rect x="40" y="6" width="54" height="34" rx="2" fill="#2b2b2b" stroke="#000"/>
      <text x="67" y="20" fill="#ddd" font-size="7" text-anchor="middle" font-family="sans-serif">SRD-05VDC</text>
      <text x="67" y="30" fill="#aaa" font-size="6" text-anchor="middle" font-family="sans-serif">10A 250VAC</text>
      <circle cx="14" cy="14" r="3.5" fill="${pw ? "#f33" : "#522"}"/><text x="14" y="26" fill="#ddd" font-size="5.5" text-anchor="middle" font-family="sans-serif">PWR</text>
      <circle cx="28" cy="14" r="3.5" fill="${on ? "#3f3" : "#252"}"/><text x="28" y="26" fill="#ddd" font-size="5.5" text-anchor="middle" font-family="sans-serif">ON</text>
      <line x1="92" y1="46" x2="${on ? 76 : 108}" y2="52" stroke="#eee" stroke-width="2"/>
      <circle cx="92" cy="46" r="2" fill="#eee"/>
      ${["VCC", "GND", "IN", "NO", "COM", "NC"].map((n, i) => { const x = [12, 28, 44, 76, 92, 108][i]; return `<rect x="${x - 3}" y="58" width="6" height="12" fill="#c9a227"/><text x="${x}" y="56" fill="#fff" font-size="5" text-anchor="middle" font-family="sans-serif">${n}</text>`; }).join("")}
    </svg>`;
  }
}
if (typeof customElements !== "undefined" && !customElements.get("sim-relay")) customElements.define("sim-relay", SimRelayElement);
