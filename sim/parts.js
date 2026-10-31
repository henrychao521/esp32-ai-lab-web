// parts.js — 第二批元件的「協定解碼」與行為，做在元件層、只吃引擎事件（docs/sim-engine-api.md），兩個引擎共用。
// 純函式／類別，Node 可測（sim/test_parts.mjs）。畫布用 attachPart(engine, part, ctx) 把元件接上引擎。

/** SSD1306（I2C 0x3C）：控制位元組 0x00＝命令、0x40＝資料；水平定址（MicroPython 驅動用的）把 128×64 的 GDDRAM 填滿。 */
export class SSD1306Decoder {
  constructor(width = 128, height = 64) {
    this.width = width; this.height = height; this.pages = height / 8;
    this.ram = new Uint8Array(width * this.pages);
    this.on = false; this.inverse = false; this.contrast = 0x7f;
    this.colStart = 0; this.colEnd = width - 1; this.pageStart = 0; this.pageEnd = this.pages - 1; this.col = 0; this.page = 0; this.mode = 0;
    this.pending = []; this.dirty = false;
  }
  /** 一筆 I2C 寫入（可含多個控制位元組） */
  write(bytes) {
    let i = 0;
    while (i < bytes.length) {
      const ctrl = bytes[i++]; const isData = (ctrl & 0x40) !== 0, single = (ctrl & 0x80) !== 0;
      if (isData) { const end = single ? i + 1 : bytes.length; for (; i < end && i < bytes.length; i++) this.data(bytes[i]); }
      else { const end = single ? i + 1 : bytes.length; for (; i < end && i < bytes.length; i++) this.cmd(bytes[i]); }
    }
  }
  cmd(b) {
    if (this.pending.length) { const [c, args] = this.pending[0]; args.push(b); if (args.length >= (c === 0x21 || c === 0x22 ? 2 : 1)) { this.pending.shift(); this.applyCmd(c, args); } return; }
    if (b === 0xAE) this.on = false; else if (b === 0xAF) this.on = true;
    else if (b === 0xA6) this.inverse = false; else if (b === 0xA7) this.inverse = true;
    else if (b === 0x20 || b === 0x21 || b === 0x22 || b === 0x81 || b === 0xD3 || b === 0xA8 || b === 0xD5 || b === 0xD9 || b === 0xDA || b === 0xDB || b === 0x8D || b === 0xDC) this.pending.push([b, []]);
    else if ((b & 0xF0) === 0xB0) this.page = b & 0x07;
    else if ((b & 0xF0) === 0x00) this.col = (this.col & 0xF0) | (b & 0x0F);
    else if ((b & 0xF0) === 0x10) this.col = (this.col & 0x0F) | ((b & 0x0F) << 4);
    this.dirty = true;
  }
  applyCmd(c, a) {
    if (c === 0x20) this.mode = a[0] & 3;
    else if (c === 0x21) { this.colStart = a[0]; this.colEnd = a[1]; this.col = a[0]; }
    else if (c === 0x22) { this.pageStart = a[0]; this.pageEnd = a[1]; this.page = a[0]; }
    else if (c === 0x81) this.contrast = a[0];
  }
  data(b) {
    this.ram[this.page * this.width + this.col] = b;
    if (this.mode === 2) { this.col++; if (this.col > this.colEnd) this.col = this.colStart; }   // 頁定址
    else { this.col++; if (this.col > this.colEnd) { this.col = this.colStart; this.page++; if (this.page > this.pageEnd) this.page = this.pageStart; } }
    this.dirty = true;
  }
  pixel(x, y) { const v = (this.ram[(y >> 3) * this.width + x] >> (y & 7)) & 1; return this.inverse ? 1 - v : v; }
  litCount() { let n = 0; for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) n += this.pixel(x, y); return n; }
  /** 畫到 ImageData（RGBA）：亮＝白藍色 */
  toRGBA(out) {
    const w = this.width, h = this.height; const d = out || new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const on = this.on && this.pixel(x, y); const o = (y * w + x) * 4; d[o] = on ? 220 : 0; d[o + 1] = on ? 240 : 0; d[o + 2] = 255 * (on ? 1 : 0); d[o + 3] = 255; }
    return d;
  }
}

