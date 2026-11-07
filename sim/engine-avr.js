// engine-avr.js — 引擎 C：Arduino UNO（ATmega328P）＝ avr8js 逐指令模擬，跑 arduino-cli 編好的 .hex。
// 規格：docs/sim-engine-api.md v1（同一套介面，畫布不必知道是哪個引擎）。程式來源是 Intel HEX，不是 Python。
//
// 與引擎 A／B 的差別（畫布要知道的）：
// - 腳號：D0–D13＝0–13、A0–A5＝14–19；邏輯高 5 V；setAnalog 收 0～5 V。
// - PWM：硬體 PWM（analogWrite，D3/5/6/9/10/11）直接讀計時器暫存器算頻率與占空比；
//        軟體翻轉的腳（tone()、Servo 函式庫）用腳位邊緣量週期與高電位時間，連續 3 個快週期（< 40 ms）就改報 pwm。
//        兩種情況都不再逐次發 pin 事件（每秒上千次電路求解會拖垮畫面），改發 pwm(gpio, hz, duty)。
// - 序列埠：UART0 TX 以整行發 console {t:"out"}（UTF-8 解碼），原始位元組另發 uart。
// - 超音波：registerPulseSource(echo, fn) 登記後，任何輸出腳出現 5～50 µs 的高脈衝（TRIG）就在模擬時間
//          +250 µs 把 ECHO 拉高、再 fn() 微秒後放低，pulseIn() 量得到。
// - 沒有編譯器：check() 回 ok（不檢查 C++ 語法）；boot 需要 hex（opts.hex 或 firmware:"arduino:<id>"）。
import * as avr from "./vendor/avr8js.esm.js";
import { createUno, PIN_MAP, PWM_PINS, UNO_FREQ_HZ } from "./uno-board.js";

export const API_VERSION = 1;
export const AVR8JS_VERSION = "0.21.1";
const NPINS = PIN_MAP.length;   // 20
const SOFT_PWM_MAX_PERIOD_US = 40000, SOFT_PWM_MIN_EDGES = 3;
export const RESET_BUTTON = 99;  // 板上 RESET 鍵（畫布 data-gpio）

function makeEmitter() {
  const subs = {};
  return {
    on(name, cb) { (subs[name] = subs[name] || []).push(cb); return () => { const a = subs[name] || []; const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); }; },
    emit(name, ...args) { for (const cb of subs[name] || []) { try { cb(...args); } catch (e) { console.error("engine listener", name, e); } } },
  };
}

/** 依映像 id 讀預編譯 hex：瀏覽器用 fetch（sim/arduino-hex/<id>.hex），Node 直接讀檔 */
export async function loadHexById(id) {
  const url = new URL("./arduino-hex/" + id + ".hex", import.meta.url);
  if (typeof document === "undefined" && url.protocol === "file:") { const fs = await import("node:fs/promises"); return fs.readFile(url, "utf8"); }
  const r = await fetch(url.href); if (!r.ok) throw new Error("找不到 " + id + ".hex（" + r.status + "）"); return r.text();
}

