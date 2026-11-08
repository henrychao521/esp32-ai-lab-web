// breadboard.js — 半尺寸麵包板（30 欄 × 10 列 + 上下電源軌）
// 純 ES module，不使用任何套件，不碰 document／window。

const PITCH = 9.6; // 2.54 mm × 96 / 25.4
const COLS = 30;
const RAIL_HOLES = 25;

// ---- 版面常數（px，原點為整張左上）----
const X0 = 20; // 第 1 欄的 x
const WIDTH = 319; // 20 + 29*9.6 + 20.6 → 整數
const HEIGHT = 194; // 2026-11-08：中央溝槽改成真實的 3 格（0.3 吋），DIP IC 才能跨溝插在 e／f 列

const ROWS_UPPER = ['a', 'b', 'c', 'd', 'e'];
const ROWS_LOWER = ['f', 'g', 'h', 'i', 'j'];

const Y_TOP_PLUS = 20;
const Y_TOP_MINUS = Y_TOP_PLUS + PITCH;
const Y_A = Y_TOP_MINUS + PITCH * 1.5; // 44
const Y_F = Y_A + PITCH * 4 + PITCH * 3; // e 與 f 之間隔 3 個 pitch（中央溝槽，同真實麵包板與 DIP 寬度）
const Y_BOT_PLUS = Y_F + PITCH * 4 + PITCH * 1.5;
const Y_BOT_MINUS = Y_BOT_PLUS + PITCH;

// 電源軌 25 孔：5 孔一組、組間空一格，共佔 29 格，置中於主區
const RAIL_SPAN = 28 * PITCH;
const RAIL_X0 = X0 + ((COLS - 1) * PITCH - RAIL_SPAN) / 2;

const COL_LABELS = [1, 5, 10, 15, 20, 25, 30];

const f2 = (n) => Math.round(n * 100) / 100;

// ---- 產生孔位與導通群組 ----
function build() {
  const holes = [];
  const strips = {};

  const add = (id, x, y, strip) => {
    holes.push({ id, x, y, strip });
    (strips[strip] || (strips[strip] = [])).push(id);
  };

  // 主區：上半 a–e（strip u{col}），下半 f–j（strip l{col}）
  for (let c = 1; c <= COLS; c++) {
    const x = X0 + (c - 1) * PITCH;
    ROWS_UPPER.forEach((r, i) => add(`${r}${c}`, x, Y_A + i * PITCH, `u${c}`));
    ROWS_LOWER.forEach((r, i) => add(`${r}${c}`, x, Y_F + i * PITCH, `l${c}`));
  }

  // 電源軌
  const rails = [
    ['top', '+', Y_TOP_PLUS],
    ['top', '-', Y_TOP_MINUS],
    ['bot', '+', Y_BOT_PLUS],
    ['bot', '-', Y_BOT_MINUS],
  ];
  for (const [pos, pol, y] of rails) {
    for (let n = 1; n <= RAIL_HOLES; n++) {
      const k = n - 1;
      const slot = Math.floor(k / 5) * 6 + (k % 5);
      add(`${pos}${pol}${n}`, RAIL_X0 + slot * PITCH, y, `${pos}${pol}`);
    }
  }

  return { holes, strips };
}

// ---- 產生 SVG 內容字串 ----
function buildSvg(holes) {
  const out = [];

  // 底板
  out.push(
    `<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="6" ry="6" fill="#f3f1ec" stroke="#d8d4cb" stroke-width="1"/>`
  );

  // 中央溝槽
  const grooveY = (Y_A + 4 * PITCH + Y_F) / 2;
  out.push(
    `<rect x="14" y="${f2(grooveY - 2.4)}" width="${WIDTH - 28}" height="4.8" rx="1.5" fill="#dcd8ce" stroke="#cfcac0" stroke-width="0.5"/>`
  );

  // 電源軌紅藍線
  const railX1 = f2(RAIL_X0 - 3);
  const railX2 = f2(RAIL_X0 + RAIL_SPAN + 3);
  const line = (y, color) =>
    `<line x1="${railX1}" y1="${f2(y)}" x2="${railX2}" y2="${f2(y)}" stroke="${color}" stroke-width="1" stroke-linecap="round"/>`;
  out.push(line(Y_TOP_PLUS - 5.5, '#d33a3a'));
  out.push(line(Y_TOP_MINUS + 5, '#2f5fd0'));
  out.push(line(Y_BOT_PLUS - 5, '#d33a3a'));
  out.push(line(Y_BOT_MINUS + 5.5, '#2f5fd0'));

  // 文字樣式
  const textAttr = 'font-family="sans-serif" font-size="7" text-anchor="middle"';

  // 電源軌 +／- 標示（左右兩側）
  const railLabels = [
    [Y_TOP_PLUS, '+', '#d33a3a'],
    [Y_TOP_MINUS, '-', '#2f5fd0'],
    [Y_BOT_PLUS, '+', '#d33a3a'],
    [Y_BOT_MINUS, '-', '#2f5fd0'],
  ];
  for (const [y, s, color] of railLabels) {
    for (const x of [9, WIDTH - 9]) {
      out.push(`<text x="${x}" y="${f2(y + 2.5)}" ${textAttr} fill="${color}">${s}</text>`);
    }
  }

  // 列字母 a–j（左右兩側）
  ROWS_UPPER.forEach((r, i) => {
    const y = f2(Y_A + i * PITCH + 2.5);
    out.push(`<text x="9" y="${y}" ${textAttr} fill="#6b665c">${r}</text>`);
    out.push(`<text x="${WIDTH - 9}" y="${y}" ${textAttr} fill="#6b665c">${r}</text>`);
  });
  ROWS_LOWER.forEach((r, i) => {
    const y = f2(Y_F + i * PITCH + 2.5);
    out.push(`<text x="9" y="${y}" ${textAttr} fill="#6b665c">${r}</text>`);
    out.push(`<text x="${WIDTH - 9}" y="${y}" ${textAttr} fill="#6b665c">${r}</text>`);
  });

  // 欄號（上下）
  for (const c of COL_LABELS) {
    const x = f2(X0 + (c - 1) * PITCH);
    out.push(`<text x="${x}" y="9" ${textAttr} fill="#6b665c">${c}</text>`);
    out.push(`<text x="${x}" y="${HEIGHT - 5}" ${textAttr} fill="#6b665c">${c}</text>`);
  }

  // 孔：#2b2b2b 半徑 2.6，淺灰 #c9c5bd 描邊
  for (const h of holes) {
    out.push(
      `<circle id="hole-${h.id}" cx="${f2(h.x)}" cy="${f2(h.y)}" r="2.6" fill="#2b2b2b" stroke="#c9c5bd" stroke-width="1.2"/>`
    );
  }

  return out.join('\n');
}

const { holes, strips } = build();

export const BREADBOARD = {
  width: WIDTH,
  height: HEIGHT,
  pitch: PITCH,
  holes,
  strips,
  svg: buildSvg(holes),
};

/**
 * 以麵包板左上為原點的 px 座標，找最近且距離 ≤ tolerance 的孔。
 * @param {number} x
 * @param {number} y
 * @param {number} [tolerance=5]
 * @returns {{id:string,x:number,y:number,strip:string}|null}
 */
export function holeAt(x, y, tolerance = 5) {
  let best = null;
  let bestD2 = tolerance * tolerance;
  for (const h of BREADBOARD.holes) {
    const dx = h.x - x;
    const dy = h.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = h;
    }
  }
  return best;
}