/** LCD1602 經 PCF8574 背板（I2C 0x27／0x3F）：P0=RS、P1=RW、P2=EN、P3=背光、P4–P7=資料高四位；EN 下降緣鎖存一個 nibble，兩個 nibble 一個位元組。 */
export class LCD1602Decoder {
  constructor(cols = 16, rows = 2) {
    this.cols = cols; this.rows = rows; this.ddram = new Uint8Array(80).fill(0x20);
    this.addr = 0; this.backlight = false; this.displayOn = false; this.cursor = false; this.blink = false; this.entryInc = true;
    this.nibbleHigh = null; this.lastEn = 0; this.fourBit = false; this.initNibbles = 0; this.dirty = false;
  }
  write(bytes) { for (const b of bytes) this.byte(b); }
  byte(b) {
    const rs = b & 1, en = (b >> 2) & 1, bl = (b >> 3) & 1, nib = b >> 4;
    this.backlight = !!bl;
    if (this.lastEn === 1 && en === 0) this.latch(rs, nib);
    this.lastEn = en;
  }
  latch(rs, nib) {
    if (!this.fourBit) {   // 初始化：連續的 0x3、0x3、0x3、0x2 nibble
      if (nib === 0x2 && this.initNibbles >= 1) { this.fourBit = true; this.nibbleHigh = null; return; }
      if (nib === 0x3) { this.initNibbles++; return; }
    }
    if (this.nibbleHigh === null) { this.nibbleHigh = nib; return; }
    const v = (this.nibbleHigh << 4) | nib; this.nibbleHigh = null;
    if (rs) this.dataByte(v); else this.command(v);
  }
  command(c) {
    this.dirty = true;
    if (c === 0x01) { this.ddram.fill(0x20); this.addr = 0; }
    else if ((c & 0xFE) === 0x02) this.addr = 0;
    else if ((c & 0xFC) === 0x04) this.entryInc = !!(c & 2);
    else if ((c & 0xF8) === 0x08) { this.displayOn = !!(c & 4); this.cursor = !!(c & 2); this.blink = !!(c & 1); }
    else if (c & 0x80) this.addr = c & 0x7F;
  }
  dataByte(v) { this.ddram[this.addr % 80] = v; this.addr = this.entryInc ? this.addr + 1 : this.addr - 1; if (this.addr === 0x28) this.addr = 0x40; this.dirty = true; }
  line(r) { const base = r === 0 ? 0 : 0x40; let s = ""; for (let i = 0; i < this.cols; i++) s += String.fromCharCode(this.ddram[base + i]); return s; }
  text() { return Array.from({ length: this.rows }, (_, r) => this.line(r)); }
  /** 給 wokwi-lcd1602 的 characters（cols×rows） */
  characters() { const out = new Uint8Array(this.cols * this.rows); for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) out[r * this.cols + c] = this.ddram[(r === 0 ? 0 : 0x40) + c]; return out; }
}

/** NeoPixel：位元流（每顆 24 位元 GRB，MSB 先）→ [[r,g,b], ...] */
export function decodeNeoPixel(bits, bpp = 3) {
  const per = bpp * 8, n = Math.floor(bits.length / per), out = [];
  for (let i = 0; i < n; i++) { const bytes = []; for (let k = 0; k < bpp; k++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * per + k * 8 + b]; bytes.push(v); } out.push(bpp === 3 ? [bytes[1], bytes[0], bytes[2]] : [bytes[1], bytes[0], bytes[2], bytes[3]]); }
  return out;
}

