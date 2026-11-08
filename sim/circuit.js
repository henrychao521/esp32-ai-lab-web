// circuit.js — 電路模型（純函式，Node 可測，不碰 DOM）
// 網路表（聯集尋找）＋ 修正節點分析（MNA）＋ 逐次線性化：LED 當「開路／順向壓降＋小電阻」兩段、
// 板子 GPIO 當有內阻的電壓源、電源軌當理想電壓源（有電流上限→短路警告）。不是 SPICE，也不模擬晶片。
//
// 元件表（type → pins、模型）見 PARTS；板子見 BOARDS（腳位名 → 角色）。
// solve(circuit, io) → { nets, nodeV: {net: V}, parts: {id: {…狀態}}, warnings: [{code, part, brief, detail}], inputs: {gpio: level}, adc: {gpio: raw} }
//   circuit = { board: "tqt_pro"|"devkit"|"tdisplay_s3"|"xiao_esp32s3", parts: {id: {type, attrs}}, wires: [[refA, refB]] }
//   ref 形如 "led1:A"、"board:16"、"board:3V3"、"board:GND"、"board:5V"、"bb:a1"（麵包板孔）
//   io = { pins: {gpio: 0|1}（輸出電位）, modes: {gpio: "in"|"out"|"adc"|"pwm"}, pulls: {gpio: 0|1（上拉）}, pwm: {gpio: {freq, duty16}},
//          ui: {partId: {pressed, value, light, ...}}（使用者操作中的互動元件）, burned: Set（上次已燒毀的元件） }

export const V_SUPPLY = 3.3;
export const GPIO_R_OUT = 30;        // ESP32 腳位輸出內阻（概略）
export const GPIO_I_MAX = 0.040;     // 單腳最大 40 mA，超過警告
export const PULLUP_R = 45000;       // 內部上拉約 45 kΩ
export const LED_I_MAX = 0.030;      // LED 超過 30 mA 燒毀（教學用門檻，一般 5 mm LED 絕對最大 30 mA）
export const SHORT_I = 0.5;          // 電源軌電流超過 0.5 A 當短路

const LED_VF = { red: 1.8, orange: 2.0, yellow: 2.0, green: 2.2, blue: 3.0, white: 3.0, purple: 3.0 };

