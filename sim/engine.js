// engine.js — 模擬器執行引擎的共用介面（規格：docs/sim-engine-api.md v1）。
// 畫布只透過這裡取得引擎；引擎 A（MicroPython wasm）在這個檔；引擎 B（esp32sim）由 sim-engine/engine-esp32sim.js 提供，畫布不碰那個目錄。
export const API_VERSION = 1;
export const ENGINES = {
  "micropython-wasm": { label: "快速（MicroPython wasm）", note: "秒開；lab 模組直接對應；沒有精確時序、單步與 Arduino", module: null },
  "esp32sim": { label: "真韌體（esp32sim）", note: "跑未修改的 ESP32-S3 韌體，時序精確，可單步，可 Arduino C；開機較慢", module: "../sim-engine/engine-esp32sim.js" },
};

export async function createEngine(kind = "micropython-wasm", opts = {}) {
  if (kind === "micropython-wasm") return createWasmEngine(opts);
  if (kind === "esp32sim") {
    const base = new URL(ENGINES.esp32sim.module, import.meta.url);
    const mod = await import(base.href);
    // 首次載入：wasm 4.1 MB＋ROM 0.9 MB＋韌體 1.8 MB，先用串流抓下來回報進度（opts.onProgress(done, total, label)），再以 blob URL 交給引擎 B。
    // 韌體與 Arduino 映像的位置以 sim/ 為準（Pages 與 App 都是 ../firmware、../sim-engine/arduino），不用引擎 B 預設的 ../web/firmware。
    const FW_BASE = typeof document === "undefined" ? "../web/firmware/" : "../firmware/";   // 網頁（Pages／伺服器／App）在 /firmware；Node 直接讀 repo 的 web/firmware
    const chip = { devkit: "esp32" }[opts.board] || "esp32s3";
    const romName = { esp32: "esp32_rev300_rom.elf", esp32s3: "esp32s3_rev0_rom.elf" }[chip];
    const fwId = opts.board === "devkit" ? "micropython-esp32" : "micropython-esp32s3";
    const files = {
      wasm: new URL("./esp32sim.wasm", base), rom: new URL("./rom/" + romName, base),
      fw: new URL(FW_BASE + fwId + ".bin", import.meta.url),
    };
    const blobs = await preloadAll(files, opts.onProgress);
    const e = await mod.createEsp32simEngine({
      ...opts, wasmUrl: blobs.wasm, i2c: [],   // I2C 位址由元件層 registerI2CDevice 登記；不要引擎 B 的預設 21 個位址
      romUrl: (c) => (c === chip ? blobs.rom : new URL("./rom/" + { esp32: "esp32_rev300_rom.elf", esp32s3: "esp32s3_rev0_rom.elf" }[c], base).href),
      firmwareUrl: (id) => (id === fwId ? blobs.fw : new URL(FW_BASE + id + ".bin", import.meta.url).href),
      arduinoUrl: (id) => new URL(id, base).href,
      worker: typeof Worker !== "undefined" && location.protocol !== "vboard:",   // App 的自訂 scheme 不開 Worker，改同執行緒
    });
    if (e.apiVersion !== API_VERSION) throw new Error("引擎 B 的 apiVersion 不符：" + e.apiVersion);
    return hideInternalPins(e, opts.board || "tqt_pro");
  }
  throw new Error("未知的引擎：" + kind);
}


/** 串流下載多個檔案並回報總進度；回傳 {key: blobURL}。已抓過的（同頁）直接重用。 */
const preloadCache = {};
async function preloadAll(files, onProgress) {
  const keys = Object.keys(files), sizes = {}, done = {}, out = {};
  const report = (label) => { if (!onProgress) return; const t = keys.reduce((a, k) => a + (sizes[k] || 0), 0), d = keys.reduce((a, k) => a + (done[k] || 0), 0); onProgress(d, t, label); };
  await Promise.all(keys.map(async (k) => {
    const href = files[k].href;
    if (href.startsWith("file:") || typeof document === "undefined") { out[k] = href; return; }   // Node（契約測試）：引擎 B 自己讀檔
    if (preloadCache[href]) { out[k] = preloadCache[href]; return; }
    const r = await fetch(href); if (!r.ok) throw new Error(href + ": " + r.status);
    sizes[k] = Number(r.headers.get("content-length")) || 0; done[k] = 0;
    const chunks = []; const reader = r.body.getReader();
    for (;;) { const { value, done: fin } = await reader.read(); if (fin) break; chunks.push(value); done[k] += value.length; report(k); }
    if (!sizes[k]) sizes[k] = done[k];
    const type = href.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    out[k] = preloadCache[href] = URL.createObjectURL(new Blob(chunks, { type })); report(k);
  }));
  return out;
}


