// bench_engines.js — 兩個引擎逐項比對（在模擬器頁面裡用 import() 載入；驗收用，不在 UI 裡）。
// window.benchEngines.runCase(id, engineKind) → 摘要物件；同一案例在 A、B 各跑一次後用 compare() 對照。
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let EXAMPLES = null;
async function examples() { if (!EXAMPLES) EXAMPLES = await (await fetch("examples.json")).json(); return EXAMPLES; }
async function loadCase(id) {
  const sim = window.sim;
  if (id === "cat_clock") {
    const code = await (await fetch("/examples/cat_clock.py")).text();
    sim.stop(); sim.load({ board: "tqt_pro", parts: {}, wires: [], boardPos: { x: 60, y: 40 }, breadboard: null });
    window.simEditor.setCode(code); sim.fit(); return { id, code, title: "貓咪時鐘（螢幕）" };
  }
  const ex = (await examples()).find((e) => e.id === id);
  sim.stop(); sim.load({ board: ex.board, parts: JSON.parse(JSON.stringify(ex.parts)), wires: ex.wires.map((w) => ({ ...w, pts: [] })), boardPos: { x: 60, y: 40 }, breadboard: ex.breadboard || null });
  window.simEditor.setCode(ex.code); sim.fit(); return { id, code: ex.code, title: ex.title };
}
/** 案例：要跑多久、過程中做什麼互動、收什麼 */
const CASES = {
  blink:          { secs: 4.2, watch: [16] },
  button_led:     { secs: 4, watch: [16, 17], during: async (sim) => { for (let i = 0; i < 3; i++) { await wait(600); sim.ui.btn1 = sim.ui.btn1 || {}; sim.ui.btn1.pressed = true; sim.tick(); await wait(200); sim.ui.btn1.pressed = false; sim.tick(); } } },   // 按畫布上的按鍵元件（電路層決定 GPIO17 電位，兩個引擎都一樣）
  breathing:      { secs: 3, watch: [16], pwm: true },
  oled_text:      { secs: 3.5, oled: true },
  neopixel_chase: { secs: 2.5, neo: true },
  cat_clock:      { secs: 4, screen: true },
};
export async function runCase(id, engineKind) {
  const sim = window.sim, C = CASES[id];
  const info = await loadCase(id);
  const t0 = performance.now();
  await sim.attach(sim.doc.board, engineKind);
  const tAttach = performance.now() - t0;
  const eng = sim.engine;
  const out = { id, title: info.title, engine: eng.kind, attachMs: Math.round(tAttach), console: [], pin: [], pwm: [], i2cWrites: 0, i2cBytes: 0, rmt: 0, pinmode: [] };
  const offs = [
    eng.on("console", (m) => { if (m.t === "out") out.console.push(...m.s.split("\n").filter(Boolean)); else if (m.t === "err") out.console.push("ERR " + m.s); }),
    eng.on("pin", (g, lv, tUs) => { if (!C.watch || C.watch.includes(g)) out.pin.push([g, lv, Math.round(tUs / 1000)]); }),
    eng.on("pwm", (g, hz, duty) => out.pwm.push([g, hz, Math.round(duty * 1000) / 1000])),
    eng.on("pinmode", (g, mode, pull) => out.pinmode.push([g, mode, pull])),
    eng.on("i2c", (bus, addr, bytes, isRead) => { if (!isRead) { out.i2cWrites++; out.i2cBytes += bytes.length; } }),
    eng.on("rmt", () => out.rmt++),
  ];
  const t1 = performance.now();
  const r = await sim.run(info.code);
  out.bootMs = Math.round(performance.now() - t1); out.runOk = r.ok; if (!r.ok) out.runMsg = r.msg;
  const tStart = eng.time();
  if (C.during) await C.during(sim, eng);
  const left = C.secs * 1000 - (C.during ? 0 : 0);
  await wait(left);
  out.simElapsedMs = Math.round((eng.time() - tStart) / 1000);
  // 元件層狀態
  const rt = sim.partRuntime;
  for (const [pid, p] of Object.entries(sim.doc.parts)) {
    if (p.type === "ssd1306" && rt[pid]?.decoder) { const d = rt[pid].decoder; let on = 0; for (const b of d.ram) on += popcnt(b); out.oled = { on: d.on, litPixels: on, hash: fnv(d.ram) }; }
    if (p.type === "neopixel-strip" && rt[pid]?.colors) out.neo = rt[pid].colors.map((c) => c.join(","));
  }
  if (C.screen && eng.capabilities.screen) { const rgba = eng.screenRGBA(); out.screen = rgba ? Array.from(rgba) : null; }
  await sim.stop(); offs.forEach((f) => f());
  // 摘要
  if (out.pin.length > 2) { const d = []; for (let i = 1; i < out.pin.length; i++) d.push(out.pin[i][2] - out.pin[i - 1][2]); out.pinIntervalsMs = d; }
  if (out.pwm.length) { out.pwmHz = [...new Set(out.pwm.map((p) => p[1]))]; out.pwmDutyMin = Math.min(...out.pwm.map((p) => p[2])); out.pwmDutyMax = Math.max(...out.pwm.map((p) => p[2])); out.pwmSamples = out.pwm.length; }
  return out;
}
function popcnt(b) { let n = 0; while (b) { n += b & 1; b >>= 1; } return n; }
function fnv(arr) { let h = 0x811c9dc5; for (const b of arr) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
/** 螢幕比對：128×128 RGBA，遮掉時間列（y 96..108）後算相同像素比例 */
export function compareScreens(a, b, maskRows = [[96, 108]]) {
  if (!a || !b) return null; let same = 0, total = 0, sameAll = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const i = (y * 128 + x) * 4; const eq = a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]; if (eq) sameAll++; if (maskRows.some(([y0, y1]) => y >= y0 && y < y1)) continue; total++; if (eq) same++; }
  return { sameMasked: +(same / total * 100).toFixed(2), sameAll: +(sameAll / 16384 * 100).toFixed(2) };
}
export function screenPNG(rgba) { const cv = document.createElement("canvas"); cv.width = cv.height = 128; cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba), 128, 128), 0, 0); return cv.toDataURL("image/png"); }
window.benchEngines = { runCase, compareScreens, screenPNG, CASES };
/** 截圖用：載入案例、接引擎、執行；按鍵案例在 1.2 s 後把按鍵壓住；示波器案例切到示波器分頁 */
export async function showCase(id, engineKind) {
  const sim = window.sim; const info = await loadCase(id);
  document.getElementById("engine").value = engineKind;
  await sim.attach(sim.doc.board, engineKind);
  const r = await sim.run(info.code);
  if (id === "button_led") setTimeout(() => { sim.ui.btn1 = sim.ui.btn1 || {}; sim.ui.btn1.pressed = true; sim.tick(); }, 1200);
  if (id === "breathing") { const tab = document.querySelector(".bottom .tabs button[data-pane=scope]"); if (tab) tab.click(); setTimeout(() => { const b = [...document.querySelectorAll("#pane-scope button")].find((x) => x.textContent === "GPIO16"); if (b && !b.classList.contains("on")) b.click(); }, 800); }
  else { const tab = document.querySelector(".bottom .tabs button[data-pane=console]"); if (tab) tab.click(); }
  return r;
}
window.benchEngines.showCase = showCase;
