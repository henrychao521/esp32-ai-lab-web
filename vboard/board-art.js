// board-art.js — ES module for rendering virtual ESP32 development boards on Canvas

function drawRoundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createBoardArt(canvas, opts) {
  const options = opts || {};
  const boardType = options.board === "devkit" ? "devkit" : "tqt_pro";
  const scale = typeof options.scale === "number" && options.scale > 0 ? options.scale : 1;

  let layout;

  if (boardType === "tqt_pro") {
    const width = 300 * scale;
    const height = 420 * scale;
    const screen = {
      x: 86 * scale,
      y: 86 * scale,
      w: 128 * scale,
      h: 128 * scale
    };
    const led = {
      x: 245 * scale,
      y: 55 * scale,
      r: 7 * scale
    };
    const buttons = [
      {
        pin: 0,
        label: "BOOT (GPIO0)",
        x: 8 * scale,
        y: 130 * scale,
        w: 14 * scale,
        h: 40 * scale
      },
      {
        pin: 47,
        label: "KEY (GPIO47)",
        x: 278 * scale,
        y: 130 * scale,
        w: 14 * scale,
        h: 40 * scale
      }
    ];
    const pins = [
      { gpio: 16, label: "GPIO16", x: 75 * scale, y: 310 * scale, r: 7 * scale },
      { gpio: 17, label: "GPIO17", x: 125 * scale, y: 310 * scale, r: 7 * scale },
      { gpio: 18, label: "GPIO18", x: 175 * scale, y: 310 * scale, r: 7 * scale },
      { gpio: 48, label: "GPIO48", x: 225 * scale, y: 310 * scale, r: 7 * scale }
    ];

    layout = { width, height, screen, led, buttons, pins };
  } else {
    // devkit
    const width = 300 * scale;
    const height = 560 * scale;
    const screen = null;
    const led = {
      x: 75 * scale,
      y: 460 * scale,
      r: 6 * scale
    };
    const buttons = [
      {
        pin: 0,
        label: "BOOT",
        x: 208 * scale,
        y: 515 * scale,
        w: 24 * scale,
        h: 24 * scale
      }
    ];

    const leftPinDefs = [
      { label: "3V3", gpio: null },
      { label: "EN", gpio: null },
      { label: "GPIO36", gpio: 36 },
      { label: "GPIO39", gpio: 39 },
      { label: "GPIO34", gpio: 34 },
      { label: "GPIO35", gpio: 35 },
      { label: "GPIO32", gpio: 32 },
      { label: "GPIO33", gpio: 33 },
      { label: "GPIO25", gpio: 25 },
      { label: "GPIO26", gpio: 26 },
      { label: "GPIO27", gpio: 27 },
      { label: "GPIO14", gpio: 14 },
      { label: "GPIO12", gpio: 12 },
      { label: "GND", gpio: null },
      { label: "GPIO13", gpio: 13 }
    ];

    const rightPinDefs = [
      { label: "VIN", gpio: null },
      { label: "GND", gpio: null },
      { label: "GPIO23", gpio: 23 },
      { label: "GPIO22", gpio: 22 },
      { label: "GPIO1", gpio: 1 },
      { label: "GPIO3", gpio: 3 },
      { label: "GPIO21", gpio: 21 },
      { label: "GND", gpio: null },
      { label: "GPIO19", gpio: 19 },
      { label: "GPIO18", gpio: 18 },
      { label: "GPIO5", gpio: 5 },
      { label: "GPIO17", gpio: 17 },
      { label: "GPIO16", gpio: 16 },
      { label: "GPIO4", gpio: 4 },
      { label: "GPIO2", gpio: 2 }
    ];

    const pins = [];
    for (let i = 0; i < 15; i++) {
      pins.push({
        gpio: leftPinDefs[i].gpio,
        label: leftPinDefs[i].label,
        x: 45 * scale,
        y: (80 + i * 30) * scale,
        r: 6 * scale
      });
    }
    for (let i = 0; i < 15; i++) {
      pins.push({
        gpio: rightPinDefs[i].gpio,
        label: rightPinDefs[i].label,
        x: 255 * scale,
        y: (80 + i * 30) * scale,
        r: 6 * scale
      });
    }

    layout = { width, height, screen, led, buttons, pins };
  }

  function hitTest(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return null;

    // Check buttons (rectangles)
    for (let i = 0; i < layout.buttons.length; i++) {
      const b = layout.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { type: "button", pin: b.pin };
      }
    }

    // Check pins (circles with 1.5x hit radius for easier touch/click)
    for (let i = 0; i < layout.pins.length; i++) {
      const p = layout.pins[i];
      const hitR = p.r * 1.5;
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy <= hitR * hitR) {
        return { type: "pin", gpio: p.gpio };
      }
    }

    // Check LED (circle with 1.5x hit radius)
    if (layout.led) {
      const hitR = layout.led.r * 1.5;
      const dx = x - layout.led.x;
      const dy = y - layout.led.y;
      if (dx * dx + dy * dy <= hitR * hitR) {
        return { type: "led" };
      }
    }

    return null;
  }

  function draw(state) {
    const s = state || {};
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fontStr = Math.round(11 * scale) + "px sans-serif";
    ctx.font = fontStr;

    // 1. Clear entire canvas
    ctx.clearRect(0, 0, layout.width, layout.height);

    const screenImg = s.screen || null;
    const ledOn = !!s.led;
    const buttonsState = s.buttons || {};
    const pinsState = s.pins || {};
    const servosState = s.servos || {};
    const adcState = s.adc || {};
    const battery = s.battery !== undefined ? s.battery : null;
    const status = s.status || "idle";
    const boardName = s.name || "";

    if (boardType === "tqt_pro") {
      // Background PCB
      ctx.fillStyle = "#141414";
      drawRoundRect(ctx, 16 * scale, 16 * scale, 268 * scale, 388 * scale, 14 * scale);
      ctx.fill();

      // PCB outer borderline
      ctx.strokeStyle = "#252525";
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      drawRoundRect(ctx, 16 * scale, 16 * scale, 268 * scale, 388 * scale, 14 * scale);
      ctx.stroke();

      // Main upper square body border (approx 260x260)
      ctx.strokeStyle = "#2e2e2e";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, 20 * scale, 20 * scale, 260 * scale, 260 * scale, 10 * scale);
      ctx.stroke();

      // USB-C cutout at top center of main body
      ctx.fillStyle = "#0c0c0c";
      drawRoundRect(ctx, 130 * scale, 10 * scale, 40 * scale, 14 * scale, 4 * scale);
      ctx.fill();
      ctx.strokeStyle = "#777777";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, 130 * scale, 10 * scale, 40 * scale, 14 * scale, 4 * scale);
      ctx.stroke();

      // Inner USB tongue
      ctx.fillStyle = "#333333";
      drawRoundRect(ctx, 136 * scale, 13 * scale, 28 * scale, 6 * scale, 2 * scale);
      ctx.fill();

      // Battery icon & voltage text in top-left corner
      if (battery !== null) {
        const bx = 30 * scale;
        const by = 35 * scale;
        const bw = 22 * scale;
        const bh = 11 * scale;

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.strokeRect(bx, by, bw, bh);

        // Terminal tip
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(bx + bw, by + 3 * scale, 2.5 * scale, bh - 6 * scale);

        // Battery fill
        ctx.fillStyle = "#4caf50";
        ctx.fillRect(bx + 2 * scale, by + 2 * scale, (bw - 4 * scale) * 0.75, bh - 4 * scale);

        // Voltage text
        ctx.font = fontStr;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const valText = typeof battery === "number" ? battery.toFixed(2) + "V" : String(battery) + "V";
        ctx.fillText(valText, bx + bw + 7 * scale, by + bh / 2);
      }

      // Status indicator light in top-right corner
      const statusX = 265 * scale;
      const statusY = 35 * scale;
      const statusR = 4 * scale;
      ctx.beginPath();
      ctx.arc(statusX, statusY, statusR, 0, Math.PI * 2);
      if (status === "running") {
        ctx.fillStyle = "#00e676";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(statusX, statusY, statusR * 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 230, 118, 0.25)";
        ctx.fill();
      } else {
        ctx.fillStyle = "#666666";
        ctx.fill();
      }

      // Screen outer deep-grey bezel and black frame
      const sx = layout.screen.x;
      const sy = layout.screen.y;
      const sw = layout.screen.w;
      const sh = layout.screen.h;

      ctx.fillStyle = "#262626";
      drawRoundRect(ctx, sx - 8 * scale, sy - 8 * scale, sw + 16 * scale, sh + 16 * scale, 4 * scale);
      ctx.fill();

      ctx.fillStyle = "#000000";
      ctx.fillRect(sx - 2 * scale, sy - 2 * scale, sw + 4 * scale, sh + 4 * scale);

      // Screen content
      if (screenImg) {
        ctx.imageSmoothingEnabled = false;
        try {
          ctx.drawImage(screenImg, sx, sy, sw, sh);
        } catch (_) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(sx, sy, sw, sh);
        }
      } else {
        ctx.fillStyle = "#000000";
        ctx.fillRect(sx, sy, sw, sh);
      }

      // Virtual LED in upper-right outside screen
      const lx = layout.led.x;
      const ly = layout.led.y;
      const lr = layout.led.r;
      if (ledOn) {
        // Yellow-white glow
        ctx.beginPath();
        ctx.arc(lx, ly, lr * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 140, 0.3)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lx, ly, lr * 1.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 200, 0.7)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(lx, ly, lr, 0, Math.PI * 2);
        ctx.fillStyle = "#333333";
        ctx.fill();
        ctx.strokeStyle = "#222222";
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.stroke();
      }

      // Buttons: BOOT (left edge) & KEY (right edge)
      for (let i = 0; i < layout.buttons.length; i++) {
        const b = layout.buttons[i];
        const isPressed = !!buttonsState[b.pin];
        const shift = isPressed ? Math.max(1, Math.round(1 * scale)) : 0;

        ctx.fillStyle = isPressed ? "#181818" : "#2a2a2a";
        ctx.strokeStyle = isPressed ? "#555555" : "#777777";
        ctx.lineWidth = Math.max(1, 1 * scale);

        drawRoundRect(ctx, b.x + shift, b.y + shift, b.w, b.h, 2 * scale);
        ctx.fill();
        ctx.stroke();

        // Small label text near button
        ctx.font = fontStr;
        ctx.fillStyle = "#aaaaaa";
        ctx.textBaseline = "middle";
        if (b.pin === 0) {
          ctx.textAlign = "left";
          ctx.fillText("BOOT", b.x + b.w + 4 * scale, b.y + b.h / 2);
        } else {
          ctx.textAlign = "right";
          ctx.fillText("KEY", b.x - 4 * scale, b.y + b.h / 2);
        }
      }

      // Bottom 4 extension pins
      for (let i = 0; i < layout.pins.length; i++) {
        const p = layout.pins[i];

        // Golden circular solder pad
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "#141414";
        ctx.fill();
        ctx.strokeStyle = "#d4af37";
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.stroke();

        // Inner dark hole
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = "#050505";
        ctx.fill();

        // Digital state indicator: 1 = bright red, 0 = grey
        if (p.gpio !== null && pinsState[p.gpio] !== undefined) {
          const val = pinsState[p.gpio];
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
          if (val === 1) {
            ctx.fillStyle = "#ff1744";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 23, 68, 0.35)";
            ctx.fill();
          } else {
            ctx.fillStyle = "#666666";
            ctx.fill();
          }
        }

        // Pin label below pin
        ctx.font = fontStr;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(p.label, p.x, p.y + p.r + 4 * scale);

        // Servos overlay
        if (p.gpio !== null && servosState[p.gpio] !== undefined) {
          const rawAngle = Number(servosState[p.gpio]);
          const angle = Math.max(0, Math.min(180, isNaN(rawAngle) ? 0 : rawAngle));
          const pivotX = p.x;
          const pivotY = p.y - 20 * scale;

          ctx.fillStyle = "#0277bd";
          ctx.fillRect(pivotX - 7 * scale, pivotY - 6 * scale, 14 * scale, 12 * scale);

          ctx.beginPath();
          ctx.arc(pivotX, pivotY, 2.5 * scale, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          const rad = angle * (Math.PI / 180);
          const armLen = 11 * scale;
          const endX = pivotX + Math.cos(rad) * armLen;
          const endY = pivotY - Math.sin(rad) * armLen;

          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(endX, endY);
          ctx.strokeStyle = "#ff9800";
          ctx.lineWidth = Math.max(1.5, 2 * scale);
          ctx.stroke();
        }

        // ADC gauge overlay
        if (p.gpio !== null && adcState[p.gpio] !== undefined) {
          const rawVal = Number(adcState[p.gpio]);
          const clamped = Math.max(0, Math.min(4095, isNaN(rawVal) ? 0 : rawVal));
          const ratio = clamped / 4095;
          const gx = p.x - 12 * scale;
          const gy = p.y + p.r + 17 * scale;
          const gw = 24 * scale;
          const gh = 4 * scale;

          ctx.fillStyle = "#222222";
          ctx.fillRect(gx, gy, gw, gh);
          ctx.fillStyle = "#00e5ff";
          ctx.fillRect(gx, gy, gw * ratio, gh);
          ctx.strokeStyle = "#555555";
          ctx.lineWidth = Math.max(1, 0.75 * scale);
          ctx.strokeRect(gx, gy, gw, gh);
        }
      }

      // Bottom silkscreen text
      ctx.font = fontStr;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      if (boardName) {
        ctx.fillText(boardName, 150 * scale, 378 * scale);
      }
      ctx.fillText("MicroPython 虛擬板", 150 * scale, 396 * scale);

    } else {
      // DevKit
      // Background PCB
      ctx.fillStyle = "#141414";
      drawRoundRect(ctx, 20 * scale, 15 * scale, 260 * scale, 530 * scale, 10 * scale);
      ctx.fill();

      ctx.strokeStyle = "#252525";
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      drawRoundRect(ctx, 20 * scale, 15 * scale, 260 * scale, 530 * scale, 10 * scale);
      ctx.stroke();

      // Top antenna area & serpentine copper trace
      const antX = 75 * scale;
      const antY = 24 * scale;
      const antW = 150 * scale;
      const antH = 34 * scale;
      ctx.fillStyle = "#0e0e0e";
      ctx.fillRect(antX, antY, antW, antH);

      ctx.strokeStyle = "#c8963e";
      ctx.lineWidth = Math.max(1, 1.5 * scale);
      ctx.beginPath();
      ctx.moveTo(antX + 10 * scale, antY + antH - 5 * scale);
      for (let x = antX + 15 * scale; x <= antX + antW - 15 * scale; x += 12 * scale) {
        ctx.lineTo(x, antY + 5 * scale);
        ctx.lineTo(x + 6 * scale, antY + antH - 5 * scale);
      }
      ctx.stroke();

      // Metallic shield: ESP32-WROOM-32
      const shX = 75 * scale;
      const shY = 62 * scale;
      const shW = 150 * scale;
      const shH = 135 * scale;
      ctx.fillStyle = "#b5b5b5";
      drawRoundRect(ctx, shX, shY, shW, shH, 4 * scale);
      ctx.fill();

      ctx.strokeStyle = "#828282";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, shX, shY, shW, shH, 4 * scale);
      ctx.stroke();

      ctx.font = fontStr;
      ctx.fillStyle = "#222222";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ESP32-WROOM-32", 150 * scale, shY + shH / 2);

      // Status indicator light in top-right
      const statusX = 260 * scale;
      const statusY = 32 * scale;
      const statusR = 4 * scale;
      ctx.beginPath();
      ctx.arc(statusX, statusY, statusR, 0, Math.PI * 2);
      if (status === "running") {
        ctx.fillStyle = "#00e676";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(statusX, statusY, statusR * 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 230, 118, 0.25)";
        ctx.fill();
      } else {
        ctx.fillStyle = "#666666";
        ctx.fill();
      }

      // Micro-USB cutout at bottom center
      ctx.fillStyle = "#888888";
      drawRoundRect(ctx, 126 * scale, 520 * scale, 48 * scale, 28 * scale, 3 * scale);
      ctx.fill();
      ctx.strokeStyle = "#aaaaaa";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, 126 * scale, 520 * scale, 48 * scale, 28 * scale, 3 * scale);
      ctx.stroke();

      ctx.fillStyle = "#222222";
      drawRoundRect(ctx, 134 * scale, 532 * scale, 32 * scale, 14 * scale, 2 * scale);
      ctx.fill();

      // Left button: EN (visual only)
      ctx.fillStyle = "#2a2a2a";
      ctx.strokeStyle = "#777777";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, 68 * scale, 515 * scale, 24 * scale, 24 * scale, 2 * scale);
      ctx.fill();
      ctx.stroke();

      ctx.font = fontStr;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("EN", 80 * scale, 511 * scale);

      // Right button: BOOT (clickable, in layout.buttons)
      const bootBtn = layout.buttons[0];
      const bootPressed = !!buttonsState[bootBtn.pin];
      const bootShift = bootPressed ? Math.max(1, Math.round(1 * scale)) : 0;

      ctx.fillStyle = bootPressed ? "#181818" : "#2a2a2a";
      ctx.strokeStyle = bootPressed ? "#555555" : "#777777";
      ctx.lineWidth = Math.max(1, 1 * scale);
      drawRoundRect(ctx, bootBtn.x + bootShift, bootBtn.y + bootShift, bootBtn.w, bootBtn.h, 2 * scale);
      ctx.fill();
      ctx.stroke();

      ctx.font = fontStr;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("BOOT", bootBtn.x + bootBtn.w / 2, bootBtn.y - 4 * scale);

      // Onboard LED (GPIO2) at lower-left
      const ledX = layout.led.x;
      const ledY = layout.led.y;
      const ledR = layout.led.r;
      if (ledOn || pinsState[2] === 1) {
        // Blue glow
        ctx.beginPath();
        ctx.arc(ledX, ledY, ledR * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 176, 255, 0.35)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ledX, ledY, ledR * 1.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 229, 255, 0.75)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ledX, ledY, ledR, 0, Math.PI * 2);
        ctx.fillStyle = "#e0f7ff";
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(ledX, ledY, ledR, 0, Math.PI * 2);
        ctx.fillStyle = "#16222f";
        ctx.fill();
        ctx.strokeStyle = "#0e1720";
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.stroke();
      }

      ctx.font = fontStr;
      ctx.fillStyle = "#aaaaaa";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("LED", ledX, ledY + ledR + 3 * scale);

      // Silkscreen name in middle
      ctx.font = fontStr;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (boardName) {
        ctx.fillText(boardName, 150 * scale, 225 * scale);
        ctx.fillText("DOIT ESP32 DEVKIT V1", 150 * scale, 242 * scale);
      } else {
        ctx.fillText("DOIT ESP32 DEVKIT V1", 150 * scale, 235 * scale);
      }

      // Draw 30 pins
      for (let i = 0; i < layout.pins.length; i++) {
        const p = layout.pins[i];
        const isLeftRow = p.x < 150 * scale;

        // Golden circular solder pad
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "#141414";
        ctx.fill();
        ctx.strokeStyle = "#d4af37";
        ctx.lineWidth = Math.max(1, 1.5 * scale);
        ctx.stroke();

        // Inner hole
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = "#050505";
        ctx.fill();

        // Digital state indicator: 1 = red, 0 = grey
        if (p.gpio !== null && pinsState[p.gpio] !== undefined) {
          const val = pinsState[p.gpio];
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
          if (val === 1) {
            ctx.fillStyle = "#ff1744";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 23, 68, 0.35)";
            ctx.fill();
          } else {
            ctx.fillStyle = "#666666";
            ctx.fill();
          }
        }

        // Pin label text
        ctx.font = fontStr;
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        if (isLeftRow) {
          ctx.textAlign = "left";
          ctx.fillText(p.label, p.x + p.r + 6 * scale, p.y);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(p.label, p.x - p.r - 6 * scale, p.y);
        }

        // Servos overlay
        if (p.gpio !== null && servosState[p.gpio] !== undefined) {
          const rawAngle = Number(servosState[p.gpio]);
          const angle = Math.max(0, Math.min(180, isNaN(rawAngle) ? 0 : rawAngle));
          const pivotX = isLeftRow ? p.x + 85 * scale : p.x - 85 * scale;
          const pivotY = p.y;

          ctx.fillStyle = "#0277bd";
          ctx.fillRect(pivotX - 6 * scale, pivotY - 5 * scale, 12 * scale, 10 * scale);

          ctx.beginPath();
          ctx.arc(pivotX, pivotY, 2 * scale, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();

          const rad = angle * (Math.PI / 180);
          const armLen = 10 * scale;
          const endX = pivotX + Math.cos(rad) * armLen;
          const endY = pivotY - Math.sin(rad) * armLen;

          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(endX, endY);
          ctx.strokeStyle = "#ff9800";
          ctx.lineWidth = Math.max(1.5, 2 * scale);
          ctx.stroke();
        }

        // ADC gauge overlay
        if (p.gpio !== null && adcState[p.gpio] !== undefined) {
          const rawVal = Number(adcState[p.gpio]);
          const clamped = Math.max(0, Math.min(4095, isNaN(rawVal) ? 0 : rawVal));
          const ratio = clamped / 4095;
          const gw = 20 * scale;
          const gh = 4 * scale;
          const gx = isLeftRow ? p.x + 60 * scale : p.x - 80 * scale;
          const gy = p.y - gh / 2;

          ctx.fillStyle = "#222222";
          ctx.fillRect(gx, gy, gw, gh);
          ctx.fillStyle = "#00e5ff";
          ctx.fillRect(gx, gy, gw * ratio, gh);
          ctx.strokeStyle = "#555555";
          ctx.lineWidth = Math.max(1, 0.75 * scale);
          ctx.strokeRect(gx, gy, gw, gh);
        }
      }
    }
  }

  return {
    layout,
    hitTest,
    draw
  };
}