/** 真韌體會回報板子自己用掉的腳位（螢幕 SPI、背光、UART0、flash）；畫布只看得到排針上的 GPIO，這些一律不顯示。 */
const HIDDEN_PINS = {
  tqt_pro: [1, 2, 3, 5, 6, 8, 10, 43, 44],           // GC9107 SPI＋DC/RST、背光、UART0
  tdisplay_s3: [43, 44],
  xiao_esp32s3: [43, 44],
  esp32s3_devkitc: [43, 44],
  devkit: [1, 3, 6, 7, 8, 9, 10, 11],                 // UART0、flash
  lab_generic: [],
};
function hideInternalPins(e, board) {
  const hidden = new Set(HIDDEN_PINS[board] || []);
  if (!hidden.size) return e;
  const pins = e.pins.bind(e), on = e.on.bind(e);
  return new Proxy(e, {
    get(t, k) {
      if (k === "pins") return () => { const p = pins(); for (const g of hidden) delete p[g]; return p; };
      if (k === "on") return (name, cb) => (["pin", "pinmode", "pwm"].includes(name) ? on(name, (g, ...rest) => { if (!hidden.has(g)) cb(g, ...rest); }) : on(name, cb));
      const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/** 小型事件匯流排 */
function makeEmitter() {
  const subs = {};
  return {
    on(name, cb) { (subs[name] = subs[name] || []).push(cb); return () => { const a = subs[name] || []; const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }; },
    emit(name, ...args) { for (const cb of subs[name] || []) { try { cb(...args); } catch (e) { console.error("engine listener", name, e); } } },
  };
}

// ---------- 引擎 A：MicroPython WebAssembly（vboard/vboard.js） ----------
async function createWasmEngine(opts) {
  const mod = await import(new URL("../vboard/vboard.js", import.meta.url).href);
  const em = makeEmitter();
  const board = opts.board || "tqt_pro";
  let prev = {}, t0 = performance.now(), status = "idle";
  const pulseSources = {}, sensors = {}, i2cDevices = {};   // 引擎 A 的同步替代（規格第 4 節）
  let i2cReplyBuf = null;
  const vb = await mod.createVirtualBoard({
    board,
    hooks: {
      i2cInit: (bus, scl, sda) => em.emit("i2cinit", bus, scl, sda),
      i2cScan: (bus) => Object.keys(i2cDevices[bus] || {}).map(Number),
      i2cWrite: (bus, addr, bytes) => { const known = !!(i2cDevices[bus] && i2cDevices[bus][addr]); em.emit("i2c", bus, addr, bytes, false); return known; },
      i2cRead: (bus, addr, n) => { i2cReplyBuf = null; em.emit("i2c", bus, addr, new Uint8Array(0), true, n); const d = i2cReplyBuf; i2cReplyBuf = null; return d ? d.slice(0, n) : (i2cDevices[bus] && i2cDevices[bus][addr] ? new Uint8Array(n) : null); },
      spiWrite: (host, bytes) => em.emit("spi", host, bytes, null),
      rmt: (gpio, bytes, bpp) => { const bits = new Uint8Array(bytes.length * 8); for (let i = 0; i < bytes.length; i++) for (let b = 0; b < 8; b++) bits[i * 8 + b] = (bytes[i] >> (7 - b)) & 1; em.emit("rmt", gpio, bits, { bytes, bpp }); },
      pulse: (gpio, level) => (pulseSources[gpio] ? pulseSources[gpio](level) : null),
      sensor: (gpio) => (sensors[gpio] ? sensors[gpio]() : null),
    },
    onEvent: (m) => {
      if (m.t === "start") { status = "running"; em.emit("state", status); }
      if (m.t === "done") { status = "idle"; em.emit("state", status); }
      em.emit("console", m);
    },
    onState: () => diff(),
  });
  const nowUs = () => Math.round((performance.now() - t0) * 1000);
  function snapshot() {
    const st = vb.state, out = {};
    const all = new Set([...Object.keys(st.pins), ...Object.keys(st.pinModes), ...Object.keys(st.pwm)]);
    for (const p of all) {
      const mode = st.pinModes[p] || (st.pins[p] !== undefined ? "out" : "in");
      const pw = st.pwm[p] && st.pwm[p].freq > 0 ? { hz: st.pwm[p].freq, duty: st.pwm[p].duty16 / 65535 } : null;
      out[p] = { mode, level: mode === "out" || mode === "pwm" ? (st.pins[p] ?? 0) : (st.inputs[p] ?? 0), pull: st.pinPulls?.[p] ?? 0, pwm: pw };
    }
    return out;
  }
  function diff() {
    const cur = snapshot(), t = nowUs();
    for (const [p, s] of Object.entries(cur)) {
      const o = prev[p], g = Number(p);
      if (!o || o.mode !== s.mode || o.pull !== s.pull) em.emit("pinmode", g, s.mode, s.pull);
      if (!o || o.level !== s.level) em.emit("pin", g, s.level, t);
      if (JSON.stringify(o?.pwm || null) !== JSON.stringify(s.pwm)) em.emit("pwm", g, s.pwm ? s.pwm.hz : 0, s.pwm ? s.pwm.duty : 0);
    }
    if (board === "tqt_pro" && vb.takeScreenDirty()) { screenDirty = true; em.emit("screen"); }
    prev = cur;
  }
  let screenDirty = false;
  const held = {};
  return {
    apiVersion: API_VERSION, kind: "micropython-wasm", board,
    capabilities: { screen: board === "tqt_pro", i2c: true, spi: true, uart: false, rmt: true, step: false, cycleAccurate: false, arduino: false },
    get running() { return status === "running"; },
    on: em.on,
    async boot({ program, name } = {}) { t0 = performance.now(); prev = {}; const r = await vb.run(program || "", name || "main.py"); diff(); return r; },
    run() {},
    pause() { return vb.stop(); },
    step() { return false; },
    async reset() { await vb.reset(); prev = {}; status = "idle"; em.emit("state", status); diff(); },
    stop: () => vb.stop(),
    check: (program) => vb.check(program),
    time: nowUs,
    setSpeed() {},
    schedule(tUs, fn) { setTimeout(fn, Math.max(0, (tUs - nowUs()) / 1000)); },
    info: () => vb.info(),
    pins: snapshot,
    setPin(gpio, level) { vb.setInput(gpio, level ? 1 : 0); },
    setAnalog(gpio, volts) { vb.setAdc(gpio, Math.round(Math.max(0, Math.min(3.3, volts)) / 3.3 * 4095)); },
    pressButton(g, ms) { const gpio = typeof g === "number" ? g : ({ boot: 0, left: 0, key: board === "tdisplay_s3" ? 14 : 47, right: board === "tdisplay_s3" ? 14 : 47 })[String(g).toLowerCase()] ?? 0; vb.pressButton(gpio, true); if (ms) { clearTimeout(held[gpio]); held[gpio] = setTimeout(() => vb.pressButton(gpio, false), ms); } },
    releaseButton(g) { const gpio = typeof g === "number" ? g : 0; clearTimeout(held[gpio]); vb.pressButton(gpio, false); },
    cmd: (c) => vb.cmd(c),
    uartWrite() {},
    i2cReply(bus, addr, bytes) { i2cReplyBuf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes); },
    registerI2CDevice(bus, addr, on = true) { i2cDevices[bus] = i2cDevices[bus] || {}; if (on) i2cDevices[bus][addr] = true; else delete i2cDevices[bus][addr]; },
    registerPulseSource(gpio, fn) { if (fn) pulseSources[gpio] = fn; else delete pulseSources[gpio]; },
    registerSensor(gpio, fn) { if (fn) sensors[gpio] = fn; else delete sensors[gpio]; },
    screenRGBA: () => (board === "tqt_pro" ? vb.screenRGBA() : null),
    takeScreenDirty() { const d = screenDirty; screenDirty = false; return d; },
    sensorValue() { return null; },
    _vb: vb,
  };
}
