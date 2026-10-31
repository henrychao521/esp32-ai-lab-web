// driver.js — the esp32-ai-lab board protocol on top of core.js: boots stock MicroPython in
// esp32sim, writes the `lab` package into the board's filesystem over the raw REPL, runs student
// programs through `lab.runner` (a thread, so the REPL stays free for `lab._dispatch_cmd` and
// `runner.stop`), and turns the machine's output into the sim-engine API's events.
// Environment neutral: host.js paces it (Web Worker or Node); nothing here touches the DOM.
import { KIND } from './core.js';
import { LAB_FILES, DRIVER_FILES } from './lab_bundle.js';

/// The boards: esp32sim board name, chip, firmware id (web/firmware/<id>.bin), memory, buttons.
export const BOARDS = {
  tqt_pro:         { chip: 'esp32s3', board: 'tqt_pro',         firmware: 'micropython-esp32s3', flashMb: 8,  psramMb: 2, screen: true,
                     buttons: { btn_l: 0, left: 0, boot: 0, btn1: 0, btn_r: 47, right: 47, btn2: 47, key: 47 }, battery: { gpio: 4, volts: 2.1 } },
  xiao_esp32s3:    { chip: 'esp32s3', board: 'xiao_esp32s3',    firmware: 'micropython-esp32s3', flashMb: 8,  psramMb: 8, screen: false,
                     buttons: { boot: 0, btn1: 0, btn_l: 0, left: 0 } },
  esp32s3_devkitc: { chip: 'esp32s3', board: 'esp32s3_devkitc', firmware: 'micropython-esp32s3', flashMb: 8,  psramMb: 2, screen: false,
                     buttons: { boot: 0, btn1: 0, btn_l: 0, left: 0 } },
  tdisplay_s3:     { chip: 'esp32s3', board: 'tdisplay_s3',     firmware: 'micropython-esp32s3', flashMb: 16, psramMb: 8, screen: false,
                     buttons: { btn_l: 0, left: 0, boot: 0, btn1: 0, btn_r: 14, right: 14, btn2: 14, key: 14 }, battery: { gpio: 4, volts: 2.1 },
                     note: 'octal PSRAM 與 i8080 螢幕未模擬：用四線版韌體開機，lab.display 只送文字' },
  devkit:          { chip: 'esp32',   board: 'devkit',          firmware: 'micropython-esp32',   flashMb: 4,  psramMb: 0, screen: false, flashAt: 0x1000,
                     buttons: { boot: 0, btn1: 0, btn_l: 0, left: 0 } },
  lab_generic:     { chip: 'esp32s3', board: 'lab_generic',     firmware: 'micropython-esp32s3', flashMb: 8,  psramMb: 2, screen: false, buttons: {} },
};
export const ROM_FOR = { esp32s3: 'esp32s3_rev0_rom.elf', esp32: 'esp32_rev300_rom.elf' };
/// I2C addresses answered by default (the parts the canvas offers); `scan()` lists these.
export const DEFAULT_I2C = [0x3c, 0x3d, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x3f, 0x76, 0x77, 0x68, 0x69, 0x48, 0x38, 0x5a, 0x29, 0x40, 0x57];
/// GPIOs whose mode changes are the chip's own business (flash/PSRAM, USB) and not reported.
const INTERNAL_PINS = new Set([19, 20, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]);

const enc = new TextEncoder(), dec = new TextDecoder();
export const UART_CHUNK = 100;          // bytes per delivery (the FIFO is 128)
export const UART_GAP_US = 9000;        // virtual time between deliveries: ~11 KB/s, what the raw REPL keeps up with (measured: bytes are lost above ~13 B/ms)
const RAW_ENTER = 'raw REPL; CTRL-B to exit\r\n>';
const LAB_MARK = '\x1eLAB';

/// A Python string literal for `code` (JSON escapes are Python escapes).
export const pyLiteral = (s) => JSON.stringify(s);

/// Parse a MicroPython traceback for `File "<name>", line N` and the last line (the error).
export function parseError(tb, name) {
  const lines = tb.trim().split(/\r?\n/).filter(Boolean);
  let line = null;
  for (const l of lines) { const m = /File "([^"]*)", line (\d+)/.exec(l); if (m && (!name || m[1] === name)) line = Number(m[2]); }
  return { line, msg: lines.length ? lines[lines.length - 1] : tb.trim() };
}

