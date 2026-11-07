// kicad.js — 匯出給專業工具：KiCad 8 以上的簡圖（.kicad_sch，S-expression，自帶 lib_symbols）、KiCad 網路表（.net）、零件清單 CSV。
// 簡圖用「每支腳接一個網路標籤」的方式連線（KiCad 靠同名標籤連通），版面沿用 schematic.js 的位置。純函式，Node 可測。
// EasyEDA Pro 可直接匯入 .kicad_sch（檔案 → 匯入 → KiCad）。
import { PARTS } from "./circuit.js";
import { symbolFor, STUB } from "./symbols.js";
import { buildSchematic, printedPinName } from "./schematic.js";

const MM = 2.54 / 20;                    // 簡圖 px → mm（符號腳距 20 px ＝ 2.54 mm）
const g = (v) => Math.round(v / 1.27) * 1.27;   // 對齊 KiCad 1.27 mm 格點
const f = (v) => Number(v.toFixed(2));
const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
let seq = 0;
const uuid = () => { seq++; const h = (n) => (seq * 2654435761 + n * 40503).toString(16).padStart(8, "0").slice(-8); return `${h(1)}-${h(2).slice(0, 4)}-4${h(3).slice(0, 3)}-8${h(4).slice(0, 3)}-${h(5)}${h(6).slice(0, 4)}`; };

