// uno-board.js — Arduino UNO（ATmega328P @ 16 MHz）板子包裝：把 avr8js 的 CPU＋周邊組起來，
// 對外只給「腳位事件／序列埠位元組／I2C 交易／ADC 電壓／跑 N 微秒」這幾個動作。
// 來源：arduino-proto/uno-board.mjs（2026-11-07 可行性原型，git 005884b），接進 sim/ 時加了：
//   TWI（I2C 主機，Wire 函式庫用的硬體 TWI）、analogRead 通知、硬體 PWM（timer 比較輸出）辨識與占空比換算、輸入腳電位讀取。
// 呼叫端把 avr8js 模組物件傳進來（瀏覽器與 Node 都用 sim/vendor/avr8js.esm.js），這支本身不 import 任何東西。

export const UNO_FREQ_HZ = 16_000_000;
export const FLASH_BYTES = 0x8000; // 32 KB

/** Arduino UNO 腳位 → (port, bit)。D0–D7＝PD0–7、D8–D13＝PB0–5、A0–A5＝PC0–5（數位 14–19）。 */
export const PIN_MAP = (() => {
  const m = [];
  for (let i = 0; i < 8; i++) m[i] = { port: "D", bit: i };
  for (let i = 0; i < 6; i++) m[8 + i] = { port: "B", bit: i };
  for (let i = 0; i < 6; i++) m[14 + i] = { port: "C", bit: i };
  return m;
})();

/** 硬體 PWM 腳（analogWrite）：腳號 → 計時器、比較通道。D5/D6＝timer0（約 977 Hz）、D9/D10＝timer1、D3/D11＝timer2（約 490 Hz） */
export const PWM_PINS = {
  6: { timer: 0, ch: "A" }, 5: { timer: 0, ch: "B" },
  9: { timer: 1, ch: "A" }, 10: { timer: 1, ch: "B" },
  11: { timer: 2, ch: "A" }, 3: { timer: 2, ch: "B" },
};
// ATmega328P 資料空間位址（資料手冊第 30 節暫存器摘要）
const REG = {
  0: { A: 0x44, B: 0x45, ocrA: 0x47, ocrB: 0x48, bits: 8 },
  1: { A: 0x80, B: 0x81, ocrA: 0x88, ocrB: 0x8a, icr: 0x86, bits: 16 },
  2: { A: 0xb0, B: 0xb1, ocrA: 0xb3, ocrB: 0xb4, bits: 8 },
};
const PRESCALE = { 0: [0, 1, 8, 64, 256, 1024, 0, 0], 1: [0, 1, 8, 64, 256, 1024, 0, 0], 2: [0, 1, 8, 32, 64, 128, 256, 1024] };

/** Intel HEX 文字 → 寫進 progMem（Uint16Array，little-endian 字） */
export function loadHex(hexText, target) {
  const bytes = new Uint8Array(target.buffer);
  let upper = 0;
  let n = 0;
  for (const raw of String(hexText).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ":") throw new Error("不是 Intel HEX 檔（第一個字不是冒號）：" + line.slice(0, 20));
    const len = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    if (type === 0x01) break;
    if (type === 0x04) { upper = parseInt(line.substr(9, 4), 16) << 16; continue; }
    if (type === 0x02) { upper = parseInt(line.substr(9, 4), 16) << 4; continue; }
    if (type !== 0x00) continue;
    let sum = 0;
    for (let i = 1; i < line.length; i += 2) sum = (sum + parseInt(line.substr(i, 2), 16)) & 0xff;
    if (sum !== 0) throw new Error("HEX 校驗和錯誤：" + line.slice(0, 20));
    for (let i = 0; i < len; i++) {
      const a = upper + addr + i;
      if (a < bytes.length) { bytes[a] = parseInt(line.substr(9 + i * 2, 2), 16); n++; }
      else throw new Error("程式超過 32 KB（UNO 的 flash 大小）");
    }
  }
  if (!n) throw new Error("HEX 檔裡沒有程式資料");
  return n;
}

