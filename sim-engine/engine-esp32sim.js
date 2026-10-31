// engine-esp32sim.js — engine B of docs/sim-engine-api.md (v1): the unmodified MicroPython (or
// Arduino) firmware running in mikroverk/esp32sim compiled to WebAssembly, with the esp32-ai-lab
// board models. `createEsp32simEngine(opts)` returns the engine object the canvas drives.
//
//   const engine = await createEsp32simEngine({ board: "tqt_pro" });
//   await engine.boot({ program: "...", board: "tqt_pro" });
//
// In a browser the machine runs in a Web Worker (worker.js); under Node (the contract test) it
// runs in-thread through host.js. Firmware comes from ../web/firmware/<id>.bin, the mask ROM from
// ./rom/, the module from ./esp32sim.wasm, all relative to this file; `opts` can override the URLs.
import { BOARDS, ROM_FOR } from './driver.js';

export const API_VERSION = 1;
const IS_NODE = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
const bytesCache = new Map();

/// Bytes of a file URL (Node) or a fetched URL (browser), cached.
export async function loadBytes(url) {
  const key = String(url);
  if (bytesCache.has(key)) return bytesCache.get(key);
  let bytes;
  if (IS_NODE && key.startsWith('file:')) {
    const { readFileSync } = await import('node:fs'); const { fileURLToPath } = await import('node:url');
    bytes = new Uint8Array(readFileSync(fileURLToPath(key)));
  } else {
    const r = await fetch(key); if (!r.ok) throw new Error(`${key}: ${r.status}`);
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  bytesCache.set(key, bytes);
  return bytes;
}

/// The transport to the host: a Web Worker when there is one, else host.js in this thread.
async function makeTransport(opts, onMessage) {
  const useWorker = opts.worker !== false && typeof Worker !== 'undefined' && !IS_NODE;
  if (useWorker) {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (ev) => onMessage(ev.data);
    w.onerror = (e) => onMessage({ ev: 'log', data: { msg: '[worker] ' + (e.message || e) } });
    return { post: (m, t) => w.postMessage(m, t || []), close: () => w.terminate() };
  }
  const { DriverHost } = await import('./host.js');
  const host = new DriverHost((m) => queueMicrotask(() => onMessage(m)));
  return { post: (m) => { host.handle(m); }, close: () => host.stop() };
}

export async function createEsp32simEngine(opts = {}) {
  const base = import.meta.url;
  const url = {
    wasm: opts.wasmUrl || new URL('./esp32sim.wasm', base),
    rom: (chip) => opts.romUrl ? opts.romUrl(chip) : new URL('./rom/' + ROM_FOR[chip], base),
    firmware: (id) => opts.firmwareUrl ? opts.firmwareUrl(id) : new URL('../web/firmware/' + id + '.bin', base),
    arduino: (id) => opts.arduinoUrl ? opts.arduinoUrl(id) : new URL(id, base),
  };
  const subs = {};
  const emit = (name, ...args) => { for (const cb of (subs[name] || []).slice()) { try { cb(...args); } catch (e) { console.error('[esp32sim] listener', name, e); } } };
  let seq = 0; const pending = new Map();
  const state = { board: opts.board || 'tqt_pro', booted: false, bootedWith: null, status: 'idle', running: false, speed: 1,
                  tUs: 0, tWall: 0, pins: {}, screen: null, leds: null, info: { name: 'esp32sim', board: opts.board || 'tqt_pro', version: null, status: 'idle', file: null, free: null },
                  schedules: [], deadlineSent: null, disposed: false, cfg: BOARDS[opts.board || 'tqt_pro'] };
  if (!state.cfg) throw new Error('unknown board ' + state.board);

  const onMessage = (m) => {
    if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } return; }
    if (!m.ev) return;
    const d = m.data;
    switch (m.ev) {
      case 'console': emit('console', d); if (d.t === 'done') { state.info.status = 'idle'; } if (d.t === 'start') { state.info.status = 'running'; state.info.file = d.file; } break;
      case 'pin': { const st = state.pins[d.gpio] = state.pins[d.gpio] || { mode: 'out', level: 0, pull: 0, pwm: null }; st.level = d.level; noteTime(d.tUs); emit('pin', d.gpio, d.level, d.tUs); break; }
      case 'pinmode': { const st = state.pins[d.gpio] = state.pins[d.gpio] || { mode: 'in', level: 0, pull: 0, pwm: null }; st.mode = d.mode; st.pull = d.pull; if (d.mode !== 'pwm') st.pwm = null; emit('pinmode', d.gpio, d.mode, d.pull); break; }
      case 'pwm': { const st = state.pins[d.gpio] = state.pins[d.gpio] || { mode: 'pwm', level: 0, pull: 0, pwm: null }; st.pwm = d.hz ? { hz: d.hz, duty: d.duty } : null; if (d.hz) st.mode = 'pwm'; emit('pwm', d.gpio, d.hz, d.duty); break; }
      case 'i2c': emit('i2c', d.bus, d.addr, d.bytes, d.isRead); break;
      case 'spi': emit('spi', d.host, d.bytes, d.cs); break;
      case 'rmt': emit('rmt', d.gpio, d.bits); break;
      case 'screen': state.screen = d; emit('screen'); break;
      case 'leds': state.leds = d.colors; emit('leds', d.colors); break;
      case 'state': state.status = d.status; state.running = d.status === 'running'; state.info.status = d.status === 'running' ? 'running' : 'idle'; emit('state', d.status); break;
      case 'time': noteTime(d.tUs); emit('time', d.tUs); break;
      case 'deadline': noteTime(d.tUs); fireSchedules(d.tUs); break;
      case 'halt': state.running = false; emit('halt', d.code); emit('state', 'idle'); break;
      case 'log': emit('log', d.msg); if (opts.log) opts.log(d.msg); break;
    }
  };
  const noteTime = (tUs) => { if (tUs > state.tUs) { state.tUs = tUs; state.tWall = performance.now(); } };
  const transport = await makeTransport(opts, onMessage);
  const call = (op, args = {}, transfer) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); transport.post({ op, id, ...args }, transfer); });
  await call('init', { wasm: await loadBytes(url.wasm), noJit: !!opts.noJit });

  /// Schedules: the host stops at the earliest one and waits for `resume`.
  const sendDeadline = () => {
    const next = state.schedules.length ? Math.min(...state.schedules.map((s) => s.tUs)) : null;
    if (next !== state.deadlineSent) { state.deadlineSent = next; call('deadline', { tUs: next }); }
  };
  const fireSchedules = (tUs) => {
    const due = state.schedules.filter((s) => s.tUs <= tUs + 1); state.schedules = state.schedules.filter((s) => s.tUs > tUs + 1);
    for (const s of due) { try { s.fn(tUs); } catch (e) { console.error('[esp32sim] schedule', e); } }
    state.deadlineSent = null; sendDeadline();
    if (state.running || state.status === 'booting') call('resume');
  };

  /// Firmware bytes for a board: `{ id | bin, rom, flashAt, raw }`.
  const resolveFirmware = async (firmware, board) => {
    const cfg = BOARDS[board];
    if (firmware && typeof firmware === 'object') {
      return { key: 'custom', bin: firmware.bin, rom: firmware.rom || await loadBytes(url.rom(cfg.chip)), flashAt: firmware.flashAt ?? 0, raw: !!firmware.raw };
    }
    const id = firmware || cfg.firmware;
    if (id.startsWith('arduino:')) return { key: id, bin: await loadBytes(url.arduino(id.slice(8))), rom: await loadBytes(url.rom(cfg.chip)), flashAt: 0, raw: true };
    return { key: id, bin: await loadBytes(url.firmware(id)), rom: await loadBytes(url.rom(cfg.chip)), flashAt: cfg.flashAt ?? 0, raw: false };
  };
  const bootMachine = async (board, firmware, program, name) => {
    const fw = await resolveFirmware(firmware, board);
    state.board = board; state.cfg = BOARDS[board]; state.info.board = board; state.pins = {}; state.screen = null; state.leds = null; state.schedules = []; state.deadlineSent = null;
    const r = await call('boot', { board, firmware: fw.bin, rom: fw.rom, flashAt: fw.flashAt, raw: fw.raw, program: program ?? null, name, i2c: opts.i2c ?? null });
    state.booted = !!r.ok; state.bootedWith = r.ok ? `${board}|${fw.key}` : null;
    if (r.ok) refreshPins();
    return r;
  };
  const refreshPins = () => call('pins').then((p) => { for (const [g, st] of Object.entries(p)) state.pins[g] = { ...(state.pins[g] || {}), ...st }; }).catch(() => {});
  const ensureBooted = async () => { if (!state.booted) { const r = await bootMachine(state.board, opts.firmware, null); if (!r.ok) throw new Error(r.msg); } };

  const engine = {
    kind: 'esp32sim', apiVersion: API_VERSION,
    get board() { return state.board; },
    get running() { return state.running; },
    get capabilities() { return { screen: !!state.cfg.screen, i2c: true, spi: true, uart: true, rmt: true, step: true, cycleAccurate: true, arduino: true, leds: state.board !== 'tqt_pro' && state.board !== 'lab_generic' }; },

    /// Boot (first time, or when the board/firmware changes) and start `program` in lab.runner.
    async boot({ firmware, program, board, name = 'main.py', fresh = false } = {}) {
      const b = board || state.board; const cfg = BOARDS[b]; if (!cfg) return { ok: false, msg: '未知的板子：' + b };
      if (!IS_NODE && b !== state.board) { /* layout change on the page side */ }
      const fw = firmware || opts.firmware || cfg.firmware;
      const key = `${b}|${typeof fw === 'object' ? 'custom' : fw}`;
      if (fresh || opts.freshBoot || !state.booted || state.bootedWith !== key || (typeof fw === 'object')) return bootMachine(b, fw, program, name);
      if (program == null) return { ok: true, msg: 'already booted' };
      if (state.running) await engine.stop();
      const r = await call('start', { program, name });
      if (r.ok) refreshPins();
      return r;
    },
    run() { call('run'); },
    pause() { call('pause'); state.running = false; emit('state', 'paused'); },
    step(ms = 1) { return call('step', { ms }); },
    async reset() { const r = await bootMachine(state.board, opts.firmware, null); state.running = false; return r.ok; },
    async stop() { if (!state.booted) return true; return call('stop'); },
    async check(program, name = 'main.py') { await ensureBooted(); return call('check', { program, name }); },
    time() { const extra = state.running ? (performance.now() - state.tWall) * 1000 * state.speed : 0; return Math.round(state.tUs + extra); },
    setSpeed(x) { state.speed = Math.max(0.25, Math.min(1, Number(x) || 1)); call('speed', { x: state.speed }); },
    info() { call('info').then((i) => Object.assign(state.info, i)).catch(() => {}); return { ...state.info }; },
    pins() { const out = {}; for (const [g, st] of Object.entries(state.pins)) out[g] = { ...st }; return out; },
    screenRGBA() { return state.screen ? state.screen.rgba : null; },
    leds() { return state.leds; },

    setPin(gpio, level) { call('setPin', { gpio, level: level ? 1 : 0 }); },
    releasePin(gpio) { call('releasePin', { gpio }); },
    setAnalog(gpio, volts) { call('setAnalog', { gpio, volts: Number(volts) || 0 }); },
    pressButton(which, ms) { call('press', { which, ms: ms == null ? null : Number(ms) }); },
    releaseButton(which) { call('release', { which }); },
    cmd(obj) { if (!state.booted) return false; call('cmd', { obj }); return true; },
    uartWrite(text) { call('uart', { text }); },
    schedule(tUs, fn) { if (tUs <= engine.time()) { queueMicrotask(() => fn(engine.time())); return; } state.schedules.push({ tUs, fn }); sendDeadline(); },
    /// Canvas-registered I2C addresses: kept in `opts.i2c` so every boot attaches exactly those (scan() then
    /// lists only what is wired, like engine A); `on=false` drops one (takes effect at the next boot).
    registerI2CDevice(bus, addr, on = true) {
      if (!Array.isArray(opts.i2c)) opts.i2c = [];
      const i = opts.i2c.indexOf(addr);
      if (on && i < 0) opts.i2c.push(addr);
      if (!on && i >= 0) opts.i2c.splice(i, 1);
      if (on && state.booted) call('i2cRegister', { bus, addr }).catch(() => {});
      return true;
    },
    i2cReply(bus, addr, bytes) { call('i2cReply', { bus, addr, bytes: Array.from(bytes) }); return true; },
    registerPulseSource() { return null; },
    registerSensor() { return null; },
    sensorValue() { return null; },
    on(name, cb) { (subs[name] = subs[name] || []).push(cb); return () => { const a = subs[name] || []; const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }; },
    async dispose() { state.disposed = true; try { await call('delete'); } catch {} transport.close(); },
  };
  return engine;
}
export { BOARDS };