/** 元件型別 → KiCad 參考代號前綴、腳位編號、封裝 */
const KI = {
  resistor: { ref: "R", fp: "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal" },
  led: { ref: "D", fp: "LED_THT:LED_D5.0mm" },
  pushbutton: { ref: "SW", fp: "Button_Switch_THT:SW_PUSH_6mm" },
  "slide-switch": { ref: "SW", fp: "Button_Switch_THT:SW_Slide_SPDT_Angled_CK_OS102011MA1Q" },
  potentiometer: { ref: "RV", fp: "Potentiometer_THT:Potentiometer_Alps_RK09K_Single_Vertical" },
  buzzer: { ref: "BZ", fp: "Buzzer_Beeper:Buzzer_12x9.5RM7.6" },
  servo: { ref: "J", fp: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  "photoresistor-sensor": { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "led-bar-graph": { ref: "D", fp: "Package_DIP:DIP-20_W7.62mm" },
  "rgb-led": { ref: "D", fp: "LED_THT:LED_D5.0mm-4_RGB" },
  ssd1306: { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical" },
  lcd1602: { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "hc-sr04": { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  dht22: { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  "neopixel-strip": { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  pir: { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical" },
  relay: { ref: "K", fp: "Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical" },
  stepper: { ref: "M", fp: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  joystick: { ref: "U", fp: "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical" },
};
const BOARD_FP = { tqt_pro: "Connector_PinSocket_2.54mm:PinSocket_1x07_P2.54mm_Vertical", xiao_esp32s3: "Connector_PinSocket_2.54mm:PinSocket_2x07_P2.54mm_Vertical", devkit: "Connector_PinSocket_2.54mm:PinSocket_2x15_P2.54mm_Vertical", tdisplay_s3: "Connector_PinSocket_2.54mm:PinSocket_2x15_P2.54mm_Vertical" };
const POWER = new Set(["3V3", "5V", "VIN"]);

/** 把 symbols.js 的符號轉成 KiCad lib_symbol（方塊＋腳）。回傳 { text, pinNum: {腳名: 編號} } */
function libSymbol(name, sym, refPrefix, fp, pinOrder) {
  const names = (pinOrder || Object.keys(sym.pins)).filter((n) => sym.pins[n]);
  const base = name.includes(":") ? name.split(":")[1] : name;
  const pinNum = {}; names.forEach((n, i) => { pinNum[n] = String(i + 1); });
  const x0 = g(STUB * MM), x1 = g((sym.w - STUB) * MM), y0 = 0, y1 = -g(sym.h * MM);   // KiCad y 向上
  let s = `    (symbol ${q(name)} (pin_names (offset 0.5)) (exclude_from_sim no) (in_bom yes) (on_board yes)\n`;
  s += `      (property "Reference" ${q(refPrefix)} (at ${f(x0)} 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))\n`;
  s += `      (property "Value" ${q(name)} (at ${f(x0)} ${f(y1 - 1.27)} 0) (effects (font (size 1.27 1.27)) (justify left)))\n`;
  s += `      (property "Footprint" ${q(fp || "")} (at 0 0 0) (effects (font (size 1.27 1.27)) hide))\n`;
  s += `      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))\n`;
  s += `      (symbol ${q(base + "_0_1")} (rectangle (start ${f(x0)} ${f(y0)}) (end ${f(x1)} ${f(y1)}) (stroke (width 0.254) (type default)) (fill (type background))))\n`;
  s += `      (symbol ${q(base + "_1_1")}\n`;
  for (const n of names) {
    const p = sym.pins[n]; const px = g(p.x * MM), py = -g(p.y * MM);
    const ang = { l: 0, r: 180, t: 270, b: 90 }[p.dir];     // 腳從端點指向本體
    const len = f(g(STUB * MM));
    s += `        (pin passive line (at ${f(px)} ${f(py)} ${ang}) (length ${len}) (name ${q(n)} (effects (font (size 1.016 1.016)))) (number ${q(pinNum[n])} (effects (font (size 1.016 1.016)))))\n`;
  }
  s += `      )\n    )\n`;
  return { text: s, pinNum, x0, x1, y1 };
}

/**
 * @returns {{ sch: string, net: string, bom: string, nets: Object<string,string[]>, refs: Object<string,string> }}
 */
export function exportKiCad({ doc, nets, title = "esp32lab" }) {
  seq = 0;
  const parts = doc.parts || {}, board = doc.board;
  const lay = buildSchematic({ doc, nets });            // 沿用簡圖位置
  // ---- 網路名稱：電源用 3V3/5V/GND，其餘 N1、N2… ----
  const netName = {}; let n = 0; const netRefs = {};
  for (const [root, members] of Object.entries(nets)) {
    const refs = members.filter((r) => !r.startsWith("bb:")).filter((r) => r.startsWith("board:") || parts[r.split(":")[0]]);
    if (refs.length < 2) continue;
    const p = refs.find((r) => r.startsWith("board:") && (POWER.has(r.slice(6)) || r.slice(6) === "GND"));
    netName[root] = p ? p.slice(6) : "N" + (++n); netRefs[root] = refs;
  }
  const netOfRef = {}; for (const [root, refs] of Object.entries(netRefs)) for (const r of refs) netOfRef[r] = root;
  // ---- 參考代號 ----
  const counters = {}; const refOf = {};
  for (const id of Object.keys(parts)) { const pre = (KI[parts[id].type] || { ref: "U" }).ref; counters[pre] = (counters[pre] || 0) + 1; refOf[id] = pre + counters[pre]; }
  refOf.board = "A1";
  // ---- lib_symbols ----
  const libs = {}; const libText = []; const symOf = {};
  for (const [id, p] of Object.entries(parts)) {
    const type = p.type; if (!libs[type]) { const sym = symbolFor(type); const ki = KI[type] || { ref: "U", fp: "" }; const order = sym.alias ? Object.keys(sym.pins) : (PARTS[type]?.pins || Object.keys(sym.pins)).map((pn) => (sym.alias && sym.alias[pn]) || pn).filter((v, i, a) => a.indexOf(v) === i); libs[type] = { sym, ...libSymbol("esp32lab:" + type, sym, ki.ref, ki.fp, order), fp: ki.fp }; libText.push(libs[type].text); }
    symOf[id] = libs[type];
  }
  // 板子：只列用到的腳位（簡圖那個方塊）
  const bsymG = lay.positions.board; const usedBoard = [...new Set(Object.keys(netOfRef).filter((r) => r.startsWith("board:")))];
  const boardPinNames = usedBoard.map((r) => (POWER.has(r.slice(6)) || r.slice(6) === "GND") ? r.slice(6) : printedPinName(board, r));
  const boardSym = (await_import_boardSymbol)(board, boardPinNames);
  const bl = libSymbol("esp32lab:board_" + board, boardSym, "A", BOARD_FP[board] || "");
  libText.push(bl.text);
  // ---- 符號實例＋標籤 ----
  const rootUuid = uuid(); let body = ""; let labels = "";
  const place = (id, sym, lib, ref, value, fp, pinRefs) => {
    const pos = lay.positions[id]; const X = g(pos.x * MM) + 25.4, Y = g(pos.y * MM) + 25.4;   // 留邊
    const u = uuid();
    body += `  (symbol (lib_id ${q(lib)}) (at ${f(X)} ${f(Y)} 0) (unit 1) (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (uuid ${q(u)})\n`;
    body += `    (property "Reference" ${q(ref)} (at ${f(X + 1.27)} ${f(Y - 1.27)} 0) (effects (font (size 1.27 1.27)) (justify left)))\n`;
    body += `    (property "Value" ${q(value)} (at ${f(X + 1.27)} ${f(Y + g(sym.h * MM) + 1.27)} 0) (effects (font (size 1.27 1.27)) (justify left)))\n`;
    body += `    (property "Footprint" ${q(fp)} (at ${f(X)} ${f(Y)} 0) (effects (font (size 1.27 1.27)) hide))\n`;
    body += `    (property "Datasheet" "" (at ${f(X)} ${f(Y)} 0) (effects (font (size 1.27 1.27)) hide))\n`;
    for (const [pinName, num] of Object.entries(pinRefs.pinNum)) body += `    (pin ${q(num)} (uuid ${q(uuid())}))\n`;
    body += `    (instances (project ${q(title)} (path ${q("/" + rootUuid)} (reference ${q(ref)}) (unit 1))))\n  )\n`;
    // 每支腳：腳端點外接一小段線＋網路標籤
    for (const [pinName, p] of Object.entries(sym.pins)) {
      const ref1 = pinRefs.refFor(pinName); const net = ref1 ? netOfRef[ref1] : null; if (!net) continue;
      const dir = p.dir; const ex = X + g(p.x * MM), ey = Y + g(p.y * MM);
      const d = { l: [-2.54, 0], r: [2.54, 0], t: [0, -2.54], b: [0, 2.54] }[dir];
      const lx = ex + d[0], ly = ey + d[1];
      labels += `  (wire (pts (xy ${f(ex)} ${f(ey)}) (xy ${f(lx)} ${f(ly)})) (stroke (width 0) (type default)) (uuid ${q(uuid())}))\n`;
      const rot = dir === "l" ? 180 : dir === "t" ? 90 : dir === "b" ? 270 : 0;
      const just = dir === "l" ? "right bottom" : "left bottom";
      labels += `  (label ${q(netName[net])} (at ${f(lx)} ${f(ly)} ${rot}) (effects (font (size 1.27 1.27)) (justify ${just})) (uuid ${q(uuid())}))\n`;
    }
  };
  for (const [id, p] of Object.entries(parts)) {
    const L = symOf[id]; const sym = L.sym;
    const refFor = (pinName) => { // 符號腳名 → 這個元件在網路表裡的 ref（按鍵 1→1.l）
      const real = Object.entries(sym.alias || {}).find(([k, v]) => v === pinName); const pn = real ? real[0] : pinName; return id + ":" + pn; };
    place(id, sym, "esp32lab:" + p.type, refOf[id], p.attrs?.value ? p.attrs.value + "Ω" : (PARTS[p.type]?.label || p.type), L.fp, { pinNum: L.pinNum, refFor });
  }
  const boardRefFor = (pinName) => usedBoard.find((r) => ((POWER.has(r.slice(6)) || r.slice(6) === "GND") ? r.slice(6) : printedPinName(board, r)) === pinName) || null;
  place("board", boardSym, "esp32lab:board_" + board, "A1", boardSym.title || board, BOARD_FP[board] || "", { pinNum: bl.pinNum, refFor: boardRefFor });
  const sch = `(kicad_sch (version 20231120) (generator "esp32lab") (generator_version "8.0")\n  (uuid ${q(rootUuid)})\n  (paper "A4")\n  (title_block (title ${q(title)}) (comment 1 "ESP32 AI 實驗室 電路模擬器匯出"))\n  (lib_symbols\n${libText.join("")}  )\n${labels}${body}  (sheet_instances (path "/" (page "1")))\n)\n`;
  // ---- 網路表（KiCad S-expression）----
  const comps = Object.entries(parts).map(([id, p]) => `    (comp (ref ${q(refOf[id])}) (value ${q(p.attrs?.value ? p.attrs.value + "Ω" : PARTS[p.type]?.label || p.type)}) (footprint ${q(symOf[id].fp)}) (libsource (lib "esp32lab") (part ${q(p.type)})))`).concat([`    (comp (ref "A1") (value ${q(boardSym.title || board)}) (footprint ${q(BOARD_FP[board] || "")}) (libsource (lib "esp32lab") (part ${q("board_" + board)})))`]).join("\n");
  const netNodes = {}; const pinNumOf = (r) => { if (r.startsWith("board:")) { const name = (POWER.has(r.slice(6)) || r.slice(6) === "GND") ? r.slice(6) : printedPinName(board, r); return ["A1", bl.pinNum[name]]; } const [id, pn] = [r.split(":")[0], r.slice(r.indexOf(":") + 1)]; const L = symOf[id]; const key = (L.sym.alias && L.sym.alias[pn]) || pn; return [refOf[id], L.pinNum[key]]; };
  for (const [root, refs] of Object.entries(netRefs)) { const nodes = new Set(); for (const r of refs) { const [ref, num] = pinNumOf(r); if (num) nodes.add(ref + "|" + num); } netNodes[netName[root]] = [...nodes].map((s) => s.split("|")); }
  const netText = Object.entries(netNodes).map(([name, nodes], i) => `    (net (code ${q(String(i + 1))}) (name ${q(name)})\n${nodes.map(([ref, num]) => `      (node (ref ${q(ref)}) (pin ${q(num)}))`).join("\n")})`).join("\n");
  const net = `(export (version "E")\n  (design (source ${q(title + ".kicad_sch")}) (tool "esp32lab"))\n  (components\n${comps})\n  (nets\n${netText})\n)\n`;
  // ---- BOM CSV ----
  const rows = [["參考代號", "元件", "數值", "封裝", "模擬器 id"]];
  for (const [id, p] of Object.entries(parts)) rows.push([refOf[id], PARTS[p.type]?.label || p.type, p.attrs?.value ? p.attrs.value + "Ω" : (p.attrs?.color || ""), symOf[id].fp, id]);
  rows.push(["A1", boardSym.title || board, "", BOARD_FP[board] || "", "board"]);
  const bom = "﻿" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
  return { sch, net, bom, nets: netNodes, refs: refOf, netName };
}

// 板子方塊：和 schematic.js 一樣，只列用到的腳（用到的訊號腳在右、電源上、GND 下）
import { boardSymbol as _boardSymbol } from "./symbols.js";
import { BOARD_ART } from "./catalog.js";
function await_import_boardSymbol(board, names) {
  const power = names.filter((n) => POWER.has(n)), gnd = names.filter((n) => n === "GND"), sig = names.filter((n) => !POWER.has(n) && n !== "GND");
  const title = BOARD_ART[board]?.title || (board === "devkit" ? "ESP32 DevKit" : board);
  const s = _boardSymbol(title, sig, power, gnd); s.title = title; return s;
}
