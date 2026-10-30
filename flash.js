// 首燒網站第二步：用 Web Serial 進 MicroPython raw REPL，把 agent_bundle.json 的檔案寫進板子。
const $ = (id) => document.getElementById(id);
const log = (s, cls) => { const el = $("log"); el.hidden = false; const line = document.createElement("div"); if (cls) line.className = cls; line.textContent = s; el.appendChild(line); el.scrollTop = el.scrollHeight; };

if (!("serial" in navigator)) { $("unsupported").hidden = false; $("agentBtn").disabled = true; }
$("chip").addEventListener("change", (e) => { $("installBtn").setAttribute("manifest", `manifest-${e.target.value}.json`); $("uartHint").hidden = e.target.value !== "esp32"; });

// ESP Web Tools 的狀態事件：失敗時在對話框外面補中文說明（對話框在 shadow DOM 裡改不到）
$("installBtn").addEventListener("state-changed", (ev) => {
  const st = ev.detail && ev.detail.state;
  if (st === "error") { $("flashHelp").hidden = false; $("flashHelp").scrollIntoView({ behavior: "smooth", block: "center" }); }
  else if (st === "preparing" || st === "erasing" || st === "writing") { $("flashHelp").hidden = true; }
});

// 選用：用 esptool 的 DTR/RTS 序列試一次自動進下載模式（有自動下載電路的板子有效；原生 USB 跑程式時通常無效）
$("autoResetBtn").addEventListener("click", async () => {
  const msg = $("autoResetMsg");
  if (!("serial" in navigator)) { msg.textContent = "這個瀏覽器沒有 Web Serial。"; return; }
  let port = null;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await port.setSignals({ dataTerminalReady: false, requestToSend: true });  // EN 拉低
    await wait(100);
    await port.setSignals({ dataTerminalReady: true, requestToSend: false });  // IO0 拉低、放開 EN
    await wait(100);
    await port.setSignals({ dataTerminalReady: false, requestToSend: false });
    await wait(100);
    await port.close();
    msg.textContent = "已送出重置訊號。若板子有自動下載電路，現在按「安裝 MicroPython」並選同一個序列埠；若仍失敗，照上面四步手動按 BOOT。";
  } catch (e) {
    try { if (port) await port.close(); } catch (_) {}
    msg.textContent = "自動重置沒成功（" + e.message + "），請照上面四步手動按 BOOT。";
  }
});

let bundle = null, boards = [];
fetch("boards.json").then((r) => r.json()).then((list) => {
  boards = list;
  const sel = $("board");
  list.forEach((b) => { const o = document.createElement("option"); o.value = b.id; o.textContent = b.name; sel.appendChild(o); });
  sel.value = "tqt_pro";
  sel.dispatchEvent(new Event("change"));
});
$("board").addEventListener("change", () => {
  const b = boards.find((x) => x.id === $("board").value);
  if (!b) return;
  $("chip").value = b.firmware;
  $("installBtn").setAttribute("manifest", `manifest-${b.firmware}.json`);
  $("uartHint").hidden = b.boot_button;
  $("boardHint").textContent = (b.boot_button ? "原生 USB：首燒前先按住 BOOT 再按 RST／重插 USB。" : "UART 晶片：瀏覽器可自動重置，不必按 BOOT。")
    + (b.display ? " 有螢幕，lab.display 可畫圖。" : " 沒有螢幕，lab.display.text() 會顯示在主控台。") + "（選板子會自動選對應韌體）";
});
fetch("agent_bundle.json").then((r) => r.json()).then((b) => { bundle = b; $("agentVer").textContent = `代理程式 v${b.version}，${Object.keys(b.files).length} 個檔案`; });

