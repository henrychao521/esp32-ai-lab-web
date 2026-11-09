// selfcheck.js — 全部範例在真畫面裡實跑檢查（?check=1；App 用 -simcheck 開，結果經 sim:bench 寫 Documents/tmp/simbench.txt）
// 2026-11-08 使用者：「把整個系統都檢查過，完整檢查三次」。
// 每個範例：載入（不通電、LED 全滅）→ 按 ▶ → 照 verify／check 操作與比對 → 無錯誤、無短路、無燒毀、LED 有亮必有電流 → 停止（斷電、時間凍結、LED 全滅）。
// hooks：{ sim, examples, loadExample(ex), consoleText(), clearConsole(), runButton(), stopButton() }

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSelfCheck(hooks, { ids = null, onProgress = () => {} } = {}) {
  const { sim } = hooks;
  const list = hooks.examples.filter((e) => !ids || ids.includes(e.id));
  const results = [];
  for (let n = 0; n < list.length; n++) {
    const ex = list[n]; const errs = [], notes = [];
    onProgress(n, list.length, ex.id);
    try { await Promise.race([checkOne(hooks, ex, errs, notes), wait(90000).then(() => { throw new Error("單一範例超過 90 秒沒跑完"); })]); } catch (e) { errs.push("例外：" + (e && e.message || e)); }
    try { await hooks.stopButton(); } catch (_) {}
    results.push({ id: ex.id, ok: !errs.length, errs, notes, engine: hooks.sim.engine ? hooks.sim.engine.kind : null });
  }
  const bad = results.filter((r) => !r.ok);
  return { total: results.length, pass: results.length - bad.length, fail: bad.length, engines: [...new Set(results.map((r) => r.engine))], failures: bad, notes: results.filter((r) => r.notes.length).map((r) => ({ id: r.id, notes: r.notes })), ua: navigator.userAgent };
}

const leds = (sim) => Object.entries(sim.doc.parts).filter(([, p]) => p.type === "led").map(([id]) => id);
const ledOn = (sim, id) => !!sim.result?.parts?.[id]?.on;
const volt = (sim, ref) => sim.nodeVoltage(ref);
async function untilSim(sim, t, maxMs = 20000) { const t0 = performance.now(); while (sim.simTime < t && performance.now() - t0 < maxMs) await wait(30); return sim.simTime >= t; }
function freq(data) {
  if (!data || data.length < 10) return 0;
  const ys = data.map((p) => p[1]), mid = (Math.max(...ys) + Math.min(...ys)) / 2; const rises = [];
  for (let i = 1; i < data.length; i++) if (data[i - 1][1] < mid && data[i][1] >= mid) rises.push(data[i][0]);
  if (rises.length < 3) return 0; return (rises.length - 1) / (rises[rises.length - 1] - rises[0]);
}
function generic(sim, errs, tag) {
  const r = sim.result; if (!r) { errs.push(tag + "沒有求解結果"); return; }
  for (const w of r.warnings || []) if (["SHORT", "SUPPLY_MIX", "LED_BURN", "GPIO_OVERCURRENT"].includes(w.code)) errs.push(`${tag}${w.code}：${w.brief || ""}`);
  for (const id of leds(sim)) { const l = r.parts?.[id]?.leds?.[id]; if (l && l.on && !(l.i > 0)) errs.push(`${tag}${id} 顯示亮但電流 0`); }
}

