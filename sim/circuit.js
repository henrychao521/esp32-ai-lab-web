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
  "led-bar-graph": { pins: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"], label: "LED 長條", attrs: { color: "red" } },
  "rgb-led": { pins: ["R", "COM", "G", "B"], label: "RGB LED", attrs: {} },
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
};

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
  const N = buildNets(circuit, extraLinks);
  const pins = io.pins || {}, modes = io.modes || {}, pulls = io.pulls || {}, pwm = io.pwm || {}, ui = io.ui || {};
  const burned = new Set(io.burned || []);
  const warnings = [];
  const warn = (code, part, brief, detail) => { if (!warnings.some((w) => w.code === code && w.part === part)) warnings.push({ code, part, brief, detail }); };

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

  // 電源：GND 是參考；3V3／5V／VIN 是接 GND 的理想源（內阻 0.5Ω 以便算短路電流）
  for (const [name, v] of Object.entries(B.power)) if (v > 0) addV(node("board:" + name), -1, v, 0.5, "supply:" + name);

  // GPIO
  const gpioElems = {};
  for (const g of B.gpios) {
    const nd = node("board:" + g);
    const mode = modes[g] || (pins[g] !== undefined ? "out" : "in");
    if (mode === "out" || mode === "pwm") {
      const v = pins[g] ? V_SUPPLY : 0;
      const e = { type: "V", a: nd, b: -1, v, g: 1 / GPIO_R_OUT, tag: "gpio:" + g }; elems.push(e); gpioElems[g] = e;
    } else if (pulls[g]) {
      addV(nd, -1, V_SUPPLY, PULLUP_R, "pull:" + g);
    }
    // 純輸入／ADC：高阻抗（1 MΩ 到地讓浮接節點有定義）
    addR(nd, -1, 1e6);
  }

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
    }
  }

  // 逐次線性化：LED 先全開路；解；電壓超過 Vf 的改成「Vf 源＋10Ω」；重解直到穩定
  const ledOn = new Map();
  let nodeV = new Float64Array(n);
  for (let iter = 0; iter < 25; iter++) {
    const E = elems.slice();
    for (const L of ledList) {
      if (burned.has(L.key)) continue;
      if (ledOn.get(L.key)) { const vf = LED_VF[L.color] ?? 2.0; E.push({ type: "V", a: L.A, b: L.C, v: vf, g: 1 / 10, tag: "led:" + L.key }); }
      else E.push({ type: "R", a: L.A, b: L.C, g: 1e-9 });
    }
    nodeV = solveMNA(n, E);
    let changed = false;
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

  // 事後檢查：LED 電流、極性、無電阻；電源短路；GPIO 過流；浮接
  for (const L of ledList) {
    const vA = V(L.A), vC = V(L.C), vf = LED_VF[L.color] ?? 2.0;
    const on = !!ledOn.get(L.key) && !burned.has(L.key);
    const i = on ? Math.max(0, ((vA - vC) - vf) / 10) : 0;
    const st = partState[L.part] = partState[L.part] || { leds: {} };
    st.leds[L.key] = { on, i, vA, vC, burned: burned.has(L.key) };
    if (i > LED_I_MAX && !burned.has(L.key)) {
      burned.add(L.key); st.leds[L.key].burned = true; st.leds[L.key].on = false;
      warn("LED_BURN", L.part, `${L.part} 燒毀了（${(i * 1000).toFixed(0)} mA）`, "LED 沒有串聯限流電阻（或電阻太小），電流超過 30 mA。拆掉後換一顆，並串 220Ω～1kΩ 電阻。");
    }
    if (!on && vC - vA > vf) warn("LED_REVERSE", L.part, `${L.part} 接反了`, "LED 有方向：長腳（A，＋）接高電位、短腳（C，−）接 GND。接反不會亮，不會壞。");
  }
  for (const e of elems) {
    if (e.type !== "V") continue;
    const i = (e.v - (V(e.a) - V(e.b))) * e.g;   // 流出源的電流
    if (e.tag.startsWith("supply:") && i > SHORT_I) warn("SHORT", "board", `${e.tag.slice(7)} 短路（${i.toFixed(1)} A）`, "電源正極和 GND 之間沒有任何元件，或 LED／按鍵把它們直接接通。真板子會重開或燒毀保護元件。");
    if (e.tag.startsWith("gpio:") && Math.abs(i) > GPIO_I_MAX) warn("GPIO_OVERCURRENT", "board", `GPIO${e.tag.slice(5)} 電流 ${(Math.abs(i) * 1000).toFixed(0)} mA 超過 40 mA`, "ESP32 單一腳位最多 40 mA。中間要有電阻（LED 串 220Ω），大電流負載用電晶體或繼電器。");
  }
  // 浮接／未共地：元件有腳位所在網路只有自己一個端點
  for (const [id, p] of Object.entries(circuit.parts)) {
    for (const pin of (PARTS[p.type] || { pins: [] }).pins) {
      if (p.type === "pushbutton" && pin.endsWith(".r")) continue;
      if (p.type === "photoresistor-sensor" && pin === "DO") continue;
      if (p.type === "slide-switch" && (pin === "1" || pin === "3")) continue;
      const members = N.nets[N.find(id + ":" + pin)] || [];
      const others = members.filter((m) => !m.startsWith(id + ":") && !m.startsWith("bb:"));
      if (others.length === 0) warn("OPEN", id, `${id} 的 ${pin} 沒接到東西`, "每隻腳都要接線（或插在和別的腳同一排的麵包板孔）。");
    }
  }
  if (Object.keys(N.nets[gndRoot] || {}).length <= 1 && Object.keys(circuit.parts).length) {
    const gndMembers = (N.nets[gndRoot] || []).filter((m) => !m.startsWith("bb:"));
    if (gndMembers.length <= 1) warn("NO_GND", "board", "沒有任何東西接到 GND", "電路要有回路：負極那一側要回到板子的 GND，否則什麼都不會動。");
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
        if (!powered && angle !== null) warn("SERVO_NO_POWER", id, `${id} 沒有供電`, "伺服馬達 V+ 接 5V（或 3V3，力量較小）、GND 接 GND，PWM 線才有作用。");
        break;
      }
      case "led-bar-graph": st.values = Array.from({ length: 10 }, (_, i) => (st.leds?.[id + ":" + (i + 1)]?.on ? 1 : 0)); break;
      case "rgb-led": st.r = st.leds?.[id + ":R"]?.on ? Math.min(1, st.leds[id + ":R"].i / 0.006) : 0; st.g = st.leds?.[id + ":G"]?.on ? Math.min(1, st.leds[id + ":G"].i / 0.006) : 0; st.b = st.leds?.[id + ":B"]?.on ? Math.min(1, st.leds[id + ":B"].i / 0.006) : 0; break;
      case "potentiometer": st.v = vp("SIG"); break;
      case "photoresistor-sensor": st.v = vp("AO"); st.powered = vp("VCC") - vp("GND") > 2.5; break;
      case "pushbutton": st.pressed = !!u.pressed; break;
      case "slide-switch": st.value = u.value ? 1 : 0; break;
    }
  }

  // 板子輸入：GPIO 讀到的電位、ADC 原始值
  const inputs = {}, adc = {};
  for (const g of B.gpios) {
    const v = V(node("board:" + g));
    const mode = modes[g] || (pins[g] !== undefined ? "out" : "in");
    if (mode === "in") inputs[g] = v > 1.65 ? 1 : 0;
    if (mode === "adc" || mode === "in") adc[g] = Math.max(0, Math.min(4095, Math.round(v / V_SUPPLY * 4095)));
  }
  const nodeVolt = {};
  for (const r of netIds) nodeVolt[r] = r === gndRoot ? 0 : nodeV[idx.get(r)];
  return { nets: N, nodeV: nodeVolt, parts: partState, warnings, inputs, adc, burned: [...burned] };
}

/** 修正節點分析（Norton 形式：每個電壓源＝電流源 v·g 並聯電導 g），高斯消去。a／b 為 -1 表示 GND。 */
export function solveMNA(n, elems) {
  if (n === 0) return new Float64Array(0);
  const G = Array.from({ length: n }, () => new Float64Array(n));
  const I = new Float64Array(n);
  for (const e of elems) {
    const { a, b, g } = e;
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