export async function createAvrEngine(opts = {}) {
  const em = makeEmitter();
  let board = null, hexText = null, fileName = "sketch.hex";
  let status = "idle", speed = 1, loopTimer = null, lastReal = 0;
  const pulseSources = {}, i2cDevices = {};
  let i2cReplyBuf = null;
  // 腳位狀態（給 pins() 與事件去重）
  let touched = new Set(), adcPins = new Set();
  let hw = {}, soft = {}, trigRise = {};   // 硬體 PWM 快取、軟體 PWM 追蹤、TRIG 上升時間
  let txBuf = [], rxQueue = [];
  const dec = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
  const now = () => (board ? board.timeUs() : 0);
  const realNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  // ---------- 序列埠 ----------
  function flushLine(force) {
    while (true) {
      const i = txBuf.indexOf(10);
      if (i < 0) { if (force && txBuf.length) { const s = decode(txBuf); txBuf = []; em.emit("console", { t: "out", s: s + "\n" }); } return; }
      const line = txBuf.slice(0, i); txBuf = txBuf.slice(i + 1);
      if (line.length && line[line.length - 1] === 13) line.pop();
      em.emit("console", { t: "out", s: decode(line) + "\n" });
    }
  }
  const decode = (bytes) => (dec ? dec.decode(Uint8Array.from(bytes)) : String.fromCharCode(...bytes));

  // ---------- 軟體 PWM（tone、Servo）：邊緣量測 ----------
  function softEdge(g, level, t) {
    const s = soft[g] || (soft[g] = { rise: null, fall: null, n: 0, active: false, period: 0, duty: 0, last: t, sentHz: 0, sentDuty: -1 });
    s.last = t;
    if (level === 1) {
      if (s.rise !== null) {
        const period = t - s.rise, high = s.fall !== null && s.fall > s.rise ? s.fall - s.rise : -1, duty = high >= 0 ? high / period : -1;
        const fast = period > 0 && period < SOFT_PWM_MAX_PERIOD_US && duty > 0.005 && duty < 0.995;
        if (fast) { s.n++; s.period = period; s.duty = duty; }
        else { s.n = 0; if (s.active) { softOff(g, level, t); s.rise = t; return true; } }
      }
      s.rise = t;
      if (!s.active && s.n >= SOFT_PWM_MIN_EDGES) { s.active = true; em.emit("pinmode", g, "pwm", 0); sendSoft(g, s); return true; }
      if (s.active) { sendSoft(g, s); return true; }
    } else s.fall = t;
    return s.active;
  }
  function sendSoft(g, s) {
    const hz = Math.round(1e6 / s.period * 10) / 10, duty = Math.round(s.duty * 10000) / 10000;
    if (Math.abs(hz - s.sentHz) > s.sentHz * 0.01 || Math.abs(duty - s.sentDuty) > 0.0004) { s.sentHz = hz; s.sentDuty = duty; em.emit("pwm", g, hz, duty); }
  }
  function softOff(g, level, t) {
    const s = soft[g]; if (!s || !s.active) return;
    s.active = false; s.n = 0; s.sentHz = 0; s.sentDuty = -1;
    em.emit("pwm", g, 0, 0); em.emit("pinmode", g, "out", 0); em.emit("pin", g, level, t);
  }

  // ---------- 硬體 PWM（analogWrite）：每 1 ms 模擬時間讀一次計時器 ----------
  function pollPwm() {
    const t = now();
    for (const k of Object.keys(PWM_PINS)) {
      const g = Number(k), st = board.stateOf(g), p = st.mode === "out" ? board.pwmOf(g) : null, prev = hw[g];
      if (p && p.hz > 0) {
        touched.add(g);
        if (!prev) em.emit("pinmode", g, "pwm", 0);
        if (!prev || prev.hz !== p.hz || prev.duty !== p.duty) { hw[g] = p; em.emit("pwm", g, p.hz, p.duty); }
      } else if (prev) {
        delete hw[g]; em.emit("pwm", g, 0, 0); em.emit("pinmode", g, st.mode === "out" ? "out" : "in", st.mode === "in_pullup" ? 1 : 0);
        if (st.mode === "out") em.emit("pin", g, st.level, t);
      }
    }
    for (const [k, s] of Object.entries(soft)) if (s.active && t - s.last > Math.max(3 * s.period, 30000)) { const g = Number(k); const st = board.stateOf(g); softOff(g, st.level < 0 ? 0 : st.level, t); }
    if (rxQueue.length && !board.usart.rxBusy) board.usart.writeByte(rxQueue.shift());
  }

  // ---------- 腳位事件 ----------
  function onPin(g, level, t, timerDriven) {
    // 超音波 TRIG：5～50 µs 的高脈衝 → 已登記的 ECHO 腳排程回波
    if (level === 1) trigRise[g] = t;
    else if (trigRise[g] !== undefined) {
      const w = t - trigRise[g]; delete trigRise[g];
      if (w >= 5 && w <= 50) for (const [eg, fn] of Object.entries(pulseSources)) {
        const e = Number(eg); if (e === g) continue;
        let us = -1; try { us = fn(1); } catch (err) {}
        if (us === null || us === undefined || us < 0) continue;
        const b = board;
        board.cpu.addClockEvent(() => { if (board === b) b.setPin(e, 1); }, 250 * 16);
        board.cpu.addClockEvent(() => { if (board === b) b.setPin(e, 0); }, Math.round((250 + us) * 16));
      }
    }
    if (timerDriven || hw[g]) return;
    if (softEdge(g, level, t)) return;
    em.emit("pin", g, level, t);
  }
  function onPinMode(g, mode) {
    if (hw[g] || (soft[g] && soft[g].active)) { if (mode === "out") return; if (soft[g]) soft[g].active = false; }
    if (mode !== "in") touched.add(g);
    if (mode === "in_pullup") board.setPin(g, 1);   // 內部上拉：外面沒接東西時讀到 1（畫布接上電路後會依電路結果改寫）
    if (mode === "in" && adcPins.has(g)) { em.emit("pinmode", g, "adc", 0); return; }
    if (mode === "out") adcPins.delete(g);
    em.emit("pinmode", g, mode === "out" ? "out" : "in", mode === "in_pullup" ? 1 : 0);
  }
  function onAdcRead(ch) {
    const g = 14 + ch; if (g >= NPINS) return;
    if (!adcPins.has(g) && board.stateOf(g).mode !== "out") { adcPins.add(g); touched.add(g); em.emit("pinmode", g, "adc", 0); }
  }

  // ---------- I2C（TWI 主機）：寫入整筆交易在 STOP／重複 START 時發一次 i2c 事件 ----------
  let txn = null, readBuf = null, readIdx = 0;
  const registered = (addr) => !!(i2cDevices[0] && i2cDevices[0][addr]);
  function flushTxn() { if (txn && txn.write && txn.ack && txn.bytes.length) em.emit("i2c", 0, txn.addr, Uint8Array.from(txn.bytes), false); txn = null; }
  const i2c = {
    start() { flushTxn(); },
    stop() { flushTxn(); },
    connect(addr, write) {
      flushTxn(); const ack = registered(addr); txn = { addr, write, ack, bytes: [] };
      if (!write && ack) { i2cReplyBuf = null; em.emit("i2c", 0, addr, new Uint8Array(0), true, 32); readBuf = i2cReplyBuf || new Uint8Array(32); i2cReplyBuf = null; readIdx = 0; }
      return ack;
    },
    write(v) { if (txn) txn.bytes.push(v); return !!(txn && txn.ack); },
    read() { const v = readBuf && readIdx < readBuf.length ? readBuf[readIdx] : 0xff; readIdx++; return v; },
  };

  // ---------- 開機與排程 ----------
  function buildBoard() {
    // 先把畫布上舊板子的狀態清乾淨（輸出／PWM 腳回到輸入）
    for (const g of touched) { if (hw[g] || (soft[g] && soft[g].active)) em.emit("pwm", g, 0, 0); em.emit("pinmode", g, "in", 0); }
    touched = new Set(); adcPins = new Set(); hw = {}; soft = {}; trigRise = {}; txBuf = []; rxQueue = []; txn = null;
    board = createUno(avr, { hex: hexText, onPin, onPinMode, onAdcRead, i2c, onByte: (b) => { txBuf.push(b); em.emit("uart", String.fromCharCode(b)); } });
    board.setAnalog(0, 0);
  }
  function chunk(us) {   // 以 1 ms 為單位前進，每單位後檢查 PWM、序列埠輸入
    let left = us;
    while (left > 0) { const d = Math.min(1000, left); board.runMicros(d); left -= d; pollPwm(); }
    flushLine(false);
  }
  function loop() {
    loopTimer = null; if (status !== "running" || !board) return;
    const t = realNow(); let want = Math.min(50, (t - lastReal) * speed); lastReal = t;   // 落後太多（分頁在背景）就丟掉，不追
    const t0 = realNow(); let done = 0;
    while (done < want) { chunk(1000); done += 1; if (realNow() - t0 > 12) break; }   // 一刻度最多 12 ms 實際時間，留給畫面
    loopTimer = setTimeout(loop, 4);
  }
  function startLoop() { if (loopTimer || status !== "running") return; lastReal = realNow(); loopTimer = setTimeout(loop, 0); }
  function stopLoop() { if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; } }
  function setStatus(s) { if (status === s) return; status = s; em.emit("state", s); }

  const snapshot = () => {
    const out = {};
    for (let g = 0; g < NPINS; g++) {
      const st = board ? board.stateOf(g) : { mode: "in", level: -1 };
      const s = soft[g] && soft[g].active ? { hz: Math.round(1e6 / soft[g].period * 10) / 10, duty: soft[g].duty } : null;
      const pw = hw[g] || s;
      const mode = pw ? "pwm" : st.mode === "out" ? "out" : adcPins.has(g) ? "adc" : "in";
      out[g] = { mode, level: st.mode === "out" ? st.level : board ? board.inputLevel(g) : 0, pull: st.mode === "in_pullup" ? 1 : 0, pwm: pw ? { hz: pw.hz, duty: pw.duty } : null, idle: !touched.has(g) && !adcPins.has(g) };
    }
    return out;
  };

  const engine = {
    apiVersion: API_VERSION, kind: "arduino-avr8js", board: "uno",
    capabilities: { screen: false, i2c: true, spi: false, uart: true, rmt: false, step: true, cycleAccurate: true, arduino: true, hex: true, python: false },
    get running() { return status === "running"; },
    get status() { return status; },
    on: em.on,
    /** boot({ hex, firmware:"arduino:<id>", name, autorun }) → { ok, msg }。autorun:false 時不啟動即時排程（Node 測試用 advance() 自己推） */
    async boot({ hex, firmware, name, autorun = true } = {}) {
      stopLoop();
      try {
        if (!hex && firmware && firmware.startsWith("arduino:")) hex = await loadHexById(firmware.slice(8));
        if (!hex) return { ok: false, msg: "Arduino 程式要先編譯，App 內暫不支援；請用範例或匯入 .hex" };
        hexText = hex; fileName = name || (firmware ? firmware.slice(8) + ".hex" : "sketch.hex");
        buildBoard();
      } catch (e) { setStatus("idle"); return { ok: false, msg: e.message }; }
      em.emit("console", { t: "start", file: fileName });
      setStatus("running"); if (autorun) startLoop();
      return { ok: true, msg: "flash " + board.flashBytes + " B" };
    },
    run() { if (!board) return; if (status !== "running") { setStatus("running"); startLoop(); } },
    pause() { if (status === "running") { stopLoop(); flushLine(true); setStatus("paused"); } },
    step() { if (!board || status === "running") return false; board.step(); pollPwm(); flushLine(false); return true; },
    async reset() { stopLoop(); if (board) { flushLine(true); buildBoard(); } setStatus("idle"); return true; },
    async stop() {
      const was = status !== "idle"; stopLoop(); if (board) flushLine(true);
      if (board) buildBoard();   // 真板子按停止＝拔電：腳位全回到輸入
      if (was) em.emit("console", { t: "done", ok: true, stopped: true });
      setStatus("idle"); return true;
    },
    async check() { return { ok: true, unchecked: true, msg: "Arduino 程式不在 App 內編譯，沒有檢查語法" }; },
    time: () => now(),
    setSpeed(x) { speed = Math.max(0.05, Math.min(4, Number(x) || 1)); },
    schedule(tUs, fn) { if (!board) { setTimeout(fn, 0); return; } board.cpu.addClockEvent(fn, Math.max(1, Math.round((tUs - now()) * 16))); },
    /** 非規格：同步推進模擬時間 us 微秒（Node 測試、單步除錯用） */
    advance(us) { if (!board) return; chunk(us); },
    info: () => ({ name: "Arduino UNO", board: "uno", version: "avr8js " + AVR8JS_VERSION, status, file: fileName, cpu: "ATmega328P @ 16 MHz", flash: board ? board.flashBytes : 0, simUs: now() }),
    pins: snapshot,
    setPin(g, level) { if (board && g >= 0 && g < NPINS) board.setPin(g, level ? 1 : 0); },
    setAnalog(g, volts) { if (!board) return; const ch = g >= 14 ? g - 14 : g; board.setAnalog(ch, volts); },
    pressButton(g) { if (g === RESET_BUTTON || String(g).toLowerCase() === "reset") { if (hexText) { buildBoard(); em.emit("console", { t: "start", file: fileName }); setStatus("running"); startLoop(); } return true; } return false; },
    releaseButton() { return false; },
    cmd() { return false; },
    uartWrite(text) { const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text) : Array.from(text, (c) => c.charCodeAt(0)); for (const b of bytes) rxQueue.push(b); },
    i2cReply(bus, addr, bytes) { i2cReplyBuf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes); },
    registerI2CDevice(bus, addr, on = true) { i2cDevices[bus] = i2cDevices[bus] || {}; if (on) i2cDevices[bus][addr] = true; else delete i2cDevices[bus][addr]; },
    registerPulseSource(gpio, fn) { if (fn) pulseSources[gpio] = fn; else delete pulseSources[gpio]; },
    registerSensor() { return false; },   // DHT22 的位元時序未實作（見 docs 限制）
    screenRGBA: () => null,
    screenSize: () => [0, 0],
    takeScreenDirty: () => false,
    sensorValue: () => null,
    get _board() { return board; },
    freqHz: UNO_FREQ_HZ,
  };
  return engine;
}