async function checkOne(hooks, ex, errs, notes) {
  const { sim } = hooks;
  const logAt = (sim.attachLog || []).length;
  await hooks.loadExample(ex); await wait(400);
  // 1. 載入：零件數、麵包板、不通電、LED 全滅
  if (Object.keys(sim.doc.parts).length !== Object.keys(ex.parts).length) errs.push("載入後零件數不符");
  if (!!ex.breadboard !== !!sim.doc.breadboard) errs.push("麵包板有無不符");
  if (sim.powered) errs.push("載入後就通電（應該要按 ▶ 才通電）");
  for (const id of leds(sim)) if (ledOn(sim, id)) errs.push(`未通電時 ${id} 亮`);
  // 2. 通電／執行
  hooks.clearConsole();
  await hooks.runButton(); await wait(ex.board === "power" ? 200 : 2200);
  if (!sim.powered) errs.push("按 ▶ 後沒有通電");
  // 引擎還不支援的範例：只檢查有沒有清楚告訴使用者（主控台要有「還不支援」），其餘略過
  const lim = hooks.engineLimits ? hooks.engineLimits(ex) : [];
  if (lim.length) { await wait(300); if (!/還不支援/.test(hooks.consoleText())) errs.push("引擎不支援（" + lim.join("、") + "）卻沒有提示使用者"); else notes.push("已提示不支援：" + lim.join("、")); return; }
  const att = (sim.attachLog || []).slice(logAt); if (att.some((l) => !/busy=0 /.test(l))) errs.push("引擎重建重疊：" + att.join(" ／ "));
  if (sim.engine && sim.engine.board && sim.engine.board !== ex.board) errs.push(`引擎還是 ${sim.engine.board} 的，不是 ${ex.board}`);
  const v = ex.verify || {};
  if (ex.board === "power") await powerChecks(sim, ex, errs);
  else {
    if (v.ui) { for (const [id, val] of Object.entries(v.ui)) sim.ui[id] = { ...(sim.ui[id] || {}), ...val }; sim.tick(); }
    if (v.adc && sim.engine) for (const [g, raw] of Object.entries(v.adc)) sim.engine.setAnalog(Number(g), raw / 4095 * 3.3);
    const want = v.console ? new RegExp(v.console) : null;
    // 按鍵：程式還沒進迴圈時按了會錯過（T-Display S3 彩色螢幕初始化較慢，iOS 模擬器上超過 2 秒），
    // 所以像真人一樣「沒反應就再按」，每秒一次、最多 8 次；按了幾次記在 notes
    let presses = 0;
    if (v.press && sim.engine) for (let k = 0; k < 8; k++) {
      for (const b of v.press) { sim.engine.pressButton(b, 250); await wait(500); } presses++;
      if (!want || want.test(hooks.consoleText())) break; await wait(500);
    }
    if (presses > 1) notes.push(`按了 ${presses} 次才有反應`);
    // 會隨時間變化的電路（電容、555）：模擬器在電腦忙時會放慢模擬時間，至少等模擬時間走滿 3 秒（最多 20 秒實際時間）
    const t0 = performance.now(), st0 = sim.simTime; let txt = "";
    const base = sim.engine && sim.engine.kind === "esp32sim" ? 15000 : 6000;   // 真韌體要開機（約 2 秒，排隊時更久）
    const more = () => performance.now() - t0 < base || (sim.hasDynamic && sim.simTime - st0 < 3 && performance.now() - t0 < 20000);
    while (more()) { txt = hooks.consoleText(); if (!want || want.test(txt)) break; await wait(200); }
    if (want && !want.test(txt)) errs.push(`主控台沒有出現 /${v.console}/（最後：${txt.slice(-80).replace(/\s+/g, " ")}；等了 ${((performance.now() - t0) / 1000).toFixed(1)} 秒，模擬時間走了 ${(sim.simTime - st0).toFixed(1)} 秒）`);
    if (!want && ex.board === "uno") { await wait(1500); txt = hooks.consoleText(); const X = v.expect || {}; const needSerial = (X.serial || []).length && !(v.actions || []).length && !v.pulse && !v.onRise; if (needSerial) for (const s of X.serial) if (!txt.includes(s)) errs.push("序列埠沒有「" + s + "」"); }
    const bad = /Traceback|Error:|錯誤：|無法開機|編譯失敗/.exec(txt); if (bad) errs.push("主控台有錯誤：" + txt.slice(Math.max(0, bad.index - 20), bad.index + 80).replace(/\s+/g, " "));
    if (v.ui) { for (const id of Object.keys(v.ui)) if (sim.ui[id]) sim.ui[id] = { ...sim.ui[id], pressed: false }; sim.tick(); }
  }
  generic(sim, errs, "執行中：");
  // 3. 停止：斷電、時間凍結、LED 全滅
  await hooks.stopButton(); await wait(300);
  if (sim.powered) errs.push("停止後仍通電");
  const tA = sim.simTime; await wait(400); if (sim.hasDynamic && sim.simTime !== tA) errs.push("停止後模擬時間還在走");
  for (const id of leds(sim)) if (ledOn(sim, id)) errs.push(`停止後 ${id} 還亮`);
}

// 電源供應器範例：ex.check ＝ 依序執行的步驟（at＝通電後模擬秒數）
async function powerChecks(sim, ex, errs) {
  const steps = ex.check || []; let base = sim.simTime;
  for (const st of steps) {
    if (st.ui) { for (const [id, val] of Object.entries(st.ui)) sim.ui[id] = { ...(sim.ui[id] || {}), ...val }; sim.tick(); }
    if (st.rebase) base = sim.simTime;
    if (st.at != null && !(await untilSim(sim, base + st.at))) { errs.push(`模擬時間跑不到 ${st.at} 秒（目前 ${sim.simTime.toFixed(2)}）`); return; }
    for (const [id, want] of Object.entries(st.leds || {})) if (ledOn(sim, id) !== want) errs.push(`${st.at}s ${id} 應該${want ? "亮" : "滅"}`);
    for (const [ref, [lo, hi]] of Object.entries(st.volt || {})) { const x = volt(sim, ref); if (!(x >= lo && x <= hi)) errs.push(`${st.at}s ${ref} = ${x?.toFixed?.(2)} V，應在 ${lo}～${hi}`); }
    for (const [ref, [lo, hi]] of Object.entries(st.range || {})) { const d = sim.probeData[ref] || []; const ys = d.filter((p) => p[0] > base + 0.3).map((p) => p[1]); if (!ys.length) { errs.push(`${ref} 沒有探針資料`); continue; } const mn = Math.min(...ys), mx = Math.max(...ys); if (mn < lo || mx > hi) errs.push(`${ref} 範圍 ${mn.toFixed(2)}～${mx.toFixed(2)} V，應在 ${lo}～${hi}`); if (st.spread && mx - mn < st.spread) errs.push(`${ref} 擺幅 ${(mx - mn).toFixed(2)} V 太小（要 ≥ ${st.spread}）`); }
    for (const [ref, [lo, hi]] of Object.entries(st.freq || {})) { const f = freq((sim.probeData[ref] || []).filter((p) => p[0] > base + 0.3)); if (!(f >= lo && f <= hi)) errs.push(`${ref} 頻率 ${f.toFixed(2)} Hz，應在 ${lo}～${hi}`); }
    if (st.alternate) {   // 兩顆 LED 輪流亮、不同時亮
      const [a, b] = st.alternate; let na = 0, nb = 0, both = 0; const t0 = sim.simTime;
      while (sim.simTime < t0 + 2) { const A = ledOn(sim, a), B = ledOn(sim, b); if (A) na++; if (B) nb++; if (A && B) both++; await wait(40); }
      if (!na || !nb) errs.push(`${a}／${b} 沒有輪流亮（${na}／${nb}）`); if (both) errs.push(`${a}、${b} 同時亮 ${both} 次`);
    }
  }
}
