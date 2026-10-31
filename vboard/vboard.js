// vboard.js — 虛擬板執行器：MicroPython（WebAssembly）＋ lab 替身，介面仿板子的 HTTP／WebSocket 事件。
// 用法：
//   import { createVirtualBoard, transformCode } from "./vboard.js";
//   const vb = await createVirtualBoard({ board: "tqt_pro", onEvent: (msg) => {...}, onState: (st) => {...} });
//   vb.info(); await vb.run(code, "main.py"); await vb.check(code); await vb.stop(); vb.cmd({op:"joy",x:0.5,y:0});
//   vb.pressButton(0, true); vb.setAdc(16, 2048); vb.setBattery(3.9); vb.setRssi(-55); vb.screenRGBA() → Uint8ClampedArray(128*128*4)
// 事件（onEvent）與板子 /ws 相同：hello／out／err／start／done／sensor／display。
import { PY_FILES } from "./py-bundle.js";

export const VBOARD_VERSION = "0.5.1-virtual";
const SLEEP_NAMES = ["lab.sleep_ms", "lab.sleep", "time.sleep_ms", "time.sleep_us", "time.sleep", "utime.sleep_ms", "utime.sleep"];

/** 把學生程式改寫成可在 runPythonAsync 執行的版本：lab.sleep → await lab.sleep；含 await 的函式變 async，呼叫它們的地方也加 await。
 *  行數不變（只在行內插字），traceback 的行號才對得上。 */