class Repl {
  constructor(port) { this.port = port; this.buf = ""; }
  async open() {
    await this.port.open({ baudRate: 115200 });
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.dec = new TextDecoder();
    this.pump();
  }
  async pump() {
    try { while (true) { const { value, done } = await this.reader.read(); if (done) break; this.buf += this.dec.decode(value); } } catch (e) { /* closed */ }
  }
  async write(s) { await this.writer.write(typeof s === "string" ? new TextEncoder().encode(s) : s); }
  async waitFor(marker, timeout = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const i = this.buf.indexOf(marker);
      if (i >= 0) { const out = this.buf.slice(0, i); this.buf = this.buf.slice(i + marker.length); return out; }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`等不到「${marker.replace(/\x04/g, "^D")}」，目前收到：${this.buf.slice(-200)}`);
  }
  async enterRaw() {
    await this.write("\r\x03\x03");          // 中斷正在跑的 main.py
    await new Promise((r) => setTimeout(r, 300));
    this.buf = "";
    await this.write("\r\x01");              // Ctrl-A：raw REPL
    await this.waitFor("raw REPL; CTRL-B to exit\r\n>", 4000);
  }
  async exec(code, timeout = 10000) {
    this.buf = "";
    await this.write(code + "\x04");
    await this.waitFor("OK", timeout);
    const out = await this.waitFor("\x04", timeout);
    const err = await this.waitFor("\x04", timeout);
    await this.waitFor(">", timeout);
    if (err.trim()) throw new Error(err.trim());
    return out;
  }
  async putFile(path, text) {
    const bytes = new TextEncoder().encode(text);
    await this.exec(`f=open(${JSON.stringify(path)},'wb')`);
    const CH = 768;
    for (let i = 0; i < bytes.length; i += CH) {
      const b64 = btoa(String.fromCharCode(...bytes.slice(i, i + CH)));
      await this.exec(`import binascii\nf.write(binascii.a2b_base64('${b64}'))`);
    }
    await this.exec("f.close()");
  }
  async close() {
    try { await this.write("\x02"); } catch (e) {}
    try { await this.reader.cancel(); } catch (e) {}
    try { this.writer.releaseLock(); this.reader.releaseLock(); await this.port.close(); } catch (e) {}
  }
}

$("agentBtn").addEventListener("click", async () => {
  if (!bundle) { log("代理程式包還沒載入", "bad"); return; }
  const btn = $("agentBtn"); btn.disabled = true; $("log").textContent = "";
  let repl = null;
  try {
    const port = await navigator.serial.requestPort();
    repl = new Repl(port); await repl.open();
    log("進入 raw REPL…"); await repl.enterRaw();
    const ver = await repl.exec("import sys\nprint(sys.version)");
    log("板子回應：" + ver.trim(), "ok");
    await repl.exec("import os\nfor d in ('lab','microdot','user'):\n    try: os.mkdir(d)\n    except OSError: pass");
    const names = Object.keys(bundle.files);
    for (let i = 0; i < names.length; i++) {
      log(`寫入 ${names[i]}（${i + 1}/${names.length}）`);
      await repl.putFile(names[i], bundle.files[names[i]]);
    }
    await repl.putFile("board.json", JSON.stringify({ board: $("board").value }));
    const ssid = $("ssid").value.trim();
    if (ssid) {
      await repl.putFile("wifi.json", JSON.stringify({ ssid, pass: $("pass").value, server: $("server").value.trim() }));
      log("已寫入 Wi-Fi 設定");
    } else {
      log("未填 Wi-Fi：保留板子原有設定；若板子沒有設定會開熱點 ESP32LAB-xxxx");
    }
    const host = await repl.exec("import machine,ubinascii\nprint('esp32lab-'+ubinascii.hexlify(machine.unique_id()).decode()[-4:])");
    log(`完成。板子名稱：${host.trim()}.local`, "ok");
    const a = $("openIde"); a.href = `http://${host.trim()}.local/`; a.textContent = `打開 http://${host.trim()}.local`; a.hidden = false;
    log("重開板子…");
    await repl.write("\x02"); await new Promise((r) => setTimeout(r, 200));
    repl.buf = ""; await repl.write("\x04");              // 軟重開，跑 main.py
    try { await repl.waitFor("esp32-ai-lab ", 30000); const line = await repl.waitFor("\n", 2000); const m = line.match(/mode=(\w+) ip=([\d.]+)/); log(m && m[1] === "sta" ? `已連上 Wi-Fi，IP ${m[2]}` : `板子開了熱點（${line.trim()}）`, m && m[1] === "sta" ? "ok" : ""); if (m && m[1] === "sta") { const a = $("openIde"); a.href = `http://${m[2]}/`; a.textContent = `打開 http://${m[2]}（${host.trim()}.local）`; } }
    catch (e) { log("25 秒內沒看到連線訊息；看板子螢幕或稍後用 http://" + host.trim() + ".local/info 確認"); }
  } catch (e) {
    log("失敗：" + e.message, "bad");
  } finally {
    if (repl) await repl.close();
    btn.disabled = false;
  }
});