/** 元件目錄：pins＝腳位名；model＝怎麼變成電路元素。attrs 是 Wokwi 相容的屬性名。 */
export const PARTS = {
  led: { pins: ["A", "C"], label: "LED", attrs: { color: "red" } },
  resistor: { pins: ["1", "2"], label: "電阻", attrs: { value: "220" } },
  pushbutton: { pins: ["1.l", "1.r", "2.l", "2.r"], label: "按鍵", attrs: { color: "green" } },
  "slide-switch": { pins: ["1", "2", "3"], label: "滑動開關", attrs: {} },
  potentiometer: { pins: ["GND", "SIG", "VCC"], label: "可變電阻", attrs: {} },
  "photoresistor-sensor": { pins: ["VCC", "GND", "DO", "AO"], label: "光敏模組", attrs: {} },
  buzzer: { pins: ["1", "2"], label: "蜂鳴器", attrs: {} },
  servo: { pins: ["GND", "V+", "PWM"], label: "伺服馬達", attrs: {} },
  // 類比／IC（2026-11-07 轉型 P1）
  capacitor: { pins: ["+", "-"], label: "電容", attrs: { value: "100u" } },
  diode: { pins: ["A", "K"], label: "二極體", attrs: { model: "1N4007" } },
  npn: { pins: ["E", "B", "C"], label: "NPN 電晶體", attrs: { model: "2N2222" } },
  ne555: { pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"], label: "555 計時器", attrs: {} },
  acsource: { pins: ["+", "-"], label: "訊號產生器", attrs: { vpk: "5", freq: "50", wave: "sine", offset: "0" } },
  lm358: { pins: ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"], label: "LM358 運算放大器", attrs: {} },
  gate: { pins: ["A", "B", "Y", "VCC", "GND"], label: "邏輯閘", attrs: { kind: "AND" } },
  "led-bar-graph": { pins: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"], label: "LED 長條", attrs: { color: "red" } },
  "rgb-led": { pins: ["R", "COM", "G", "B"], label: "RGB LED", attrs: {} },
  ssd1306: { pins: ["DATA", "CLK", "DC", "RST", "CS", "3V3", "VIN", "GND"], label: "OLED SSD1306", attrs: {}, i2c: 0x3C },
  lcd1602: { pins: ["GND", "VCC", "SDA", "SCL"], label: "LCD1602（I2C）", attrs: {}, i2c: 0x27 },
  "hc-sr04": { pins: ["VCC", "TRIG", "ECHO", "GND"], label: "超音波 HC-SR04", attrs: {} },
  dht22: { pins: ["VCC", "SDA", "NC", "GND"], label: "溫濕度 DHT22", attrs: {} },
  "neopixel-strip": { pins: ["GND", "VCC", "DIN", "DOUT"], label: "NeoPixel 燈條（8 顆）", attrs: {} },
  pir: { pins: ["VCC", "OUT", "GND"], label: "PIR 人體感測", attrs: {} },
  relay: { pins: ["VCC", "GND", "IN", "NO", "COM", "NC"], label: "繼電器模組", attrs: {} },
  stepper: { pins: ["A-", "A+", "B+", "B-"], label: "步進馬達", attrs: {} },
  joystick: { pins: ["VCC", "VERT", "HORZ", "SEL", "GND"], label: "搖桿", attrs: {} },
};

/** 板子腳位：名稱 → {gpio | power}；usable／reserved 來自 agent/lab/boards.py（tools/build_sim_boards.py 可重產）。 */
export const BOARDS = {
  tqt_pro: { name: "T-QT Pro", power: { "3V3": 3.3, "5V": 5.0, GND: 0 }, gpios: [16, 17, 18, 48, 4], usable: [16, 17, 18, 48], adc: [4], input_only: [],
             reserved: { 4: "電池電壓 ADC（只能讀）", 0: "左按鍵", 47: "右按鍵" } },
  devkit: { name: "ESP32 DevKit", power: { "3V3": 3.3, VIN: 5.0, GND: 0 },
            gpios: [13, 12, 14, 27, 26, 25, 33, 32, 35, 34, 39, 36, 15, 2, 4, 16, 17, 5, 18, 19, 21, 3, 1, 22, 23],
            usable: [4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33], adc: [32, 33, 34, 35, 36, 39], input_only: [34, 35, 36, 39],
            reserved: { 2: "板載 LED（lab.led）", 1: "UART0 TX（序列埠）", 3: "UART0 RX（序列埠）", 0: "BOOT 鍵／開機選擇" } },
  tdisplay_s3: { name: "T-Display S3", power: { "3V3": 3.3, "5V": 5.0, GND: 0 }, gpios: [1, 2, 3, 10, 11, 12, 13, 16, 17, 18, 21, 43, 44],
                 usable: [1, 2, 3, 10, 11, 12, 13, 16, 17, 18, 21, 43, 44], adc: [1, 2, 3, 10, 11, 12, 13], input_only: [], reserved: {} },
  xiao_esp32s3: { name: "XIAO ESP32S3", power: { "3V3": 3.3, "5V": 5.0, GND: 0 }, gpios: [1, 2, 3, 4, 5, 6, 7, 8, 9, 43, 44],
                  usable: [1, 2, 3, 4, 5, 6, 7, 8, 9, 43, 44], adc: [1, 2, 3, 4, 5, 6, 7, 8, 9], input_only: [], reserved: {} },
  // Arduino UNO R3（ATmega328P，引擎 C avr8js）：5 V 系統。腳號 D0–D13＝0–13、A0–A5＝14–19；PWM 只有 D3/5/6/9/10/11；A4/A5 兼 I2C SDA/SCL
  // 電源供應器（無開發板）：只有 9V、5V、GND 三個端子，沒有 GPIO；純電路（555、電晶體、整流、RC）用。2026-11-08 使用者：不用開發板、單純接電路的範例
  power: { name: "電源供應器（無開發板）", power: { "9V": 9.0, "5V": 5.0, GND: 0 }, gpios: [], usable: [], adc: [], input_only: [], reserved: {} },
  uno: { name: "Arduino UNO", power: { "5V": 5.0, "3V3": 3.3, VIN: 5.0, GND: 0 }, vlogic: 5.0, gpioROut: 25,
         gpios: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
         usable: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], adc: [14, 15, 16, 17, 18, 19], pwm: [3, 5, 6, 9, 10, 11], input_only: [],
         reserved: { 0: "UART RX（USB 序列埠，Serial 用）", 1: "UART TX（USB 序列埠，Serial 用）" }, onboard: { 13: "板載 L 燈" },
         names: { 14: "A0", 15: "A1", 16: "A2", 17: "A3", 18: "A4", 19: "A5" } },
};
/** 板子腳號的印刷名（UNO：13 → D13、14 → A0；ESP32：GPIO16） */
export function gpioName(board, g) { const B = BOARDS[board]; if (board === "uno") return (B.names[g] || "D" + g); return "GPIO" + g; }
/** 邏輯高電壓（ESP32 3.3 V、UNO 5 V） */
export const vLogic = (board) => (BOARDS[board] && BOARDS[board].vlogic) || V_SUPPLY;

/** 聯集尋找：把 wires（與麵包板導通群組）合併成網路。extraLinks 給麵包板：[[refA, refB], ...] */
export function buildNets(circuit, extraLinks = []) {
  const par = new Map();
  const find = (x) => { if (!par.has(x)) par.set(x, x); while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb); };
  const B = BOARDS[circuit.board] || BOARDS.devkit;
  for (const p of Object.keys(B.power)) find("board:" + p);
  for (const g of B.gpios) find("board:" + g);
  for (const [id, p] of Object.entries(circuit.parts)) for (const pin of (PARTS[p.type] || { pins: [] }).pins) find(id + ":" + pin);
  for (const [a, b] of circuit.wires) union(a, b);
  for (const [a, b] of extraLinks) union(a, b);
  // 內部相通：按鍵 1.l–1.r、2.l–2.r
  for (const [id, p] of Object.entries(circuit.parts)) if (p.type === "pushbutton") { union(id + ":1.l", id + ":1.r"); union(id + ":2.l", id + ":2.r"); }
  const nets = {};
  for (const k of par.keys()) { const r = find(k); (nets[r] = nets[r] || []).push(k); }
  return { find, nets, same: (a, b) => find(a) === find(b) };
}

/** 電容值："100u"、"4.7uF"、"10n"、"1m"（法拉） */
export function parseC(v) { const s = String(v ?? "100u").toLowerCase().replace(/f|µ/g, (m) => (m === "µ" ? "u" : "")); const m = /^([\d.]+)\s*([pnum]?)$/.exec(s.trim()); if (!m) return 100e-6; return parseFloat(m[1]) * ({ p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, "": 1 })[m[2]]; }
const DIODES = { "1N4007": { Is: 7e-9, n: 1.8 }, "1N4148": { Is: 2.5e-9, n: 1.75 }, "1N5819": { Is: 3e-6, n: 1.1 } };
const NPNS = { "2N2222": { Is: 1e-14, bf: 200, br: 3 }, "2N3904": { Is: 1e-14, bf: 150, br: 3 }, "8050": { Is: 1e-14, bf: 120, br: 3 } };
export const DYNAMIC_TYPES = new Set(["capacitor", "ne555", "acsource"]);
/** 訊號產生器的波形（相位 cycles＝f·t），回傳 −1～1：sine 正弦、square 方波、triangle 三角波 */
export function waveform(kind, cycles) {
  const ph = cycles - Math.floor(cycles);
  if (kind === "square") return ph < 0.5 ? 1 : -1;
  if (kind === "triangle") return ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph;
  return Math.sin(2 * Math.PI * ph);
}   // 需要時間步進的元件
export const GATE_FN = { AND: (a, b) => a && b, OR: (a, b) => a || b, NOT: (a) => !a, NAND: (a, b) => !(a && b), NOR: (a, b) => !(a || b), XOR: (a, b) => a !== b };
function parseR(v) { const s = String(v ?? "220").toLowerCase().replace(/ω|ohm|s/g, ""); const m = /^([\d.]+)\s*([km]?)$/.exec(s); if (!m) return 220; return Number(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1); }

/** 主解法。回傳每個網路電壓與每個元件狀態；LED／電源短路／腳位過流以迭代與事後檢查判定。 */
export function solve(circuit, io = {}, extraLinks = []) {
  // PWM：LED 不是吃平均電壓，而是「全亮 × 工作比」。有 PWM 腳時解「全高」與「全低」兩次，依工作比混合亮度。
  const pwmPins = Object.keys(io.modes || {}).filter((g) => io.modes[g] === "pwm" && io.pwm && io.pwm[g]);
  if (pwmPins.length) {
    const mk = (level) => { const pins = { ...(io.pins || {}) }, modes = { ...io.modes }; for (const g of pwmPins) { pins[g] = level; modes[g] = "out"; } return { ...io, pins, modes, _pwmInner: true }; };
    const H = solveOnce(circuit, mk(1), extraLinks), L = solveOnce(circuit, mk(0), extraLinks);
    const d = pwmPins.reduce((s, g) => s + io.pwm[g].duty16 / 65535, 0) / pwmPins.length;
    for (const id of Object.keys(H.parts)) {
      const h = H.parts[id], l = L.parts[id] || {};
      if ("brightness" in h) { h.brightness = d * h.brightness + (1 - d) * (l.brightness || 0); h.on = h.brightness > 0.005 || !!l.on; }
      if ("r" in h) { for (const k of ["r", "g", "b"]) h[k] = d * h[k] + (1 - d) * (l[k] || 0); }
      if ("values" in h) h.values = h.values.map((v, i) => (v || (l.values && l.values[i]) ? 1 : 0));
      if ("on" in h && !("brightness" in h)) h.on = h.on || !!l.on;
    }
    for (const w of L.warnings) if (!H.warnings.some((x) => x.code === w.code && x.part === w.part)) H.warnings.push(w);
    H.burned = [...new Set([...H.burned, ...L.burned])];
    return H;
  }
  return solveOnce(circuit, io, extraLinks);
}

function solveOnce(circuit, io = {}, extraLinks = []) {
  const B = BOARDS[circuit.board] || BOARDS.devkit;
  const VL = B.vlogic || V_SUPPLY, R_OUT = B.gpioROut || GPIO_R_OUT;   // 邏輯高電壓、腳位輸出內阻（UNO 5 V／約 25 Ω）
  const N = io.nets || buildNets(circuit, extraLinks);   // 暫態每步呼叫：結構沒變就沿用上一步的網路表
  const pins = io.pins || {}, modes = io.modes || {}, pulls = io.pulls || {}, pwm = io.pwm || {}, ui = io.ui || {};
  const burned = new Set(io.burned || []);
  const warnings = [];
  const warn = (code, part, brief, why, fix, extra = {}) => { if (!warnings.some((w) => w.code === code && w.part === part)) warnings.push({ code, part, brief, why, fix, detail: why + " " + fix, severity: /BURN|SHORT|OVERCURRENT|SUPPLY_MIX/.test(code) ? "error" : "warning", ...extra }); };

  // 節點編號：GND 網路＝參考（0）。沒有任何東西接 GND 時全部浮接。
  const gndRoot = N.find("board:GND");
  const netIds = Object.keys(N.nets);
  const idx = new Map(); let n = 0;
  for (const r of netIds) if (r !== gndRoot) idx.set(r, n++);
  const node = (ref) => { const r = N.find(ref); return r === gndRoot ? -1 : idx.get(r); };

  // 元素清單：{a, b, g}（電導）、{a, b, v, r}（有內阻的電壓源：a 高、b 低，用 g=1/r 的 Norton 等效）
  const elems = [];
  const addR = (a, b, r) => elems.push({ type: "R", a, b, g: 1 / Math.max(r, 1e-3) });
  const addV = (a, b, v, r, tag) => elems.push({ type: "V", a, b, v, g: 1 / Math.max(r, 1e-3), tag });
  // 暫態（電容）與非線性（二極體、電晶體）：io.dyn = { dt, state }；dt 為 0 代表只算直流穩態
  const dyn = io.dyn || null, dt = dyn && dyn.dt > 0 ? dyn.dt : 0, dstate = (dyn && dyn.state) || {}, nextState = {};
  const nonlin = [];   // {type:"diode", a, b, Is, n, part} | {type:"npn", c, b, e, Is, bf, br, part}

  // 電源：GND 是參考；3V3／5V／VIN 是接 GND 的理想源（內阻 0.5Ω 以便算短路電流）
  for (const [name, v] of Object.entries(B.power)) if (v > 0) addV(node("board:" + name), -1, v, 0.5, "supply:" + name);

  // GPIO
  const gpioElems = {};
  for (const g of B.gpios) {
    const nd = node("board:" + g);
    const mode = modes[g] || (pins[g] !== undefined ? "out" : "in");
    if (mode === "out" || mode === "pwm") {
      const v = pins[g] ? VL : 0;
      const e = { type: "V", a: nd, b: -1, v, g: 1 / R_OUT, tag: "gpio:" + g }; elems.push(e); gpioElems[g] = e;
    } else if (pulls[g]) {
      addV(nd, -1, VL, PULLUP_R, "pull:" + g);
    }
    // 純輸入／ADC：高阻抗（1 MΩ 到地讓浮接節點有定義）
    addR(nd, -1, 1e6);
  }

  // 上一輪的節點電壓（繼電器、感測模組要看 IN／VCC 有沒有電，差一個 tick 可接受）
  const prevV = io.prevV || {};
  const V0 = (nd) => { if (nd === undefined || nd < 0) return 0; for (const [r, i] of idx) if (i === nd) return prevV[r] ?? 0; return 0; };
  // 元件（LED 之外的線性部分）
  const ledList = [];   // {part, pinA, pinC, color, key}
  const partState = {};
  for (const [id, p] of Object.entries(circuit.parts)) {
    const u = ui[id] || {};
    const a = (pin) => node(id + ":" + pin);
    switch (p.type) {
      case "resistor": addR(a("1"), a("2"), parseR(p.attrs?.value)); break;
      case "led": ledList.push({ part: id, key: id, A: a("A"), C: a("C"), color: (p.attrs?.color || "red").toLowerCase() }); break;
      case "pushbutton": if (u.pressed) addR(a("1.l"), a("2.l"), 0.1); break;
      case "slide-switch": addR(a("2"), u.value ? a("3") : a("1"), 0.1); break;
      case "potentiometer": { const total = 10000, frac = Math.max(0, Math.min(1, (u.value ?? 0.5))); addR(a("GND"), a("SIG"), Math.max(1, total * frac)); addR(a("SIG"), a("VCC"), Math.max(1, total * (1 - frac))); break; }
      case "photoresistor-sensor": {
        // 模組：VCC／GND 供電，AO ＝ 依光線分壓（10k 定值 + LDR 1k～200k），DO 不模擬
        const light = Math.max(0, Math.min(1, u.light ?? 0.5));
        const rLdr = 1000 * Math.pow(200, 1 - light);
        addR(a("VCC"), a("AO"), rLdr); addR(a("AO"), a("GND"), 10000); addR(a("VCC"), a("GND"), 100000); break;
      }
      case "buzzer": addR(a("1"), a("2"), 16); break;
      case "servo": addR(a("V+"), a("GND"), 100); addR(a("PWM"), -1, 1e5); break;
      case "led-bar-graph": for (let i = 1; i <= 10; i++) ledList.push({ part: id, key: id + ":" + i, A: a("A" + i), C: a("C" + i), color: (p.attrs?.color || "red").toLowerCase() }); break;
      case "rgb-led": for (const c of ["R", "G", "B"]) ledList.push({ part: id, key: id + ":" + c, A: a(c), C: a("COM"), color: { R: "red", G: "green", B: "blue" }[c] }); break;
      // 模組：供電腳之間放一個負載（算得出有沒有供電），訊號腳高阻抗
      case "ssd1306": addR(a("3V3"), a("GND"), 330); addR(a("VIN"), a("GND"), 330); for (const q of ["DATA", "CLK"]) addR(a(q), -1, 1e6); break;
      case "lcd1602": addR(a("VCC"), a("GND"), 200); for (const q of ["SDA", "SCL"]) addR(a(q), -1, 1e6); break;
      case "hc-sr04": addR(a("VCC"), a("GND"), 330); addR(a("TRIG"), -1, 1e6); { const pv = V0(a("VCC")) - V0(a("GND")); const lv = (u.echoLevel || 0) && pv > 2.5 ? Math.min(pv, VL) : 0; addV(a("ECHO"), -1, lv, 100, "mod:" + id); } break;
      case "dht22": addR(a("VCC"), a("GND"), 5000); addR(a("SDA"), -1, 1e6); break;
      case "neopixel-strip": addR(a("VCC"), a("GND"), 60); addR(a("DIN"), -1, 1e6); break;
      case "pir": addR(a("VCC"), a("GND"), 2000); { const pv = V0(a("VCC")) - V0(a("GND")); addV(a("OUT"), -1, u.motion && pv > 2.5 ? 3.3 : 0, 100, "mod:" + id); } break;
      case "relay": {
        addR(a("VCC"), a("GND"), 70); addR(a("IN"), -1, 1e5);
        nonlin.push({ type: "relay", vcc: a("VCC"), gnd: a("GND"), in: a("IN"), com: a("COM"), no: a("NO"), nc: a("NC"), part: id }); break;   // 常閉／常開在迭代裡決定
      }
      case "stepper": addR(a("A+"), a("A-"), 30); addR(a("B+"), a("B-"), 30); break;
      case "capacitor": {   // 後向尤拉伴隨模型：g=C/dt 並聯「上一步電壓」源；直流時開路
        const C = parseC(p.attrs?.value); const vPrev = dstate[id]?.v ?? 0;
        if (dt > 0) addV(a("+"), a("-"), vPrev, dt / C, "cap:" + id); else addR(a("+"), a("-"), 1e9);
        nextState[id] = { v: vPrev }; break;
      }
      case "diode": { const m = DIODES[p.attrs?.model] || DIODES["1N4007"]; nonlin.push({ type: "diode", a: a("A"), b: a("K"), Is: m.Is, n: m.n, part: id }); break; }
      case "npn": { const m = NPNS[p.attrs?.model] || NPNS["2N2222"]; nonlin.push({ type: "npn", c: a("C"), b: a("B"), e: a("E"), Is: m.Is, bf: m.bf, br: m.br, part: id }); break; }
      case "acsource": {   // 訊號產生器：v = 偏壓 + Vpk·波形(ft)，波形＝正弦／方波／三角波（±1），內阻 1Ω；dt=0（直流）時只剩偏壓
        const vpk = parseFloat(p.attrs?.vpk ?? 5) || 5, f = parseFloat(p.attrs?.freq ?? 50) || 50, t = (dyn && dyn.t) || 0, off = parseFloat(p.attrs?.offset ?? 0) || 0;
        addV(a("+"), a("-"), off + (dt > 0 ? vpk * waveform(p.attrs?.wave, f * t) : 0), 1, "ac:" + id); nextState[id] = { t }; break;
      }
      case "lm358": {   // 雙運放：VCC／GND 供電，OUT = clamp(A·(IN+ − IN−))，在迭代裡以鬆弛收斂（可做比較器也可做負回授放大）
        addR(a("VCC"), a("GND"), 5000);
        for (const k of ["1", "2"]) { addR(a("IN" + k + "+"), -1, 1e7); addR(a("IN" + k + "-"), -1, 1e7); nonlin.push({ type: "opamp", p: a("IN" + k + "+"), n: a("IN" + k + "-"), o: a("OUT" + k), vcc: a("VCC"), gnd: a("GND"), part: id, ch: k }); }
        break;
      }
      case "gate": {   // 邏輯閘（74HC 系列行為模型）：輸入門檻 Vcc/2，輸出推挽 50Ω；在同一次求解的迭代裡判斷（按鍵一按馬上反應）
        const kind = p.attrs?.kind || "AND"; const fn = GATE_FN[kind] || GATE_FN.AND;
        addR(a("VCC"), a("GND"), 20000); addR(a("A"), a("GND"), 1e6); addR(a("B"), a("GND"), 1e6);
        nonlin.push({ type: "gate", a: a("A"), b: a("B"), yn: a("Y"), vcc: a("VCC"), gnd: a("GND"), fn, part: id }); break;
      }
      case "ne555": {   // 行為模型：比較器＋RS 正反器（用上一步電壓判斷），OUT 推挽、DIS 放電開關
        const vcc = V0(a("VCC")) - V0(a("GND")), gnd = V0(a("GND"));
        const floating = (pin) => (N.nets[N.find(id + ":" + pin)] || []).every((m) => m.startsWith(id + ":") || m.startsWith("bb:"));
        const trig = V0(a("TRIG")) - gnd, thr = V0(a("THR")) - gnd, reset = floating("RESET") ? vcc : V0(a("RESET")) - gnd;
        let q = dstate[id]?.q ?? 0;
        if (vcc < 2) q = 0; else if (reset < 0.7) q = 0; else if (trig < vcc / 3) q = 1; else if (thr > vcc * 2 / 3) q = 0;
        addR(a("VCC"), a("GND"), 1500); addR(a("VCC"), a("CTRL"), 5000); addR(a("CTRL"), a("GND"), 10000);
        addR(a("THR"), -1, 1e6); addR(a("TRIG"), -1, 1e6); addR(a("RESET"), -1, 1e6);
        addV(a("OUT"), a("GND"), q && vcc >= 2 ? Math.max(0, vcc - 1.5) : 0, 10, "ic:" + id);
        if (!q) addR(a("DIS"), a("GND"), 1); else addR(a("DIS"), -1, 1e9);
        nextState[id] = { q, vcc }; break;
      }
      case "joystick": {
        const total = 10000; const fx = Math.max(0, Math.min(1, (u.x ?? 0) * 0.5 + 0.5)), fy = Math.max(0, Math.min(1, (u.y ?? 0) * 0.5 + 0.5));
        addR(a("GND"), a("HORZ"), Math.max(1, total * fx)); addR(a("HORZ"), a("VCC"), Math.max(1, total * (1 - fx)));
        addR(a("GND"), a("VERT"), Math.max(1, total * fy)); addR(a("VERT"), a("VCC"), Math.max(1, total * (1 - fy)));
        if (u.pressed) addR(a("SEL"), a("GND"), 0.1); break;
      }
    }
  }

  // 逐次線性化：LED 先全開路；解；電壓超過 Vf 的改成「Vf 源＋10Ω」；重解直到穩定
  const ledOn = new Map(); const opPrev = new Map();
  let nodeV = new Float64Array(n);
  for (let iter = 0; iter < 25; iter++) {
    const E = elems.slice();
    for (const L of ledList) {
      if (burned.has(L.key)) continue;
      if (ledOn.get(L.key)) { const vf = LED_VF[L.color] ?? 2.0; E.push({ type: "V", a: L.A, b: L.C, v: vf, g: 1 / 10, tag: "led:" + L.key }); }
      else E.push({ type: "R", a: L.A, b: L.C, g: 1e-9 });
    }
    // 二極體／電晶體：以上一輪電壓線性化（Newton），限制一步最多跳 Vlim 以免爆炸
    const Vt = 0.02585, VLIM = 0.85;
    const Vn = (nd) => (nd === undefined || nd < 0 ? 0 : nodeV[nd]);
    const dio = (va, vb, Is, nn) => { const vd = Math.min(VLIM, va - vb); const ex = Math.exp(vd / (nn * Vt)); const g = Is * ex / (nn * Vt) + 1e-9; const i = Is * (ex - 1); return { g, v: vd - i / g }; };
    for (const q of nonlin) {
      if (q.type === "gate") {
        const vcc = Vn(q.vcc) - Vn(q.gnd), hi = (nd) => Vn(nd) - Vn(q.gnd) > vcc / 2;
        const y = vcc > 2 ? !!q.fn(hi(q.a), hi(q.b)) : false; q.y = y;
        E.push({ type: "V", a: q.yn, b: q.gnd, v: y ? vcc - 0.1 : 0, g: 1 / 50, tag: "gate:" + q.part }); continue;
      }
      if (q.type === "relay") {
        const powered = Vn(q.vcc) - Vn(q.gnd) > 2.5, en = powered && (Vn(q.in) - Vn(q.gnd) > 1.5); q.en = en;
        E.push({ type: "R", a: q.com, b: en ? q.no : q.nc, g: 10 }); continue;
      }
      if (q.type === "opamp") {   // 理想運放＋輸出夾在 0.05～Vcc−1.5；鬆弛 0.4 讓負回授收斂
        const vcc = Vn(q.vcc) - Vn(q.gnd), target = Math.max(0.05, Math.min(Math.max(0.1, vcc - 1.5), 1e4 * (Vn(q.p) - Vn(q.n)) + (vcc - 1.5) / 2 * 0));
        const prev = opPrev.get(q.part + q.ch); const vo = prev === undefined ? target : prev + 0.4 * (target - prev); opPrev.set(q.part + q.ch, vo);
        E.push({ type: "V", a: q.o, b: q.gnd, v: vo, g: 1 / 50, tag: "op:" + q.part }); continue;
      }
      if (q.type === "diode") { const d = dio(Vn(q.a), Vn(q.b), q.Is, q.n); E.push({ type: "V", a: q.a, b: q.b, v: d.v, g: d.g, tag: "dio:" + q.part }); }
      else {   // Ebers–Moll 傳輸模型：IF（B→E）、IR（B→C）、集極電流 IF−IR
        const vbe = Math.min(VLIM, Vn(q.b) - Vn(q.e)), vbc = Math.min(VLIM, Vn(q.b) - Vn(q.c));
        const eF = Math.exp(vbe / Vt), eR = Math.exp(vbc / Vt);
        const gF = q.Is * eF / Vt + 1e-9, IF = q.Is * (eF - 1), gR = q.Is * eR / Vt + 1e-9, IR = q.Is * (eR - 1);
        E.push({ type: "V", a: q.b, b: q.e, v: vbe - IF / gF, g: gF / q.bf });   // 基極－射極二極體（除以 βF）
        E.push({ type: "V", a: q.b, b: q.c, v: vbc - IR / gR, g: gR / q.br });   // 基極－集極二極體（除以 βR）
        E.push({ type: "G4", a: q.c, b: q.e, c: q.b, d: q.e, g: gF });            // 集極電流 gF·vbe
        E.push({ type: "G4", a: q.c, b: q.e, c: q.b, d: q.c, g: -gR });           // − gR·vbc
        E.push({ type: "I", a: q.c, b: q.e, i: (IF - gF * vbe) - (IR - gR * vbc) });
      }
    }
    const prevNode = nodeV;
    nodeV = solveMNA(n, E);
    let changed = false;
    if (nonlin.length) { let dmax = 0; for (let k = 0; k < n; k++) dmax = Math.max(dmax, Math.abs(nodeV[k] - prevNode[k])); if (dmax > 1e-3) changed = true; }
    for (const L of ledList) {
      if (burned.has(L.key)) continue;
      const vA = L.A < 0 ? 0 : nodeV[L.A], vC = L.C < 0 ? 0 : nodeV[L.C];
      const vf = LED_VF[L.color] ?? 2.0;
      const on = ledOn.get(L.key) || false;
      if (!on && vA - vC > vf + 0.02) { ledOn.set(L.key, true); changed = true; }
      else if (on) { const i = ((vA - vC) - vf) / 10; if (i < -1e-6) { ledOn.set(L.key, false); changed = true; } }
    }
    if (!changed) break;
  }
  const V = (nd) => (nd === undefined || nd < 0 ? 0 : nodeV[nd]);
  for (const [id, p] of Object.entries(circuit.parts || {})) {
    if (p.type !== "capacitor") continue; const a = (pin) => node(id + ":" + pin);
    nextState[id] = { v: dt > 0 ? V(a("+")) - V(a("-")) : (dstate[id]?.v ?? 0) };
  }

  // 事後檢查：LED 電流、極性、無電阻；電源短路；GPIO 過流；浮接
  for (const L of ledList) {
    const vA = V(L.A), vC = V(L.C), vf = LED_VF[L.color] ?? 2.0;
    const on = !!ledOn.get(L.key) && !burned.has(L.key);
    const i = on ? Math.max(0, ((vA - vC) - vf) / 10) : 0;
    const st = partState[L.part] = partState[L.part] || { leds: {} };
    st.leds[L.key] = { on, i, vA, vC, burned: burned.has(L.key) };
    if (burned.has(L.key)) { warn("LED_BURN", L.part, `${L.part} 已燒毀`, "為什麼：剛才電流超過 LED 上限 30 mA（沒有串電阻，電流只受腳位內阻限制）。", "怎麼改：按「重置」或重新「執行」讓 LED 復活，並在 LED 長腳（A）和 GPIO 之間串 220 Ω～1 kΩ 電阻。"); continue; }
    if (i > LED_I_MAX && !burned.has(L.key)) {
      burned.add(L.key); st.leds[L.key].burned = true; st.leds[L.key].on = false;
      warn("LED_BURN", L.part, `${L.part} 燒毀了（${(i * 1000).toFixed(0)} mA）`, "為什麼：LED 一導通電壓就被夾在順向壓降（紅約 1.8 V），沒有電阻分壓的話電流只受腳位內阻限制，會超過 LED 的上限 30 mA，發熱燒斷。", VL > 4 ? "怎麼改：刪掉這顆 LED 重放一顆，在 LED 的長腳（A）和腳位之間串 220 Ω～1 kΩ 電阻（5 V 時 220 Ω 約 13 mA、330 Ω 約 9 mA；UNO 的腳位是 5 V，比 ESP32 更容易燒）。" : "怎麼改：刪掉這顆 LED 重放一顆，在 LED 的長腳（A）和 GPIO 之間串 220 Ω～1 kΩ 電阻（3.3 V 時 220 Ω 約 7 mA，剛好亮）。");
    }
    if (!on && vC - vA > vf) warn("LED_REVERSE", L.part, `${L.part} 接反了`, "為什麼：LED 是二極體，只讓電流從長腳（A，陽極）流向短腳（C，陰極）；反向時不導通，所以不亮（也不會壞）。", "怎麼改：把 LED 轉 180°，長腳那一側接 GPIO 或電阻、短腳接 GND。");
  }
  for (const e of elems) {
    if (e.type !== "V") continue;
    const i = (e.v - (V(e.a) - V(e.b))) * e.g;   // 流出源的電流
    if (e.tag.startsWith("supply:") && i > SHORT_I) warn("SHORT", "board", `${e.tag.slice(7)} 短路（${i.toFixed(1)} A）`, "為什麼：電源正極和 GND 之間沒有任何元件擋著（或按鍵按下、LED 導通後變成直通），電流只受電源內阻限制，真板子會重開、發燙或燒掉保護元件。", "怎麼改：找出畫紅的那幾條線，電源和 GND 之間一定要有負載（LED＋電阻、蜂鳴器…），不要直接連。模擬已暫停，修好再執行。", { net: N.find("board:" + e.tag.slice(7)) });
    if (e.tag.startsWith("gpio:") && Math.abs(i) > GPIO_I_MAX) warn("GPIO_OVERCURRENT", "board", `${gpioName(circuit.board, Number(e.tag.slice(5)))} 電流 ${(Math.abs(i) * 1000).toFixed(0)} mA 超過 40 mA`, (circuit.board === "uno" ? "為什麼：ATmega328P 每支腳位絕對最大 40 mA（建議 20 mA 以內），" : "為什麼：ESP32 每支腳位最多只能供／吸 40 mA，") + "直接驅動低阻抗負載（蜂鳴器、馬達、沒電阻的 LED）會超過，久了腳位會壞。", "怎麼改：LED 串 220 Ω 以上電阻；蜂鳴器、馬達、繼電器用電晶體（或 MOSFET）當開關，由 GPIO 控制電晶體。");
  }
  // 3V3 與 5V 接在一起（或 VIN）：兩個電源互灌
  const supplies = Object.keys(B.power).filter((k) => B.power[k] > 0);
  for (let i = 0; i < supplies.length; i++) for (let j = i + 1; j < supplies.length; j++) {
    if (B.power[supplies[i]] === B.power[supplies[j]]) continue;   // 同電壓（UNO 的 5V 與 USB 供電時的 VIN）不算互灌
    if (N.same("board:" + supplies[i], "board:" + supplies[j])) warn("SUPPLY_MIX", "board", `${supplies[i]} 和 ${supplies[j]} 接在一起`, "為什麼：3.3 V 和 5 V 是兩個不同的電源，直接相連會讓 5 V 灌進 3.3 V 穩壓器與晶片，ESP32 的腳位只能承受 3.3 V。", "怎麼改：同一條線路只用一種電源；需要 5 V 的元件（伺服）接 5V 與 GND，訊號線仍用 3.3 V 的 GPIO。", { net: N.find("board:" + supplies[i]) });
  }
  // 按鍵浮接：一側接 GPIO、另一側沒接 GND／3V3，且 GPIO 沒開上拉
  for (const [id, p] of Object.entries(circuit.parts)) if (p.type === "pushbutton") {
    const sides = [["1.l"], ["2.l"]].map((pins) => N.nets[N.find(id + ":" + pins[0])] || []);
    const gp = (members) => members.filter((m) => m.startsWith("board:") && !isNaN(Number(m.slice(6)))).map((m) => Number(m.slice(6)));
    const toPower = (members) => members.some((m) => m === "board:GND" || m === "board:3V3" || m === "board:5V");
    for (let k = 0; k < 2; k++) {
      const g = gp(sides[k]); const other = sides[1 - k];
      if (g.length && !toPower(other) && !gp(other).length && !pulls[g[0]]) warn("BTN_FLOAT", id, `${id} 讀值會亂跳（浮接）`, "為什麼：按鍵沒按下時 GPIO 哪裡都沒接，電位不定（浮接），程式讀到的 0／1 會隨機變化。", "怎麼改：按鍵另一側接 GND，程式用 Pin(n, Pin.IN, Pin.PULL_UP)（內部上拉：沒按＝1、按下＝0）；或另一側接 3V3 並外加 10 kΩ 下拉電阻到 GND。");
    }
  }
  // 浮接／未共地：元件有腳位所在網路只有自己一個端點
  for (const [id, p] of Object.entries(circuit.parts)) {
    for (const pin of (PARTS[p.type] || { pins: [] }).pins) {
      if (p.type === "pushbutton" && pin.endsWith(".r")) continue;
      if (p.type === "photoresistor-sensor" && pin === "DO") continue;
      if (p.type === "slide-switch" && (pin === "1" || pin === "3")) continue;
      if (["DC", "RST", "CS", "VIN", "NC", "DOUT", "NO", "NC"].includes(pin) || (p.type === "ssd1306" && pin === "3V3" && (N.nets[N.find(id + ":VIN")] || []).length > 1)) continue;
      if (p.type === "relay" && (pin === "NO" || pin === "NC")) continue;
      if (p.type === "joystick" && pin === "SEL") continue;
      const members = N.nets[N.find(id + ":" + pin)] || [];
      const others = members.filter((m) => !m.startsWith(id + ":") && !m.startsWith("bb:"));
      if (others.length === 0) warn("OPEN", id, `${id} 的 ${pin} 沒接到東西`, "為什麼：電流要有完整回路，一隻腳懸空等於斷路，整個元件不會動作。", "怎麼改：把這隻腳接線到板子腳位或其他元件（插麵包板時，同一欄的 5 個孔是相通的）。");
    }
  }
  if (Object.keys(N.nets[gndRoot] || {}).length <= 1 && Object.keys(circuit.parts).length) {
    const gndMembers = (N.nets[gndRoot] || []).filter((m) => !m.startsWith("bb:"));
    if (gndMembers.length <= 1) warn("NO_GND", "board", "沒有任何東西接到 GND", "為什麼：所有電壓都是相對 GND 量的，電流也要從 GND 回到板子；沒共地就沒有回路，元件不會動、讀值會亂跳。", "怎麼改：把電路的負極那一側（LED 短腳、按鍵另一側、感測器 GND）接到板子的 GND 腳。");
  }

  // 元件輸出狀態（給畫面）
  for (const [id, p] of Object.entries(circuit.parts)) {
    const st = partState[id] = partState[id] || {};
    const u = ui[id] || {};
    const vp = (pin) => V(node(id + ":" + pin));
    switch (p.type) {
      case "led": { const l = st.leds?.[id]; st.on = !!l?.on; st.brightness = l ? Math.min(1, l.i / 0.006) : 0; st.burned = !!l?.burned; break; }
      case "buzzer": st.on = Math.abs(vp("1") - vp("2")) > 1.0; break;
      case "servo": {
        const powered = vp("V+") - vp("GND") > 4.0 || vp("V+") - vp("GND") > 3.0;
        const pwmNet = N.find(id + ":PWM");
        let angle = null;
        for (const g of B.gpios) if (N.find("board:" + g) === pwmNet && pwm[g] && pwm[g].freq >= 40 && pwm[g].freq <= 60) {
          const ms = (pwm[g].duty16 / 65535) * (1000 / pwm[g].freq); angle = Math.max(0, Math.min(180, Math.round((ms - 0.5) / 2.0 * 180)));
        }
        st.powered = powered; st.angle = powered && angle !== null ? angle : (st.angle ?? 90);
        if (!powered && angle !== null) warn("SERVO_NO_POWER", id, `${id} 沒有供電`, "為什麼：PWM 訊號只是「叫它轉到幾度」的指令，馬達本身要另外從 V+／GND 吃電才能動。", "怎麼改：V+ 接板子 5V（3V3 也能動但沒力），GND 接 GND，PWM 線接 GPIO。");
        break;
      }
      case "led-bar-graph": st.values = Array.from({ length: 10 }, (_, i) => (st.leds?.[id + ":" + (i + 1)]?.on ? 1 : 0)); break;
      case "rgb-led": st.r = st.leds?.[id + ":R"]?.on ? Math.min(1, st.leds[id + ":R"].i / 0.006) : 0; st.g = st.leds?.[id + ":G"]?.on ? Math.min(1, st.leds[id + ":G"].i / 0.006) : 0; st.b = st.leds?.[id + ":B"]?.on ? Math.min(1, st.leds[id + ":B"].i / 0.006) : 0; break;
      case "potentiometer": st.v = vp("SIG"); break;
      case "photoresistor-sensor": st.v = vp("AO"); st.powered = vp("VCC") - vp("GND") > 2.5; break;
      case "pushbutton": st.pressed = !!u.pressed; break;
      case "slide-switch": st.value = u.value ? 1 : 0; break;
      case "ssd1306": st.powered = (vp("3V3") - vp("GND") > 2.5) || (vp("VIN") - vp("GND") > 2.5); break;
      case "lcd1602": case "hc-sr04": case "dht22": case "neopixel-strip": case "pir": case "joystick": st.powered = vp("VCC") - vp("GND") > 2.5; break;
      case "stepper": st.a = vp("A+") - vp("A-"); st.b = vp("B+") - vp("B-"); break;
      case "relay": st.powered = vp("VCC") - vp("GND") > 2.5; st.energized = st.powered && (vp("IN") - vp("GND") > 1.5); break;
      case "capacitor": st.v = vp("+") - vp("-"); if (st.v < -1.0) warn("CAP_REVERSE", id, `${id} 電解電容接反了`, "為什麼：電解電容有極性，長腳（+）要接高電位；反接會發熱甚至鼓起爆開。", "怎麼改：把 + 腳接到電壓高的那一邊。"); break;
      case "diode": { const vd = vp("A") - vp("K"); st.on = vd > 0.5; st.vd = vd; break; }
      case "npn": { const vbe = vp("B") - vp("E"), vce = vp("C") - vp("E"); st.on = vbe > 0.6; st.sat = st.on && vce < 0.3; st.vbe = vbe; st.vce = vce; break; }
      case "ne555": st.q = !!(nextState[id] && nextState[id].q); st.out = vp("OUT") - vp("GND"); st.powered = vp("VCC") - vp("GND") > 2.5; break;
      case "acsource": st.v = vp("+") - vp("-"); break;
      case "lm358": st.powered = vp("VCC") - vp("GND") > 2.5; st.out1 = vp("OUT1") - vp("GND"); st.out2 = vp("OUT2") - vp("GND"); break;
      case "gate": { const q = nonlin.find((x) => x.type === "gate" && x.part === id); st.y = !!(q && q.y); st.powered = vp("VCC") - vp("GND") > 2.5; break; }
    }
    if (st.powered === false && ["ssd1306", "lcd1602", "hc-sr04", "dht22", "neopixel-strip", "pir", "relay", "joystick"].includes(p.type)) {
      const hasAnyWire = PARTS[p.type].pins.some((pin) => (N.nets[N.find(id + ":" + pin)] || []).some((m) => !m.startsWith(id + ":") && !m.startsWith("bb:")));
      if (hasAnyWire) warn("MODULE_NO_POWER", id, `${id} 沒有供電`, "為什麼：這類模組要有 VCC（3.3 V 或 5 V，看模組）和 GND 才會動，只接訊號線程式會讀不到或畫面不亮。", `怎麼改：${p.type === "hc-sr04" || p.type === "relay" || circuit.board === "uno" ? "VCC 接 5V" : "VCC 接 3V3"}、GND 接 GND，再接訊號線。`);
    }
  }

  // 板子輸入：GPIO 讀到的電位、ADC 原始值
  const inputs = {}, adc = {};
  for (const g of B.gpios) {
    const v = V(node("board:" + g));
    const mode = modes[g] || (pins[g] !== undefined ? "out" : "in");
    if (mode === "in") inputs[g] = v > VL / 2 ? 1 : 0;
    if (mode === "adc" || mode === "in") adc[g] = Math.max(0, Math.min(4095, Math.round(v / VL * 4095)));   // 0～4095 對應 0～邏輯電壓（ESP32 3.3 V、UNO 5 V）
  }
  const nodeVolt = {};
  for (const r of netIds) nodeVolt[r] = r === gndRoot ? 0 : nodeV[idx.get(r)];
  // 程式用了某支 GPIO（設成輸出／輸入／PWM／ADC），板子上那支腳卻沒接任何線：十之八九是腳位編號對錯（XIAO 的 D9 是 GPIO8）
  if (!io._pwmInner) {
    const bd = BOARDS[circuit.board] || {}; const miss = [];
    for (const g of Object.keys(modes)) {
      const n = Number(g); if (!bd.gpios || !bd.gpios.includes(n) || (bd.reserved && bd.reserved[n]) || (bd.onboard && bd.onboard[n])) continue;
      const ref = "board:" + n; if (!(circuit.wires || []).some(([a, b]) => a === ref || b === ref)) miss.push(n);
    }
    if (miss.length && circuit.board === "uno") warn("PIN_UNWIRED", "board", `程式用了 ${miss.map((n) => gpioName("uno", n)).join("、")}，但板子上這${miss.length > 1 ? "幾" : ""}支腳沒接線`, "為什麼：pinMode／digitalWrite／analogRead 用到的腳，板子上要有線接到元件，不然元件收不到訊號。", "怎麼改：把線接到板子上印著同樣名字的腳（數字 13 就是 D13、A0 就是 A0），或把程式的腳號改成你接線的那支。");
    else if (miss.length) warn("PIN_UNWIRED", "board", `程式用了 GPIO${miss.join("、GPIO")}，但板子上這${miss.length > 1 ? "幾" : ""}支腳沒接線`, "為什麼：程式裡 Pin(編號) 的編號是晶片的 GPIO 號碼，不一定等於板子上印的字（XIAO 的 D9 是 GPIO8、D10 是 GPIO9）。", "怎麼改：把線接到板子上對應這個 GPIO 的腳，或把程式的編號改成你接線那支腳的 GPIO（滑到板子腳位上可看對應）。");
  }
  return { nets: N, nodeV: nodeVolt, parts: partState, warnings, inputs, adc, burned: [...burned], dynState: nextState };
}

/** 修正節點分析（Norton 形式：每個電壓源＝電流源 v·g 並聯電導 g），高斯消去。a／b 為 -1 表示 GND。 */
export function solveMNA(n, elems) {
  if (n === 0) return new Float64Array(0);
  const G = Array.from({ length: n }, () => new Float64Array(n));
  const I = new Float64Array(n);
  for (const e of elems) {
    const { a, b, g } = e;
    if (e.type === "I") { if (a >= 0) I[a] -= e.i; if (b >= 0) I[b] += e.i; continue; }   // 電流 i 由 a 流到 b
    if (e.type === "G4") {   // 壓控電流源：a→b 的電流 = g·(v_c − v_d)
      const { c, d } = e;
      if (a >= 0 && c >= 0) G[a][c] += g; if (a >= 0 && d >= 0) G[a][d] -= g; if (b >= 0 && c >= 0) G[b][c] -= g; if (b >= 0 && d >= 0) G[b][d] += g; continue;
    }
    if (a >= 0) G[a][a] += g;
    if (b >= 0) G[b][b] += g;
    if (a >= 0 && b >= 0) { G[a][b] -= g; G[b][a] -= g; }
    if (e.type === "V") { const is = e.v * g; if (a >= 0) I[a] += is; if (b >= 0) I[b] -= is; }
  }
  for (let i = 0; i < n; i++) G[i][i] += 1e-12;   // 避免奇異
  // 高斯消去（部分選主元）
  const A = G.map((row, i) => [...row, I[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / d; if (!f) continue; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = A[i][n] / (A[i][i] || 1e-12);
  return x;
}
