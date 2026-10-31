// diagram.js — Wokwi diagram.json 相容的匯出／匯入（純函式，Node 可測）。
// 匯出讓學生能把電路拿到 wokwi.com 開（需要更精確的模擬時的備援）；匯入只認我們匯出的子集。
import { CATALOG, DEVKIT_PINMAP, BOARD_ART } from "./catalog.js";

const BOARD_TYPE = { devkit: "wokwi-esp32-devkit-v1", tqt_pro: "board-esp32-s3-devkitc-1", tdisplay_s3: "board-esp32-s3-devkitc-1", xiao_esp32s3: "board-xiao-esp32-s3" };
const BB_ROW = { a: "t", b: "t", c: "t", d: "t", e: "t", f: "b", g: "b", h: "b", i: "b", j: "b" };

function boardPinToWokwi(board, name) {
  if (board === "devkit") return "esp:" + name;                      // Wokwi 的 devkit-v1 腳位名就是 D4、3V3、GND.1…
  const e = BOARD_ART[board].pins.find((q) => q[0] === name); if (!e) return null;
  const m = e[3];
  if (board === "xiao_esp32s3") { if (typeof m === "number") return "esp:" + name; return "esp:" + m; }   // XIAO 用 D0…；電源 5V／GND／3V3
  if (typeof m === "number") return "esp:" + m;                      // S3 devkitc 腳位名是 GPIO 數字
  return "esp:" + (m === "5V" ? "5V" : m === "3V3" ? "3V3" : "GND.1");
}
function bbToWokwi(hole) {
  const m = /^([a-j])(\d+)$/.exec(hole); if (m) return `bb1:${m[2]}${BB_ROW[m[1]]}.${m[1]}`;
  const r = /^(top|bot)([+-])(\d+)$/.exec(hole); if (r) return `bb1:${r[1] === "top" ? "t" : "b"}${r[2] === "+" ? "p" : "n"}.${r[3]}`;
  return null;
}
function refToWokwi(doc, ref) {
  const i = ref.indexOf(":"), id = ref.slice(0, i), pin = ref.slice(i + 1);
  if (id === "board") return boardPinToWokwi(doc.board, pin);
  if (id === "bb") return bbToWokwi(pin);
  return id + ":" + pin;
}

export function toWokwiDiagram(doc) {
  const parts = [{ type: BOARD_TYPE[doc.board] || BOARD_TYPE.devkit, id: "esp", top: doc.boardPos.y, left: doc.boardPos.x, attrs: {} }];
  if (doc.breadboard) parts.push({ type: "wokwi-breadboard-half", id: "bb1", top: doc.breadboard.y, left: doc.breadboard.x, attrs: {} });
  for (const [id, p] of Object.entries(doc.parts)) parts.push({ type: CATALOG[p.type].tag, id, top: p.y, left: p.x, rotate: p.rot || 0, attrs: { ...(p.attrs || {}) } });
  const connections = [];
  for (const w of doc.wires) { const a = refToWokwi(doc, w.a), b = refToWokwi(doc, w.b); if (a && b) connections.push([a, b, w.color || "green", []]); }
  for (const [id, p] of Object.entries(doc.parts)) for (const [pin, hole] of Object.entries(p.snaps || {})) { const b = bbToWokwi(hole); if (b) connections.push([id + ":" + pin, b, "", []]); }
  return { version: 1, author: "ESP32 AI 實驗室", editor: "wokwi", parts, connections, dependencies: {} };
}

export function fromWokwiDiagram(json) {
  const d = typeof json === "string" ? JSON.parse(json) : json;
  const doc = { board: "devkit", parts: {}, wires: [], boardPos: { x: 60, y: 40 }, breadboard: null };
  const tagToType = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [v.tag, k]));
  let bbId = null;
  for (const p of d.parts || []) {
    if (p.type === "wokwi-esp32-devkit-v1") { doc.board = "devkit"; doc.boardPos = { x: p.left || 0, y: p.top || 0 }; continue; }
    if (p.type === "board-xiao-esp32-s3") { doc.board = "xiao_esp32s3"; doc.boardPos = { x: p.left || 0, y: p.top || 0 }; continue; }
    if (p.type === "board-esp32-s3-devkitc-1") { doc.board = "tqt_pro"; doc.boardPos = { x: p.left || 0, y: p.top || 0 }; continue; }
    if (p.type === "wokwi-breadboard-half" || p.type === "wokwi-breadboard") { doc.breadboard = { x: p.left || 0, y: p.top || 0 }; bbId = p.id; continue; }
    const type = tagToType[p.type]; if (!type) continue;
    doc.parts[p.id] = { type, x: p.left || 0, y: p.top || 0, rot: p.rotate || 0, attrs: { ...(p.attrs || {}) }, snaps: {} };
  }
  const fromWokwiRef = (r) => {
    const i = r.indexOf(":"), id = r.slice(0, i), pin = r.slice(i + 1);
    if (id === "esp") {
      if (doc.board === "devkit") return "board:" + pin;
      if (doc.board === "xiao_esp32s3") { const e = BOARD_ART.xiao_esp32s3.pins.find((q) => q[0] === pin || String(q[3]) === pin); return e ? "board:" + e[0] : null; }
      const e = BOARD_ART[doc.board].pins.find((q) => String(q[3]) === pin || (pin.startsWith("GND") && q[3] === "GND")); return e ? "board:" + e[0] : null;
    }
    if (id === bbId) { const m = /^(\d+)([tb])\.([a-j])$/.exec(pin); if (m) return "bb:" + m[3] + m[1]; const r2 = /^([tb])([pn])\.(\d+)$/.exec(pin); if (r2) return "bb:" + (r2[1] === "t" ? "top" : "bot") + (r2[2] === "p" ? "+" : "-") + r2[3]; return null; }
    return doc.parts[id] ? id + ":" + pin : null;
  };
  for (const c of d.connections || []) {
    const a = fromWokwiRef(c[0]), b = fromWokwiRef(c[1]); if (!a || !b) continue;
    if (c[2] === "" && b.startsWith("bb:") && !a.startsWith("bb:")) { const [id, pin] = a.split(":"); if (doc.parts[id]) doc.parts[id].snaps[pin] = b.slice(3); continue; }
    doc.wires.push({ a, b, color: c[2] || "#2a7" });
  }
  return doc;
}