/**
 * @param {object} avr  avr8js 模組命名空間
 * @param {object} opts
 *   hex        Intel HEX 字串
 *   onPin      (pin, level, tUs, timerDriven) 輸出腳電位變化；timerDriven＝這支腳正由計時器（硬體 PWM）驅動
 *   onPinMode  (pin, mode, tUs) 'in'|'in_pullup'|'out'
 *   onByte     (byte) UART0 TX 一個位元組（含波特率時序）
 *   onAdcRead  (channel) 程式開始一次 analogRead（在換算之前呼叫，可在裡面 setAnalog）
 *   i2c        TWI 事件處理物件 { start(repeated), stop(), connect(addr, write) → ack, write(byte) → ack, read(ack) → byte }
 */
export function createUno(avr, opts = {}) {
  const { CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
    AVRIOPort, portBConfig, portCConfig, portDConfig, AVRUSART, usart0Config,
    AVRADC, adcConfig, AVRTWI, twiConfig, PinState, ADCMuxInputType } = avr;

  const progMem = new Uint16Array(FLASH_BYTES / 2);
  const flashBytes = opts.hex ? loadHex(opts.hex, progMem) : 0;
  const cpu = new CPU(progMem);
  const timers = [new AVRTimer(cpu, timer0Config), new AVRTimer(cpu, timer1Config), new AVRTimer(cpu, timer2Config)];
  const ports = { B: new AVRIOPort(cpu, portBConfig), C: new AVRIOPort(cpu, portCConfig), D: new AVRIOPort(cpu, portDConfig) };
  const usart = new AVRUSART(cpu, usart0Config, UNO_FREQ_HZ);
  const adc = new AVRADC(cpu, adcConfig);
  const twi = new AVRTWI(cpu, twiConfig, UNO_FREQ_HZ);

  const timeUs = () => Math.floor((cpu.cycles / UNO_FREQ_HZ) * 1e6);
  const timerDriven = (pin) => { const pm = PIN_MAP[pin]; return !(ports[pm.port].overrideMask & (1 << pm.bit)); };

  const pinCache = new Map();
  const stateOf = (port, bit) => {
    const s = ports[port].pinState(bit);
    if (s === PinState.Low) return { mode: "out", level: 0 };
    if (s === PinState.High) return { mode: "out", level: 1 };
    if (s === PinState.InputPullUp) return { mode: "in_pullup", level: -1 };
    return { mode: "in", level: -1 };
  };
  const scanPort = (portName, silent = false) => {
    for (let pin = 0; pin < PIN_MAP.length; pin++) {
      const pm = PIN_MAP[pin];
      if (pm.port !== portName) continue;
      const now = stateOf(pm.port, pm.bit);
      const prev = pinCache.get(pin);
      pinCache.set(pin, now);
      if (silent) continue;
      if (!prev || prev.mode !== now.mode) opts.onPinMode?.(pin, now.mode, timeUs());
      if (now.level >= 0 && (!prev || prev.level !== now.level)) opts.onPin?.(pin, now.level, timeUs(), timerDriven(pin));
    }
  };
  for (const name of Object.keys(ports)) ports[name].addListener(() => scanPort(name));

  usart.onByteTransmit = (b) => opts.onByte?.(b);

  // analogRead：先通知（畫布在這裡把電路算出的電壓 setAnalog 進來），再交給 avr8js 換算
  const origRead = adc.onADCRead;
  adc.onADCRead = (input) => {
    if (input.type === ADCMuxInputType.SingleEnded) opts.onAdcRead?.(input.channel);
    origRead(input);
  };

  // I2C（TWI 主機）：事件交給呼叫端決定 ACK 與回讀資料
  if (opts.i2c) {
    const h = opts.i2c;
    twi.eventHandler = {
      start: (repeated) => { h.start?.(repeated); twi.completeStart(); },
      stop: () => { h.stop?.(); twi.completeStop(); },
      connectToSlave: (addr, write) => twi.completeConnect(!!h.connect?.(addr, write)),
      writeByte: (v) => twi.completeWrite(!!h.write?.(v)),
      readByte: (ack) => twi.completeRead((h.read?.(ack) ?? 0xff) & 0xff),
    };
  }

  /** 硬體 PWM：從計時器暫存器算出頻率與占空比（只對 PWM_PINS 有意義；沒有在比較輸出時回 null） */
  function pwmOf(pin) {
    const p = PWM_PINS[pin]; if (!p || !timerDriven(pin)) return null;
    const R = REG[p.timer], d = cpu.data;
    const tA = d[R.A], tB = d[R.B];
    const com = p.ch === "A" ? (tA >> 6) & 3 : (tA >> 4) & 3; if (!com) return null;
    const cs = tB & 7, N = PRESCALE[p.timer][cs]; if (!N) return { hz: 0, duty: 0 };
    const r16 = (a) => d[a] | (d[a + 1] << 8);
    const ocr = R.bits === 16 ? r16(p.ch === "A" ? R.ocrA : R.ocrB) : d[p.ch === "A" ? R.ocrA : R.ocrB];
    let wgm, top, kind;   // kind: fast | pc（相位正確）| ctc | normal
    if (p.timer === 1) {
      wgm = (tA & 3) | (((tB >> 3) & 3) << 2);
      const T = { 1: [0xff, "pc"], 2: [0x1ff, "pc"], 3: [0x3ff, "pc"], 5: [0xff, "fast"], 6: [0x1ff, "fast"], 7: [0x3ff, "fast"],
        8: [r16(R.icr), "pc"], 9: [r16(R.ocrA), "pc"], 10: [r16(R.icr), "pc"], 11: [r16(R.ocrA), "pc"], 14: [r16(R.icr), "fast"], 15: [r16(R.ocrA), "fast"],
        4: [r16(R.ocrA), "ctc"], 12: [r16(R.icr), "ctc"], 0: [0xffff, "normal"] }[wgm] || [0xffff, "normal"];
      [top, kind] = T;
    } else {
      wgm = (tA & 3) | (((tB >> 3) & 1) << 2);
      const T = { 1: [0xff, "pc"], 3: [0xff, "fast"], 5: [d[R.ocrA], "pc"], 7: [d[R.ocrA], "fast"], 2: [d[R.ocrA], "ctc"], 0: [0xff, "normal"] }[wgm] || [0xff, "normal"];
      [top, kind] = T;
    }
    top = Math.max(1, top);
    let hz, duty;
    if (kind === "fast") { hz = UNO_FREQ_HZ / (N * (top + 1)); duty = Math.min(1, (ocr + 1) / (top + 1)); }
    else if (kind === "pc") { hz = UNO_FREQ_HZ / (N * 2 * top); duty = Math.min(1, ocr / top); }
    else { hz = UNO_FREQ_HZ / (N * 2 * (top + 1)); duty = 0.5; }   // CTC／一般模式的翻轉輸出：方波
    if (com === 3) duty = 1 - duty;
    if (com === 1 && kind !== "ctc" && kind !== "normal") duty = 0.5;
    return { hz: Math.round(hz * 100) / 100, duty: Math.round(duty * 10000) / 10000 };
  }

  const run = (target) => { while (cpu.cycles < target) { avrInstruction(cpu); cpu.tick(); } };
  const board = {
    cpu, timers, ports, usart, adc, twi, progMem, flashBytes,
    freqHz: UNO_FREQ_HZ,
    timeUs, timerDriven, pwmOf,
    /** 設 ADC 腳電壓（A0–A5＝通道 0–5 或數位腳號 14–19），單位 V，0～5 */
    setAnalog(ch, volts) { if (ch >= 14) ch -= 14; if (ch < 0 || ch > 7) return; adc.channelValues[ch] = Math.min(5, Math.max(0, volts)); },
    /** 外部電路把輸入腳拉到某電位（腳是輸出時 avr8js 自己忽略） */
    setPin(pin, level) { const pm = PIN_MAP[pin]; if (!pm) return; ports[pm.port].setPin(pm.bit, !!level); },
    /** 輸入腳目前讀到的電位（PIN 暫存器） */
    inputLevel(pin) { const pm = PIN_MAP[pin]; if (!pm) return 0; return (cpu.data[ports[pm.port].portConfig.PIN] >> pm.bit) & 1; },
    stateOf(pin) { const pm = PIN_MAP[pin]; return stateOf(pm.port, pm.bit); },
    runMicros(us) { run(cpu.cycles + Math.round((us * UNO_FREQ_HZ) / 1e6)); },
    runCycles(n) { run(cpu.cycles + n); },
    step() { avrInstruction(cpu); cpu.tick(); },
    reset() { cpu.reset(); pinCache.clear(); scanPort("B", true); scanPort("C", true); scanPort("D", true); },
  };
  scanPort("B", true); scanPort("C", true); scanPort("D", true);
  return board;
}
