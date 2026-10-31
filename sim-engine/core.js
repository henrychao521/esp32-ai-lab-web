// core.js — the thinnest layer over the esp32sim WebAssembly module (mikroverk/esp32sim, MIT,
// built from /Volumes/Work/esp32sim-boards with the esp32-ai-lab boards and the `esp32sim_lab_*`
// ABI). Environment neutral: runs in a Web Worker or under Node. No pacing, no protocol: that is
// driver.js.
import { createJitHost } from './vendor/jit.mjs';

export const KIND = { rom: 0, bootloader: 1, ptable: 2, app: 3, elf: 4, flash: 5, script: 6, picture: 7 };

const enc = new TextEncoder(), dec = new TextDecoder();

export class SimCore {
  constructor({ wasmBytes, wasmModule, log = () => {} } = {}) {
    this.wasmBytes = wasmBytes; this.wasmModule = wasmModule; this.log = log;
    this.w = null; this.emu = 0; this.cpuHz = 240e6;
  }
  mem() { return new Uint8Array(this.w.memory.buffer); }
  async init() {
    const jit = createJitHost(() => this.w);
    const imports = { env: { ...jit.imports, host_profile_now: () => performance.now(),
      host_log: (p, n) => this.log(dec.decode(this.mem().subarray(p, p + n))) } };
    const r = this.wasmModule ? await WebAssembly.instantiate(this.wasmModule, imports) : await WebAssembly.instantiate(this.wasmBytes, imports);
    this.w = (r.instance || r).exports;
    this.jit = jit;
    return this;
  }
  withBytes(bytes, f) {
    const p = this.w.esp32sim_alloc(bytes.length); this.mem().set(bytes, p);
    try { return f(p, bytes.length); } finally { this.w.esp32sim_free(p, bytes.length); }
  }
  /// A new machine; `board` is a CLI board name (tqt_pro, xiao_esp32s3, esp32s3_devkitc, tdisplay_s3, lab_generic, devkit).
  create(board, flashMb, psramMb, jit = true) {
    if (this.emu) { this.w.esp32sim_delete(this.emu); this.emu = 0; }
    this.emu = this.withBytes(enc.encode(board), (p, n) => this.w.esp32sim_new(p, n, flashMb | 0, psramMb | 0));
    if (!this.emu) throw new Error(`esp32sim_new(${board}) failed`);
    this.w.esp32sim_set_jit(this.emu, jit ? 1 : 0);
    this.cpuHz = this.w.esp32sim_cpu_hz(this.emu);
    return this.emu;
  }
  delete() { if (this.emu) { this.w.esp32sim_delete(this.emu); this.emu = 0; } }
  load(kind, bytes) { const rc = this.withBytes(bytes, (p, n) => this.w.esp32sim_load(this.emu, kind, p, n)); if (rc !== 0) throw new Error(`load kind ${kind} failed (rc ${rc})`); }
  loadAt(offset, bytes) { const rc = this.withBytes(bytes, (p, n) => this.w.esp32sim_load_at(this.emu, offset >>> 0, p, n)); if (rc !== 0) throw new Error(`load at ${offset} failed`); }
  boot(appDirect = false) { const rc = this.w.esp32sim_boot(this.emu, appDirect ? 1 : 0); if (rc !== 0) throw new Error(`boot failed (rc ${rc})`); }
  /// Run `n` more cycles; 0 while the machine can go on, else the stop code of docs/wasm.md.
  run(n) { return this.w.esp32sim_run(this.emu, n >>> 0, Date.now()); }
  cycles() { return this.w.esp32sim_cycles(this.emu); }
  insns() { return this.w.esp32sim_insns(this.emu); }
  timeUs() { return this.cycles() / this.cpuHz * 1e6; }
  /// Everything the machine sent since the last call: `{ texts: string[], bins: Uint8Array[] }` (copies).
  drain() {
    const n = this.w.esp32sim_out_take(this.emu), texts = [], bins = [];
    for (let i = 0; i < n; i++) {
      const kind = this.w.esp32sim_out_kind(this.emu, i), p = this.w.esp32sim_out_ptr(this.emu, i), len = this.w.esp32sim_out_len(this.emu, i);
      if (kind === 1) texts.push(dec.decode(this.mem().subarray(p, p + len)));
      else bins.push(this.mem().slice(p, p + len));
    }
    return { texts, bins };
  }
  /// The lab events since the last call (pin, pwm, pinmode, spi, i2c, rmt, dropped), parsed.
  labTake() {
    const len = this.w.esp32sim_lab_take(this.emu), p = this.w.esp32sim_lab_ptr(this.emu);
    if (len <= 2) return [];
    return JSON.parse(dec.decode(this.mem().subarray(p, p + len)));
  }
  gpio(pin, level) { this.w.esp32sim_lab_gpio(this.emu, pin, level); }        // 0 | 1 | 2 (release)
  analog(pin, volts) { this.w.esp32sim_lab_analog(this.emu, pin, volts); }
  levels() { const lo = this.w.esp32sim_lab_levels(this.emu, 0) >>> 0, hi = this.w.esp32sim_lab_levels(this.emu, 1) >>> 0; return { lo, hi }; }
  pwm(pin) { const hz = this.w.esp32sim_lab_pwm_hz(this.emu, pin); return hz < 0 ? null : { hz, duty: this.w.esp32sim_lab_pwm_duty(this.emu, pin) }; }
  i2cAttach(bus, addr) { return this.w.esp32sim_lab_i2c_attach(this.emu, bus, addr) === 0; }
  i2cData(bus, addr, bytes) { return this.withBytes(Uint8Array.from(bytes), (p, n) => this.w.esp32sim_lab_i2c_data(this.emu, bus, addr, p, n)) === 0; }
  uart0(bytes) { this.withBytes(bytes, (p, n) => this.w.esp32sim_lab_uart0(this.emu, p, n)); }
  /// The page protocol's text input (`{"t":"btn",...}`, `{"t":"key",...}`), polled by the machine at its push interval.
  inText(json) { this.withBytes(enc.encode(json), (p, n) => this.w.esp32sim_in_text(this.emu, p, n)); }
  /// The machine's end-of-run reports as `{"t":"emu"}` messages in the outbox.
  reports() { this.w.esp32sim_reports(this.emu); }
}