export class LabDriver {
  /// `core`: an initialised SimCore. `emit(type, payload)` receives the events; `log(text)` the emulator's own lines.
  constructor(core, { emit, log = () => {} } = {}) {
    this.core = core; this.emit = emit; this.log = log;
    this.cfg = null; this.board = null; this.cpuHz = 240e6;
    this.booted = false; this.rawMode = false; this.status = 'idle'; this.programName = null;
    this.uartQ = [];            // [{ bytes, atCycle }]
    this.cmdQ = [];             // raw REPL commands waiting their turn
    this.cur = null;            // the command in flight { code, resolve, reject, deadline, out, err }
    this.mode = 'normal';       // console parser: normal | enter | idle | ok | out | err | prompt
    this.rawBuf = ''; this.lineBuf = ''; this.outBatch = '';
    this.waiters = [];          // [{ test(text) | lab(obj), resolve, reject, deadline }]
    this.inputs = [];           // scheduled host drives [{ atCycle, fn }]
    this.deadlineCycle = Infinity; this.atDeadline = false;
    this.screen = null; this.leds = null; this.pinState = {};
    this.halted = 0;
    this.uartChunk = UART_CHUNK; this.uartGapUs = UART_GAP_US; this.stalls = 0;
    this.stats = { bootCycles: 0, bootWallMs: 0, promptCycles: 0 };
  }
  get cycles() { return this.core.cycles(); }
  get timeUs() { return Math.round(this.cycles / this.cpuHz * 1e6); }
  usToCycles(us) { return Math.round(us / 1e6 * this.cpuHz); }

