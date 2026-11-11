// host.js — owns a SimCore + LabDriver and paces it to wall time; speaks a small message protocol
// so the same code runs inside a Web Worker (worker.js) or in-thread under Node (engine-esp32sim.js
// when there is no Worker). Messages in: { op, id, ... }; messages out: { id, result } replies and
// { ev, data } events.
import { SimCore } from './core.js';
import { LabDriver, BOARDS } from './driver.js';

const now = () => performance.now();
const DEBUG = typeof process !== 'undefined' && process.env && process.env.SIM_DEBUG === '1';

export class DriverHost {
  /// `post(msg, transfer?)` delivers messages to the engine side.
  constructor(post) {
    this.post = post; this.core = null; this.driver = null;
    this.running = false; this.turbo = false; this.speed = 1; this.t0 = 0; this.cycles0 = 0;
    this.timer = null; this.busy = false; this.lastTime = 0;
    this.pendingDeadline = null; this.bootGen = 0;
  }
  emit(type, data) {
    if (type === 'screen') { const copy = data.rgba.slice(); this.post({ ev: type, data: { w: data.w, h: data.h, rgba: copy } }, [copy.buffer]); }
    else if (type === 'deadline') { this.running = false; this.post({ ev: type, data }); }
    else this.post({ ev: type, data });
  }
  async handle(m) {
    const reply = (result) => this.post({ id: m.id, result });
    try {
      switch (m.op) {
        case 'init': {
          this.core = await new SimCore({ wasmBytes: m.wasm, log: (s) => this.post({ ev: 'log', data: { msg: s } }) }).init();
          this.driver = new LabDriver(this.core, { emit: (t, d) => this.emit(t, d), log: (s) => this.post({ ev: 'log', data: { msg: s } }) });
          if (m.noJit) this.driver.noJit = true;
          return reply({ ok: true });
        }
        case 'boot': {
          this.stop();
          const gen = ++this.bootGen;   // a later boot supersedes this one: it must not touch the loop flags any more
          this.turbo = true; this.startLoop();
          let r;
          try { r = await this.driver.boot({ board: m.board, firmware: new Uint8Array(m.firmware), rom: new Uint8Array(m.rom), flashAt: m.flashAt, i2c: m.i2c, raw: !!m.raw }); }
          catch (e) { if (gen === this.bootGen) { this.turbo = false; this.running = false; } return reply({ ok: false, msg: String(e.message || e) }); }
          if (gen !== this.bootGen) return reply({ ok: false, msg: 'superseded' });
          this.turbo = false;
          // the board stays on (real time) once booted: the REPL must keep running for commands
          this.resync(); this.running = true; this.startLoop();
          if (m.program != null) {
            let s; try { s = await this.driver.start(m.program, m.name || 'main.py'); } catch (e) { s = { ok: false, msg: String(e.message || e) }; }
            r = { ...r, ...s, msg: s.ok ? r.msg : s.msg };
          }
          return reply(r);
        }
        case 'start': return reply(await this.withMachine(() => this.driver.start(m.program, m.name || 'main.py')));
        case 'check': return reply(await this.withMachine(() => this.driver.check(m.program, m.name || 'main.py')));
        case 'run': this.resync(); this.running = true; this.startLoop(); return reply(true);
        case 'pause': this.running = false; return reply(true);
        case 'step': { this.running = false; this.driver.advance(Math.round(this.core.cpuHz * (m.ms ?? 1) / 1000)); this.post({ ev: 'time', data: { tUs: this.driver.timeUs } }); return reply(this.driver.timeUs); }
        case 'stop': {
          const d = this.driver;
          if (!d.booted || d.halted) { d.setStatus('idle'); return reply(true); }
          // The driver's own timeouts are counted in simulated time; a machine that stands still never
          // reaches them, so a wall clock backs them up.
          let wall; const late = new Promise((res) => { wall = setTimeout(() => res('wall'), 8000); });
          const r = await Promise.race([this.withMachine(() => d.stop()).catch(() => 'err'), late]);
          clearTimeout(wall);
          if ((r === 'wall' || r === 'err') && d.booted) d.powerOff('stop timed out');
          if (!d.booted) this.stop();
          return reply(true);
        }
        case 'cmd': return reply(await this.withMachine(() => this.driver.cmd(m.obj)));
        case 'info': if (!this.driver.booted) return reply({ name: 'esp32sim', board: this.driver.board, status: 'idle' });   // 未開機：不要為了問版本讓迴圈空轉
          return reply(await this.withMachine(() => this.driver.info()));
        case 'setPin': return reply(this.driver.setPin(m.gpio, m.level));
        case 'releasePin': this.driver.releasePin(m.gpio); return reply(true);
        case 'setAnalog': return reply(this.driver.setAnalog(m.gpio, m.volts));
        case 'press': return reply(this.driver.pressButton(m.which, m.ms));
        case 'release': return reply(this.driver.releaseButton(m.which));
        case 'uart': this.driver.uartWrite(m.text); return reply(true);
        case 'dhtSet': return reply(this.driver.dhtSet(m.gpio, m.data));
        case 'i2cRegister': return reply(this.driver.i2cRegister(m.bus, m.addr));
        case 'i2cReply': return reply(this.driver.i2cReply(m.bus, m.addr, m.bytes));
        case 'deadline': this.driver.setDeadline(m.tUs); return reply(true);
        case 'resume': this.driver.resume(); this.resync(); this.running = true; this.startLoop(); return reply(true);
        case 'speed': this.speed = Math.max(0.05, Math.min(8, Number(m.x) || 1)); this.resync(); return reply(this.speed);
        case 'pins': return reply(this.driver.pins());
        case 'time': return reply(this.driver.timeUs);
        case 'status': return reply({ status: this.driver.status, running: this.running, booted: this.driver.booted, stats: this.driver.stats });
        case 'delete': this.stop(); this.core.delete(); return reply(true);
        default: return reply({ error: 'unknown op ' + m.op });
      }
    } catch (e) { this.post({ id: m.id, error: String(e && e.stack || e) }); }
  }
  stop() { this.running = false; this.turbo = false; }
  /// Run `fn` (which awaits the machine's REPL) with the machine advancing, even while paused.
  async withMachine(fn) {
    if (!this.driver.booted || this.driver.halted) throw new Error('not booted');
    const wasRunning = this.running, gen = this.bootGen;
    if (!wasRunning) { this.resync(); this.running = true; this.startLoop(); }
    try { return await fn(); } finally { if (!wasRunning && gen === this.bootGen) this.running = false; }
  }
  resync() { this.t0 = now(); this.cycles0 = this.core.cycles(); }
  startLoop() { if (!this.timer) this.timer = setTimeout(() => this.loop(), 0); }
  /// Wall-clock pacing (speed × real time), or flat out while `turbo` (boot). Yields every ~20 ms.
  loop() {
    this.timer = null;
    if (DEBUG) process.stderr.write(`[host] loop turbo=${this.turbo} running=${this.running} cycles=${this.core && this.core.cycles()} mode=${this.driver && this.driver.mode}\n`);
    if (!this.driver || !this.core || !this.core.emu || (!this.running && !this.turbo)) { this.running = this.running && !!(this.core && this.core.emu); return; }
    const d = this.driver, hz = this.core.cpuHz;
    const t = now();
    if (this.turbo) {
      const until = t + 20;
      while (now() < until && this.turbo) { if (d.advance(4_000_000) === 0 && (d.atDeadline || d.halted)) break; }
    } else {
      const target = this.cycles0 + (t - this.t0) / 1000 * hz * this.speed;
      let cur = this.core.cycles();
      if (target - cur > hz * 0.5) { this.resync(); cur = this.core.cycles(); }      // hopelessly behind: skip, don't burst
      const until = t + 20;
      while (cur < target && now() < until) {
        const n = d.advance(Math.min(Math.floor(target - cur), 2_000_000));
        if (target - cur < 1) break;
        cur = this.core.cycles();
        if (n === 0) { if (d.atDeadline || d.halted) { this.running = d.halted ? false : this.running; break; } }
      }
    }
    if (d.halted) { this.running = false; this.turbo = false; }
    if (now() - this.lastTime > 100) { this.lastTime = now(); this.post({ ev: 'time', data: { tUs: d.timeUs } }); }
    if (this.running || this.turbo) this.timer = setTimeout(() => this.loop(), this.turbo ? 0 : 4);
  }
}
export { BOARDS };