export function transformCode(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const codePart = (l) => { // 去掉註解（粗略：# 前面沒有未閉合的引號）
    let q = null, i = 0;
    for (; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === "\\") i++; else if (c === q) q = null; }
      else if (c === "'" || c === '"') q = c;
      else if (c === "#") break;
    }
    return [l.slice(0, i), l.slice(i)];
  };
  const fromTimeSleep = /^\s*from\s+(u?time)\s+import\s+.*\bsleep\b/m.test(src);
  // 第一步：sleep 呼叫加 await
  for (let i = 0; i < lines.length; i++) {
    let [code, rest] = codePart(lines[i]);
    code = code.replace(/(?<![\w.])(?<!await\s)(lab\.sleep_ms|lab\.sleep|u?time\.sleep_ms|u?time\.sleep_us|u?time\.sleep)\s*\(/g, (m, name) => {
      if (name.endsWith("sleep_us")) return "await lab.sleep(0.000001*(";   // sleep_us(x) → sleep(0.000001*(x))，下面補括號
      if (name.endsWith("sleep_ms")) return "await lab.sleep_ms(";
      return "await lab.sleep(";
    });
    if (code.includes("await lab.sleep(0.000001*(")) code = balanceExtraParen(code, "await lab.sleep(0.000001*(");
    if (fromTimeSleep) code = code.replace(/(?<![\w.])(?<!await\s)sleep\s*\(/g, "await lab.sleep(");
    lines[i] = code + rest;
  }
  // 第二步：含 await 的 def → async def；呼叫處加 await（重複到不再變動）
  for (let round = 0; round < 6; round++) {
    const asyncNames = new Set();
    let cur = null; // {name, indent}
    for (const l of lines) {
      const m = /^(\s*)(async\s+)?def\s+(\w+)\s*\(/.exec(l);
      if (m) { cur = { name: m[3], indent: m[1].length }; if (m[2]) asyncNames.add(m[3]); continue; }
      if (cur && l.trim() && !l.trim().startsWith("#")) {
        const ind = l.length - l.trimStart().length;
        if (ind <= cur.indent) cur = null;
        else if (/(?<![\w.])await\s/.test(codePart(l)[0])) asyncNames.add(cur.name);
      }
    }
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      let [code, rest] = codePart(lines[i]);
      const m = /^(\s*)def\s+(\w+)\s*\(/.exec(code);
      if (m && asyncNames.has(m[2])) { code = code.replace(/^(\s*)def\s+/, "$1async def "); changed = true; }
      for (const name of asyncNames) {
        const re = new RegExp("(?<![\\w.@])(?<!await\\s)(?<!def\\s)(?<!async def\\s)" + name + "\\s*\\(", "g");
        if (re.test(code)) { code = code.replace(re, "await " + name + "("); changed = true; }
      }
      lines[i] = code + rest;
    }
    if (!changed) break;
  }
  return lines.join("\n");
}

function balanceExtraParen(code, marker) {
  // 在 marker 之後找到對應的右括號，再補一個「)」
  let out = "", idx = 0;
  while (true) {
    const p = code.indexOf(marker, idx);
    if (p < 0) { out += code.slice(idx); break; }
    const start = p + marker.length;
    let depth = 1, j = start;
    for (; j < code.length; j++) { if (code[j] === "(") depth++; else if (code[j] === ")") { depth--; if (depth === 0) break; } }
    out += code.slice(idx, j) + ")" ; idx = j;
  }
  return out;
}

const BOARD_NAMES = { tqt_pro: "虛擬 T-QT Pro", devkit: "虛擬 ESP32 DevKit", generic: "虛擬 ESP32" };

export async function createVirtualBoard(opts = {}) {
  const board = opts.board || "tqt_pro";
  const onEvent = opts.onEvent || (() => {});
  const onState = opts.onState || (() => {});
  const { loadMicroPython } = await import(new URL("./micropython.mjs", import.meta.url).href);

  const st = {
    board, status: "idle", file: null, led: false,
    pins: {}, pinModes: {}, pinPulls: {}, inputs: {}, adc: {}, servos: {}, pwm: {},
    buttons: {}, battery: 3.92, rssi: -55, startedAt: 0,
  };
  const buttonPins = board === "tqt_pro" ? [0, 47] : [0];
  for (const p of buttonPins) { st.inputs[p] = 1; st.buttons[p] = false; }   // 上拉：沒按＝1
  const screenRGBA = new Uint8ClampedArray(128 * 128 * 4);
  let screenDirty = false, runPromise = null, mp = null;

  const emit = (msg) => { try { onEvent(msg); } catch (e) {} };
  const changed = () => { try { onState(st); } catch (e) {} };

  mp = await loadMicroPython({
    stdout: (s) => emit({ t: "out", s: s + "\n" }),
    stderr: (s) => emit({ t: "err", s: s + "\n" }),
  });
  mp.registerJsModule("labjs", {
    emit: (json) => { try { emit(JSON.parse(json)); } catch (e) {} },
    show: () => { blitScreen(); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    led: (v) => { st.led = !!v; changed(); },
    rssi: () => st.rssi,
    battery: () => st.battery,
    pin_mode: (gpio, mode, pull) => { st.pinModes[gpio] = mode; st.pinPulls[gpio] = pull ? 1 : 0; if (mode === "in" && !(gpio in st.inputs)) st.inputs[gpio] = pull ? 1 : 0; changed(); },
    pin_read: (gpio) => (gpio in st.inputs ? st.inputs[gpio] : 0),
    pin_write: (gpio, v) => { st.pins[gpio] = v ? 1 : 0; if (gpio === 2 && board !== "tqt_pro") st.led = !!v; changed(); },
    pin_irq: () => {},
    pwm: (gpio, freq, duty16) => {
      st.pwm[gpio] = { freq, duty16 }; st.pinModes[gpio] = freq > 0 ? "pwm" : "out";
      if (freq >= 40 && freq <= 60) {   // 伺服：脈衝寬 0.5～2.5 ms → 0～180°
        const ms = (duty16 / 65535) * (1000 / freq);
        st.servos[gpio] = Math.max(0, Math.min(180, Math.round((ms - 0.5) / 2.0 * 180)));
      } else { delete st.servos[gpio]; }
      changed();
    },
    adc_init: (gpio) => { st.pinModes[gpio] = "adc"; if (!(gpio in st.adc)) st.adc[gpio] = 2048; changed(); },
    adc_read: (gpio) => (gpio in st.adc ? st.adc[gpio] : 2048),
    reset: () => { setTimeout(() => api.reset(), 50); },
  });
  try { mp.FS.mkdir("/lib"); } catch (e) {}
  for (const [path, src] of Object.entries(PY_FILES)) {
    const dir = "/lib/" + path.split("/").slice(0, -1).join("/");
    if (path.includes("/")) { try { mp.FS.mkdir(dir); } catch (e) {} }
    mp.FS.writeFile("/lib/" + path, src);
  }
  mp.runPython("import sys\nsys.path.insert(0, '/lib')\nimport _vboard\n_vboard.setup(" + JSON.stringify(board) + ")\n");
  const pyLab = mp.pyimport("lab");
  const pyVB = mp.pyimport("_vboard");

  function blitScreen() {
    let buf;
    try { buf = mp.FS.readFile("/screen.bin"); } catch (e) { return; }
    for (let i = 0, j = 0; i < 128 * 128 * 2; i += 2, j += 4) {
      const c = (buf[i] << 8) | buf[i + 1];   // 已交換位元組的 RGB565 → 還原
      const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f;
      screenRGBA[j] = (r << 3) | (r >> 2); screenRGBA[j + 1] = (g << 2) | (g >> 4); screenRGBA[j + 2] = (b << 3) | (b >> 2); screenRGBA[j + 3] = 255;
    }
    screenDirty = true;
    changed();
  }

  function info() {
    return {
      name: BOARD_NAMES[board] || BOARD_NAMES.generic, id: "virtual", board, chip: "wasm", ip: null, mode: "virtual",
      version: VBOARD_VERSION, status: st.status, file: st.file, rssi: st.rssi, free: 1024 * 1024, clients: 1, transport: "virtual", python: true,
      uptime: st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0,
    };
  }

  const api = {
    board, state: st, info,
    get running() { return st.status === "running"; },
    screenRGBA: () => screenRGBA,
    takeScreenDirty: () => { const d = screenDirty; screenDirty = false; return d; },

    /** 推送並執行（像 /run）：回 {ok, msg}；執行中回 busy（像 409）。 */
    async run(code, name = "main.py") {
      if (st.status === "running") return { ok: false, msg: "busy", status: 409 };
      const chk = await api.check(code, name);
      if (!chk.ok) { emit({ t: "err", s: `${name} 第 ${chk.line ?? "?"} 行：${chk.msg}\n` }); return { ok: false, msg: chk.msg, line: chk.line }; }
      st.status = "running"; st.file = name; st.startedAt = Date.now(); changed();
      mp.runPython("import _vboard\n_vboard.clear_main(globals())\n_vboard.begin(" + JSON.stringify(name) + ")");
      const transformed = transformCode(code);
      runPromise = (async () => {
        await new Promise((r) => setTimeout(r, 0));   // 先讓 run() 回覆（像板子的 /run 先回 200），程式下一個 tick 才開始
        let done = { t: "done", ok: true };
        try {
          await mp.runPythonAsync(transformed);
        } catch (e) {
          const txt = String(e && e.message ? e.message : e);
          if (/StopRequested/.test(txt)) done = { t: "done", ok: true, stopped: true };
          else if (/SystemExit/.test(txt)) done = { t: "done", ok: true };
          else {
            let msg = txt;
            try { msg = pyVB.format_error(txt, name); } catch (e2) {}
            emit({ t: "err", s: msg });
            done = { t: "done", ok: false };
          }
        }
        st.status = "idle"; st.file = null; changed();
        emit(done);
      })();
      return { ok: true, msg: "started" };
    },

    /** 語法檢查（像 /check）：{ok, line, msg} */
    async check(code, name = "main.py") {
      mp.globals.set("__chk_code", code);
      try {
        mp.runPython("__chk_res = _vboard.check(__chk_code, " + JSON.stringify(name) + ")");
        const r = JSON.parse(mp.globals.get("__chk_res"));
        return { ok: !!r.ok, line: r.line === null || r.line === undefined ? null : Number(r.line), msg: String(r.msg) };
      } catch (e) {
        return { ok: false, line: null, msg: String(e && e.message || e) };
      }
    },

    /** 停止（像 /stop）：設旗標，等程式在下一次 lab.sleep／lab.running 結束；最多等 3 秒。 */
    async stop() {
      if (st.status !== "running") return true;
      mp.runPython("import lab\nlab._stop = True");
      const t0 = Date.now();
      while (st.status === "running" && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 30));
      return st.status !== "running";
    },

    /** 重開虛擬板：清狀態、重建 display，發 hello。 */
    async reset() {
      await api.stop();
      for (const k of Object.keys(st.pins)) delete st.pins[k];
      for (const k of Object.keys(st.servos)) delete st.servos[k];
      for (const k of Object.keys(st.pwm)) delete st.pwm[k];
      for (const k of Object.keys(st.pinModes)) delete st.pinModes[k];
      for (const k of Object.keys(st.pinPulls)) delete st.pinPulls[k];
      st.led = false;
      mp.runPython("import _vboard\n_vboard.clear_main(globals())\n_vboard.setup(" + JSON.stringify(board) + ")");
      changed();
      emit({ t: "hello", name: info().name, board, status: "idle", version: VBOARD_VERSION });
    },

    /** 遙控／視覺指令（像 /ws 的 {"t":"cmd"}）。內建 led／pin／read／adc 直接做，其餘排隊給 @lab.on_cmd。 */
    cmd(c) {
      const op = c && c.op;
      if (op === "led") { st.led = !!c.v; if (board === "tqt_pro") pyLab.led(c.v ? 1 : 0); changed(); return; }
      if (op === "pin") { st.pins[c.pin] = c.v ? 1 : 0; st.pinModes[c.pin] = "out"; changed(); return; }
      if (op === "read") { emit({ t: "sensor", v: { ["gpio" + c.pin]: c.pin in st.inputs ? st.inputs[c.pin] : (st.pins[c.pin] || 0) } }); return; }
      if (op === "adc") { emit({ t: "sensor", v: { ["adc" + c.pin]: c.pin in st.adc ? st.adc[c.pin] : 2048 } }); return; }
      pyLab._push_cmd(JSON.stringify(c));
    },

    pressButton(pin, down) { st.buttons[pin] = !!down; st.inputs[pin] = down ? 0 : 1; changed(); },
    setInput(gpio, level) { st.inputs[gpio] = level ? 1 : 0; changed(); },
    setAdc(gpio, raw) { st.adc[gpio] = Math.max(0, Math.min(4095, Math.round(raw))); changed(); },
    setBattery(v) { st.battery = v; changed(); },
    setRssi(v) { st.rssi = v; changed(); },
    get mp() { return mp; },
  };
  emit({ t: "hello", name: info().name, board, status: "idle", version: VBOARD_VERSION });
  return api;
}
