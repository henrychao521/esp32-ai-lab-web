// engine.js — 模擬器的「執行引擎」可插拔介面。
// 畫布與電路解法只透過這個介面跟執行端講話，所以之後可以換成 esp32sim（跑未修改的韌體映像，Web Worker）而不動畫布。
//
//   const engine = await createEngine("micropython-wasm", { board: "tqt_pro" });
//   engine.onPinChange((pin, state) => ...)     // state = { mode: "in"|"out"|"pwm"|"adc", level: 0|1, pull: 0|1, pwm: {freq, duty16}|null }
//   engine.onConsole((msg) => ...)               // msg 與板子 /ws 事件同形：out／err／start／done／sensor／display
//   await engine.boot(program, name)             // 載入並開始執行（像 /run）
//   await engine.stop(); await engine.reset(); await engine.check(code)
//   engine.setPin(pin, level)                    // 外部電路把輸入腳拉到 0／1
//   engine.setAnalog(pin, volts)                 // 外部電路給 ADC 腳的電壓（0～3.3 V）
//   engine.pwmState(pin) → {freq, duty16}|null
//   engine.pins() → { [pin]: state }             // 目前所有已被程式碰過的腳位
//   engine.pressButton(pin, down)                // 板載按鍵
//   engine.cmd(obj)                              // 遙控／視覺指令（op:"joy"…）給 @lab.on_cmd
//   engine.screenRGBA() / engine.takeScreenDirty()   // T-QT 螢幕（沒有就 null）
//   engine.info() / engine.running / engine.kind / engine.capabilities
//
// 第一個實作：MicroPython WebAssembly（vboard/vboard.js）。第二個（之後）：esp32sim worker。
// 規則：machine 替身不再加深；I2C／SPI 周邊的協定解碼放元件層（例如 SSD1306 解碼器吃 engine 送出的位元組事件），兩個引擎共用。

export const ENGINES = {
  "micropython-wasm": { label: "MicroPython WebAssembly（秒開，lab 替身）", module: "../vboard/vboard.js" },
  // "esp32sim": { label: "esp32sim（未修改韌體映像，Web Worker）", module: "./engine-esp32sim.js" },   // 待主對話定案
};

export async function createEngine(kind = "micropython-wasm", opts = {}) {
  if (kind === "micropython-wasm") return createWasmEngine(opts);
  throw new Error("未知的引擎：" + kind);
}

async function createWasmEngine(opts) {
  const mod = await import(new URL("../vboard/vboard.js", import.meta.url).href);
  const pinCbs = [], conCbs = [];
  let prev = {};
  const vb = await mod.createVirtualBoard({
    board: opts.board || "tqt_pro",
    onEvent: (m) => { for (const cb of conCbs) { try { cb(m); } catch (e) {} } },
    onState: () => diffPins(),
  });
  function snapshotPins() {
    const st = vb.state, out = {};
    const all = new Set([...Object.keys(st.pins), ...Object.keys(st.pinModes), ...Object.keys(st.pwm)]);
    for (const p of all) {
      const mode = st.pinModes[p] || (st.pins[p] !== undefined ? "out" : "in");
      out[p] = { mode, level: mode === "out" ? (st.pins[p] ?? 0) : (st.inputs[p] ?? 0), pull: st.pinPulls?.[p] ?? 0, pwm: st.pwm[p] ? { ...st.pwm[p] } : null };
    }
    return out;
  }
  function diffPins() {
    const cur = snapshotPins();
    for (const [p, s] of Object.entries(cur)) {
      const o = prev[p];
      if (!o || o.mode !== s.mode || o.level !== s.level || o.pull !== s.pull || JSON.stringify(o.pwm) !== JSON.stringify(s.pwm)) for (const cb of pinCbs) { try { cb(Number(p), s); } catch (e) {} }
    }
    prev = cur;
  }
  return {
    kind: "micropython-wasm",
    capabilities: { screen: (opts.board || "tqt_pro") === "tqt_pro", i2c: false, spi: false, uart: false, cycleAccurate: false },
    get running() { return vb.state.status === "running"; },
    get board() { return vb.board; },
    onPinChange(cb) { pinCbs.push(cb); return () => { const i = pinCbs.indexOf(cb); if (i >= 0) pinCbs.splice(i, 1); }; },
    onConsole(cb) { conCbs.push(cb); return () => { const i = conCbs.indexOf(cb); if (i >= 0) conCbs.splice(i, 1); }; },
    async boot(program, name = "main.py") { const r = await vb.run(program, name); diffPins(); return r; },
    stop: () => vb.stop(),
    async reset() { await vb.reset(); prev = {}; diffPins(); },
    check: (code) => vb.check(code),
    setPin(pin, level) { vb.setInput(pin, level ? 1 : 0); },
    setAnalog(pin, volts) { vb.setAdc(pin, Math.round(Math.max(0, Math.min(3.3, volts)) / 3.3 * 4095)); },
    pwmState(pin) { const p = vb.state.pwm[pin]; return p ? { ...p } : null; },
    pins: snapshotPins,
    pressButton: (pin, down) => vb.pressButton(pin, down),
    cmd: (c) => vb.cmd(c),
    screenRGBA: () => (vb.board === "tqt_pro" ? vb.screenRGBA() : null),
    takeScreenDirty: () => vb.takeScreenDirty(),
    info: () => vb.info(),
    /** 給舊程式碼的逃生門（App 的 VirtualBoardHost 等仍直接用 vboard）；畫布不要用。 */
    _vb: vb,
  };
}