  // ---------------------------------------------------------------- boot
  /// Create the machine and bring MicroPython to the raw REPL with the `lab` package in place.
  /// `firmware`/`rom` are Uint8Arrays; `i2c` the addresses to answer on both buses (null = DEFAULT_I2C).
  async boot({ board = 'tqt_pro', firmware, rom, flashAt, i2c = null, raw = false, promptTimeoutS = 25 }) {
    const cfg = BOARDS[board]; if (!cfg) throw new Error(`unknown board ${board}`);
    this.cfg = cfg; this.board = board; this.booted = false; this.rawMode = false; this.mode = 'normal';
    this.uartQ = []; this.cmdQ = []; this.cur = null; this.waiters = []; this.inputs = []; this.rawBuf = ''; this.lineBuf = ''; this.outBatch = '';
    this.deadlineCycle = Infinity; this.atDeadline = false; this.halted = 0; this.pinState = {}; this.screen = null; this.leds = null;
    const t0 = now();
    this.core.create(cfg.board, cfg.flashMb, cfg.psramMb, !this.noJit);
    this.cpuHz = this.core.cpuHz;
    this.core.load(KIND.rom, rom);
    this.core.loadAt(flashAt ?? cfg.flashAt ?? 0, firmware);
    if (cfg.battery) this.core.analog(cfg.battery.gpio, cfg.battery.volts);
    if (cfg.chip === 'esp32s3') for (const bus of [0, 1]) for (const a of (i2c || DEFAULT_I2C)) this.core.i2cAttach(bus, a);
    this.core.boot();
    this.setStatus('booting');
    if (raw) { this.booted = true; this.stats.bootCycles = this.cycles; this.stats.bootWallMs = now() - t0; this.setStatus('running'); return { ok: true, msg: 'raw firmware' }; }
    await this.waitText('>>> ', promptTimeoutS * 1e6);
    this.stats.promptCycles = this.cycles;
    await this.enterRaw();
    if (this.rawOnly) { this.booted = true; return { ok: true, msg: 'raw REPL' }; }
    this.driversWritten = new Set();
    await this.writeLabFiles();
    const p = await this.rawCommand(prelude(board, cfg.chip, this.hostTime ? this.hostTime() : new Date()));
    if (p.err) throw new Error('prelude: ' + p.err);
    this.booted = true; this.stats.bootCycles = this.cycles; this.stats.bootWallMs = now() - t0;
    this.setStatus('idle');
    return { ok: true, msg: `booted in ${(this.stats.bootCycles / this.cpuHz).toFixed(2)} s simulated, ${this.stats.bootWallMs.toFixed(0)} ms wall` };
  }
  /// The lab package into the filesystem, one file per command, each verified by size.
  async writeLabFiles() {
    const r0 = await this.rawCommand("import os\ntry:\n os.mkdir('lab')\nexcept OSError:\n pass\n");
    if (r0.err) throw new Error('mkdir lab: ' + r0.err);
    for (const [name, src] of Object.entries(LAB_FILES)) {
      const want = enc.encode(src).length;
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await this.rawCommand(`f=open(${pyLiteral(name)},'w')\nf.write(${pyLiteral(src)})\nf.close()\nprint(os.stat(${pyLiteral(name)})[6])\n`);
        const got = Number((r.out.trim().split('\n').pop() || '').trim());
        if (!r.err && got === want) break;
        this.log(`[driver] ${name}: attempt ${attempt + 1} ${r.err ? 'error ' + r.err.trim().split('\n').pop() : 'size ' + got + ' != ' + want}`);
        if (attempt === 2) throw new Error(`lab file ${name} did not arrive intact`);
      }
    }
  }
  async enterRaw() {
    this.mode = 'enter'; this.rawBuf = '';
    this.sendBytes(enc.encode('\r\x03\x03\x01'));
    await this.waitMode('idle', 5e6);
    this.rawMode = true;
  }
  /// Syntax check only: `{ ok, line, msg }`.
  async check(program, name = 'main.py') {
    const r = await this.rawCommand(`compile(${pyLiteral(program)},${pyLiteral(name)},'exec')\n`, 30e6, true);
    if (!r.err) return { ok: true, line: null, msg: '' };
    const e = parseError(r.err, name); return { ok: false, line: e.line, msg: e.msg };
  }
  /// Start a program in the runner thread.
  /// Drivers the program imports (ssd1306, lcd_api, machine_i2c_lcd) into the root of the flash, once per boot.
  async writeDriversFor(program) {
    this.driversWritten = this.driversWritten || new Set();
    for (const [file, d] of Object.entries(DRIVER_FILES)) {
      if (this.driversWritten.has(file) || !d.modules.some((m) => new RegExp('(^|\\n)[ \\t]*(import[^\\n]*\\b' + m + '\\b|from[ \\t]+' + m + '\\b)').test(program))) continue;
      const want = enc.encode(d.src).length;
      const r = await this.rawCommand(`import os\nf=open(${pyLiteral(file)},'w')\nf.write(${pyLiteral(d.src)})\nf.close()\nprint(os.stat(${pyLiteral(file)})[6])\n`);
      const got = Number((r.out.trim().split('\n').pop() || '').trim());
      if (r.err || got !== want) { this.log(`[driver] ${file}: ${r.err ? 'error' : 'size ' + got + ' != ' + want}`); continue; }
      this.driversWritten.add(file);
    }
  }
  async start(program, name = 'main.py') {
    if (!this.booted) throw new Error('not booted');
    await this.writeDriversFor(program);
    const c = await this.check(program, name);
    if (!c.ok) return { ok: false, msg: c.msg, line: c.line };
    const r = await this.rawCommand(`lab._stop=False\n_r=runner.start(${pyLiteral(program)},${pyLiteral(name)})\nif not _r[0]: print(_r)\n`);   // 成功時不印（否則 "(True, 'started')" 會進學生的主控台）
    if (r.err) return { ok: false, msg: parseError(r.err, name).msg, line: parseError(r.err, name).line };
    if (/\(False/.test(r.out)) return { ok: false, msg: r.out.trim(), line: null };
    this.programName = name; this.setStatus('running');
    return { ok: true, msg: 'started' };
  }
  /// Cooperative stop through `lab._stop`; true when the runner reported `done` within `timeoutUs`.
  async stop(timeoutUs = 3e6) {
    if (this.status !== 'running') return true;
    const done = this.waitLab((o) => o.t === 'done', timeoutUs).then(() => true, () => false);
    await this.rawCommand('runner.stop()\n');
    const ok = await done;
    if (ok) this.setStatus('idle');
    return ok;
  }
  /// A remote-control / vision command for `lab.on_cmd`.
  async cmd(obj) {
    const j = JSON.stringify(obj);
    const code = obj && obj.op === 'led' ? `lab._led_from_server(${obj.v ? 1 : 0})\n` : `lab._dispatch_cmd(json.loads(${pyLiteral(j)}))\n`;
    const r = await this.rawCommand(code);
    return !r.err;
  }
  async info() {
    const r = await this.rawCommand('import gc\nprint(json.dumps({"free":gc.mem_free(),"status":runner.state["status"],"file":runner.state["file"],"version":lab.__version__}))\n');
    try { return { name: 'esp32sim', board: this.board, ...JSON.parse(r.out.trim().split('\n').pop()) }; } catch { return { name: 'esp32sim', board: this.board, status: this.status }; }
  }

  // ---------------------------------------------------------------- inputs
  setPin(gpio, level) {
    const st = this.pinState[gpio];
    if (st && (st.mode === 'out' || st.mode === 'pwm')) return false;     // the chip drives it
    this.core.gpio(gpio, level ? 1 : 0); return true;
  }
  releasePin(gpio) { this.core.gpio(gpio, 2); }
  /// The canvas convention (engine A): raw = 4095 * V / 3.3; the firmware's read_uv applies the S3 curve to that count.
  setAnalog(gpio, volts) {
    const raw = Math.max(0, Math.min(4095, Math.round(volts / 3.3 * 4095)));
    if (this.cfg && this.cfg.chip !== 'esp32s3') { this.core.analog(gpio, volts); return true; }
    return this.core.w.esp32sim_lab_adc_raw(this.core.emu, gpio, raw) === 0;
  }
  buttonPin(nameOrGpio) {
    if (typeof nameOrGpio === 'number') return nameOrGpio;
    const n = String(nameOrGpio).toLowerCase();
    if (this.cfg && n in this.cfg.buttons) return this.cfg.buttons[n];
    const g = Number(n); return Number.isInteger(g) ? g : null;
  }
  pressButton(nameOrGpio, ms) {
    const gpio = this.buttonPin(nameOrGpio); if (gpio === null) return false;
    this.core.gpio(gpio, 0);
    if (ms !== undefined && ms !== null) this.inputs.push({ atCycle: this.cycles + this.usToCycles(ms * 1000), fn: () => this.core.gpio(gpio, 1) });
    return true;
  }
  releaseButton(nameOrGpio) { const gpio = this.buttonPin(nameOrGpio); if (gpio === null) return false; this.core.gpio(gpio, 1); return true; }
  /// Bytes straight into UART0 (serial-monitor input, or a raw firmware's console).
  uartWrite(text) { this.sendBytes(typeof text === 'string' ? enc.encode(text) : text); }
  i2cRegister(bus, addr) { return this.core.i2cAttach(bus, addr); }
  i2cReply(bus, addr, bytes) { return this.core.i2cData(bus, addr, bytes); }
  /// The host will be told (`deadline`) when the machine reaches `tUs`; it stops there until `resume()`.
  setDeadline(tUs) { this.deadlineCycle = tUs == null ? Infinity : this.usToCycles(tUs); }
  resume() { this.atDeadline = false; }

  // ---------------------------------------------------------------- the raw REPL transport
  sendBytes(bytes) {
    let at = this.uartQ.length ? this.uartQ[this.uartQ.length - 1].atCycle : this.cycles;
    for (let i = 0; i < bytes.length; i += this.uartChunk) {
      this.uartQ.push({ bytes: bytes.subarray(i, i + this.uartChunk), atCycle: at });
      at += this.usToCycles(this.uartGapUs);
    }
    if (bytes.length === 0) this.uartQ.push({ bytes, atCycle: at });
  }
  /// Run one raw-REPL command (Python source without the trailing Ctrl-D); resolves `{ out, err }`.
  rawCommand(code, timeoutUs = 30e6, quiet = false) {
    return new Promise((resolve, reject) => { this.cmdQ.push({ code, resolve, reject, timeoutUs, quiet }); this.pumpCmd(); });
  }
  pumpCmd() {
    if (this.cur || !this.cmdQ.length || this.mode !== 'idle') return;
    const c = this.cmdQ.shift();
    this.cur = { ...c, out: '', err: '', deadline: this.cycles + this.usToCycles(c.timeoutUs) };
    this.mode = 'ok';
    this.sendBytes(enc.encode(c.code + '\x04'));
  }
  waitText(text, timeoutUs) {
    return new Promise((resolve, reject) => this.waiters.push({ text, resolve, reject, deadline: this.cycles + this.usToCycles(timeoutUs), seen: '' }));
  }
  waitLab(pred, timeoutUs) {
    return new Promise((resolve, reject) => this.waiters.push({ lab: pred, resolve, reject, deadline: this.cycles + this.usToCycles(timeoutUs) }));
  }
  waitMode(mode, timeoutUs) {
    return new Promise((resolve, reject) => this.waiters.push({ mode, resolve, reject, deadline: this.cycles + this.usToCycles(timeoutUs) }));
  }

  // ---------------------------------------------------------------- console parsing
  /// UART0 text from the machine.
  feed(text) {
    for (const w of this.waiters) if (w.text) { w.seen = (w.seen + text).slice(-4096); }
    if (!this.rawMode && this.mode === 'normal') { this.console(text); return; }
    this.rawBuf += text;
    for (;;) {
      const b = this.rawBuf;
      if (this.mode === 'enter') {
        const i = b.indexOf(RAW_ENTER);
        if (i < 0) { if (b.length > 2 * RAW_ENTER.length) { this.console(b.slice(0, -RAW_ENTER.length)); this.rawBuf = b.slice(-RAW_ENTER.length); } return; }
        this.console(b.slice(0, i)); this.rawBuf = b.slice(i + RAW_ENTER.length); this.mode = 'idle'; this.pumpCmd(); continue;
      }
      if (this.mode === 'idle') { this.console(b); this.rawBuf = ''; return; }
      if (this.mode === 'ok') {
        const i = b.indexOf('OK');
        if (i < 0) { if (b.length > 1) { this.console(b.slice(0, -1)); this.rawBuf = b.slice(-1); } return; }
        this.console(b.slice(0, i)); this.rawBuf = b.slice(i + 2); this.mode = 'out'; continue;
      }
      if (this.mode === 'out' || this.mode === 'err') {
        const i = b.indexOf('\x04');
        const part = i < 0 ? b : b.slice(0, i);
        if (this.mode === 'out') { this.cur.out += part; this.console(part); } else { this.cur.err += part; }
        this.rawBuf = i < 0 ? '' : b.slice(i + 1);
        if (i < 0) return;
        this.mode = this.mode === 'out' ? 'err' : 'prompt'; continue;
      }
      if (this.mode === 'prompt') {
        const i = b.indexOf('>');
        if (i < 0) { this.console(b); this.rawBuf = ''; return; }
        this.console(b.slice(0, i)); this.rawBuf = b.slice(i + 1);
        const c = this.cur; this.cur = null; this.mode = 'idle';
        if (c.err && !c.quiet) this.emit('console', { t: 'err', s: c.err });
        c.resolve({ out: c.out, err: c.err });
        this.pumpCmd(); continue;
      }
      return;
    }
  }
  /// Console text for the canvas: `\x1eLAB{json}` lines become events, the rest `{t:"out"}`.
  console(text) {
    if (!text) return;
    this.lineBuf += text;
    let nl;
    while ((nl = this.lineBuf.indexOf('\n')) >= 0) {
      const line = this.lineBuf.slice(0, nl + 1); this.lineBuf = this.lineBuf.slice(nl + 1);
      const m = line.indexOf(LAB_MARK);
      if (m >= 0) {
        if (m > 0) this.outBatch += line.slice(0, m);
        try { const o = JSON.parse(line.slice(m + LAB_MARK.length)); this.flushOut(); this.labEvent(o); } catch { this.outBatch += line; }
      } else this.outBatch += line;
    }
    if (this.lineBuf && !this.lineBuf.startsWith('\x1e')) { this.outBatch += this.lineBuf; this.lineBuf = ''; }
    this.flushOut();
  }
  flushOut() { if (this.outBatch) { this.emit('console', { t: 'out', s: this.outBatch }); this.outBatch = ''; } }
  labEvent(o) {
    this.emit('console', o);
    if (o.t === 'done') { this.setStatus('idle'); }
    if (o.t === 'start') { this.setStatus('running'); }
    for (const w of this.waiters) if (w.lab && w.lab(o)) { w.done = true; w.resolve(o); }
    this.waiters = this.waiters.filter((w) => !w.done);
  }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('state', { status: s }); } }

  // ---------------------------------------------------------------- the run loop
  /// Advance the machine by up to `budget` cycles, delivering due inputs on the way. Returns the
  /// cycles run; 0 when stopped at a deadline (`atDeadline`) or halted.
  advance(budget) {
    budget = Math.floor(budget);
    if (!this.core.emu || this.halted || this.atDeadline || budget < 1) return 0;
    const start = this.cycles;
    let cur = start;
    const end = start + budget;
    while (cur < end) {
      this.deliverDue(cur);
      let next = end;
      if (this.uartQ.length) next = Math.min(next, this.uartQ[0].atCycle);
      for (const i of this.inputs) next = Math.min(next, i.atCycle);
      if (this.deadlineCycle < next) next = this.deadlineCycle;
      if (next <= cur) {
        if (next === this.deadlineCycle && cur >= this.deadlineCycle) { this.atDeadline = true; this.deadlineCycle = Infinity; this.drain(); this.emit('deadline', { tUs: this.timeUs }); break; }
        next = cur + 1;
      }
      const want = Math.max(1, Math.floor(Math.min(next - cur, 4_000_000)));
      const rc = this.core.run(want);
      const before = cur; cur = this.cycles;
      if (cur === before) { if (++this.stalls > 100) { this.halted = 98; this.log(`[driver] machine makes no progress (run ${want} at cycle ${cur}, rc ${rc})`); this.emit('halt', { code: 98 }); break; } } else this.stalls = 0;
      this.drain();
      if (rc !== 0) { this.halted = rc; this.emit('halt', { code: rc }); this.log(`[driver] machine stopped: code ${rc}`); break; }
      this.checkWaiters(cur);
    }
    this.deliverDue(cur);
    return cur - start;
  }
  deliverDue(cur) {
    while (this.uartQ.length && this.uartQ[0].atCycle <= cur) { const c = this.uartQ.shift(); if (c.bytes.length) this.core.uart0(c.bytes); }
    if (this.inputs.length) { const due = this.inputs.filter((i) => i.atCycle <= cur); if (due.length) { this.inputs = this.inputs.filter((i) => i.atCycle > cur); for (const i of due) i.fn(); } }
  }
  checkWaiters(cur) {
    if (!this.waiters.length && !this.cur) return;
    for (const w of this.waiters) {
      if (w.done) continue;
      if (w.text && w.seen.includes(w.text)) { w.done = true; w.resolve(); }
      else if (w.mode && this.mode === w.mode) { w.done = true; w.resolve(); }
      else if (cur > w.deadline) { w.done = true; w.reject(new Error(`timeout waiting for ${w.text ? JSON.stringify(w.text) : w.mode || 'lab event'}`)); }
    }
    this.waiters = this.waiters.filter((w) => !w.done);
    if (this.cur && cur > this.cur.deadline) { const c = this.cur; this.cur = null; this.mode = 'idle'; c.reject(new Error('raw REPL command timed out')); this.pumpCmd(); }
  }
  /// Everything the machine produced: console, frames, LEDs, lab events.
  drain() {
    if (!this.core.emu) return;
    const { texts, bins } = this.core.drain();
    for (const t of texts) {
      let m; try { m = JSON.parse(t); } catch { continue; }
      if (m.t === 'serial') { if (m.src === 'uart0' || m.src === 'usb') this.feed(m.data); }
      else if (m.t === 'ring') { this.leds = m.leds; this.emit('leds', { colors: m.leds }); }
      else if (m.t === 'emu') { this.log(m.msg); this.emit('log', { msg: m.msg }); }
    }
    for (const b of bins) {
      if (b[0] === 1 && b.length >= 5) {
        const w = b[1] | b[2] << 8, h = b[3] | b[4] << 8;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, j = 5; i < w * h; i++, j += 2) {
          const px = b[j] | b[j + 1] << 8;
          const r = (px >> 11) & 0x1f, g = (px >> 5) & 0x3f, bl = px & 0x1f;
          rgba[i * 4] = (r << 3) | (r >> 2); rgba[i * 4 + 1] = (g << 2) | (g >> 4); rgba[i * 4 + 2] = (bl << 3) | (bl >> 2); rgba[i * 4 + 3] = 255;
        }
        this.screen = { w, h, rgba };
        this.emit('screen', { w, h, rgba });
      }
    }
    for (const e of this.core.labTake()) {
      const tUs = e.c !== undefined ? Math.round(e.c / this.cpuHz * 1e6) : this.timeUs;
      switch (e.t) {
        case 'pin': { const st = this.pinState[e.gpio] = this.pinState[e.gpio] || { mode: 'out', level: 0, pull: 0, pwm: null }; st.level = e.level; this.emit('pin', { gpio: e.gpio, level: e.level, tUs }); break; }
        case 'pinmode': {
          if (INTERNAL_PINS.has(e.gpio)) break;
          const st = this.pinState[e.gpio] = this.pinState[e.gpio] || { mode: 'in', level: 0, pull: 0, pwm: null };
          st.mode = e.mode; st.pull = e.pull; if (e.mode !== 'pwm') st.pwm = null;
          this.emit('pinmode', { gpio: e.gpio, mode: e.mode, pull: e.pull, tUs }); break;
        }
        case 'pwm': {
          const st = this.pinState[e.gpio] = this.pinState[e.gpio] || { mode: 'pwm', level: 0, pull: 0, pwm: null };
          const hz = e.hz == null ? 0 : Math.round(e.hz * 1000) / 1000, duty = e.duty == null ? 0 : Math.round(e.duty * 1e5) / 1e5;
          st.pwm = e.hz == null ? null : { hz, duty };
          this.emit('pwm', { gpio: e.gpio, hz, duty, tUs }); break;
        }
        case 'spi': this.emit('spi', { host: e.host, bytes: Uint8Array.from(e.bytes), cs: e.cs.length ? e.cs[0] : null, sclk: e.sclk, mosi: e.mosi, tUs }); break;
        case 'i2c': this.emit('i2c', { bus: e.bus, addr: e.addr, bytes: Uint8Array.from(e.bytes), isRead: !!e.read, tUs }); break;
        case 'rmt': { const bits = new Uint8Array(e.bits.length); for (let i = 0; i < bits.length; i++) bits[i] = e.bits.charCodeAt(i) - 48; this.emit('rmt', { gpio: e.gpio, bits, tUs }); break; }
        case 'dropped': this.log(`[driver] ${e.n} lab events dropped`); break;
      }
    }
  }
  /// The pin snapshot the API's `pins()` returns; levels refreshed from the GPIO input register.
  pins() {
    const { lo, hi } = this.core.levels();
    const out = {};
    for (const [g, st] of Object.entries(this.pinState)) {
      const gpio = Number(g);
      const level = gpio < 32 ? (lo >>> gpio) & 1 : (hi >>> (gpio - 32)) & 1;
      out[gpio] = { mode: st.mode, level, pull: st.pull, pwm: st.pwm };
    }
    return out;
  }
  screenRGBA() { return this.screen ? this.screen.rgba : null; }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/// The Python run after the lab files are in place: `lab` wired like the agent does it, `lab.emit`