/** 步進馬達（4 線全步／半步）：依四支腳位的電位序列累計步數 → 角度。28BYJ-48 外部齒輪後 2048 步一圈；這裡用 200 步一圈的 NEMA 17 當示意（可設）。 */
export class StepperDecoder {
  constructor(stepsPerRev = 200) { this.stepsPerRev = stepsPerRev; this.steps = 0; this.last = null; this.seq = ["1000", "1100", "0100", "0110", "0010", "0011", "0001", "1001"]; }
  /** levels: [A-, A+, B+, B-] 對應我們的腳位順序；內部換算成 (A+, B+, A-, B-) 的半步序列 */
  update(levels) {
    const key = "" + levels[1] + levels[2] + levels[0] + levels[3];
    const i = this.seq.indexOf(key); if (i < 0) return;
    if (this.last !== null && i !== this.last) { let d = i - this.last; if (d > 4) d -= 8; if (d < -4) d += 8; this.steps += d; }
    this.last = i;
  }
  get angle() { return ((this.steps / 2) / this.stepsPerRev * 360) % 360; }
}

/** 把元件接上引擎：回傳 detach()。ctx = { getPinOf(partId, pin) → gpio|null, ui, setState(partId, st) } */
export function attachPart(engine, id, type, ctx) {
  const offs = [];
  const gpioOf = (pin) => ctx.gpioOf(id, pin);
  switch (type) {
    case "ssd1306": {
      const dec = new SSD1306Decoder(128, 64); const addr = 0x3C;
      engine.registerI2CDevice(0, addr, true); engine.registerI2CDevice(1, addr, true);
      offs.push(engine.on("i2c", (bus, a, bytes, isRead) => { if (a !== addr || isRead) return; if (!ctx.powered(id)) return; dec.write(bytes); ctx.setState(id, { decoder: dec }); }));
      offs.push(() => { engine.registerI2CDevice(0, addr, false); engine.registerI2CDevice(1, addr, false); });
      ctx.setState(id, { decoder: dec }); break;
    }
    case "lcd1602": {
      const dec = new LCD1602Decoder(16, 2); const addrs = [0x27, 0x3F];
      for (const a of addrs) { engine.registerI2CDevice(0, a, true); engine.registerI2CDevice(1, a, true); }
      offs.push(engine.on("i2c", (bus, a, bytes, isRead) => { if (!addrs.includes(a) || isRead) return; if (!ctx.powered(id)) return; dec.write(bytes); ctx.setState(id, { decoder: dec }); }));
      offs.push(() => { for (const a of addrs) { engine.registerI2CDevice(0, a, false); engine.registerI2CDevice(1, a, false); } });
      ctx.setState(id, { decoder: dec }); break;
    }
    case "neopixel-strip": {
      offs.push(engine.on("rmt", (gpio, bits) => { if (gpio !== gpioOf("DIN")) return; if (!ctx.powered(id)) return; ctx.setState(id, { colors: decodeNeoPixel(bits, 3).slice(0, 8) }); })); break;
    }
    case "hc-sr04": {
      const echo = () => gpioOf("ECHO");
      const register = () => { const g = echo(); if (g !== null) engine.registerPulseSource(g, () => { if (!ctx.powered(id)) return -2; const cm = ctx.ui[id]?.distance ?? 100; return Math.round(cm * 58); }); };
      register(); offs.push(() => { const g = echo(); if (g !== null) engine.registerPulseSource(g, null); });
      offs.push(ctx.onWiringChange(register)); break;
    }
    case "dht22": {
      const register = () => { const g = gpioOf("SDA"); if (g !== null) engine.registerSensor(g, () => (ctx.powered(id) ? { temperature: ctx.ui[id]?.temperature ?? 25, humidity: ctx.ui[id]?.humidity ?? 60 } : null)); };
      register(); offs.push(() => { const g = gpioOf("SDA"); if (g !== null) engine.registerSensor(g, null); }); offs.push(ctx.onWiringChange(register)); break;
    }
    case "stepper": {
      const dec = new StepperDecoder(200); const pins = ["A-", "A+", "B+", "B-"];
      const upd = () => { const lv = pins.map((p) => { const g = gpioOf(p); return g === null ? 0 : (ctx.level(g) ?? 0); }); dec.update(lv); ctx.setState(id, { angle: dec.angle, steps: dec.steps }); };
      offs.push(engine.on("pin", upd)); break;
    }
  }
  return () => { for (const f of offs) if (typeof f === "function") f(); };
}