/// turned into console marker lines, the runner's print going to stdout only.
export function prelude(board, chip, when = new Date()) {
  // the RTC from the host clock (UTC; the examples add +8 h): no NTP without a network
  const t = [when.getUTCFullYear(), when.getUTCMonth() + 1, when.getUTCDate(), (when.getUTCDay() + 6) % 7, when.getUTCHours(), when.getUTCMinutes(), when.getUTCSeconds(), 0];
  return `import sys, json, lab, machine
from lab import boards, board_tqt, runner
try:
    machine.RTC().datetime((${t.join(',')}))
except Exception as e:
    print("rtc:", e)
lab.board = ${pyLiteral(board)}
lab.chip = ${pyLiteral(chip)}
try:
    lab.display = board_tqt.Display() if boards.HAS_DISPLAY.get(lab.board) else board_tqt.DummyDisplay()
except Exception as e:
    print("display init failed:", e)
    lab.display = board_tqt.DummyDisplay()
def _emit(t, **kw):
    if t == "out":
        return
    kw["t"] = t
    sys.stdout.write("\\x1eLAB" + json.dumps(kw) + "\\n")
lab.emit = _emit
def _print(*a, sep=" ", end="\\n", **k):
    sys.stdout.write(sep.join(str(x) for x in a) + end)
runner._print = _print
print("lab ready", lab.board)
`;
}
