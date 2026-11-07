// catalog.js — 畫布用的元件目錄：Wokwi 元素標籤、像素尺寸、預設屬性、互動方式；板子外觀規格。
// 腳位座標來自 @wokwi/elements 的 pinInfo（元素渲染尺寸的 CSS px）。
import { PARTS } from "./circuit.js";

export const CATALOG = {
  led: { tag: "wokwi-led", w: 40, h: 50, label: "LED", attrs: { color: "red" }, attrOptions: { color: ["red", "green", "blue", "yellow", "orange", "white"] } },
  resistor: { tag: "wokwi-resistor", w: 59.1, h: 11.3, label: "電阻", attrs: { value: "220" }, attrOptions: { value: ["100", "220", "330", "470", "1k", "4.7k", "10k"] } },
  pushbutton: { tag: "wokwi-pushbutton", w: 67.3, h: 45.4, label: "按鍵", attrs: { color: "green" }, interact: "press" },
  "slide-switch": { tag: "wokwi-slide-switch", w: 32.1, h: 34.9, label: "滑動開關", attrs: {}, interact: "toggle" },
  potentiometer: { tag: "wokwi-potentiometer", w: 75.6, h: 75.6, label: "可變電阻", attrs: {}, interact: "knob" },
  "photoresistor-sensor": { tag: "wokwi-photoresistor-sensor", w: 173.7, h: 61.5, label: "光敏模組", attrs: {}, interact: "light" },
  buzzer: { tag: "wokwi-buzzer", w: 64.3, h: 75.6, label: "蜂鳴器", attrs: {} },
  servo: { tag: "wokwi-servo", w: 170.1, h: 119.5, label: "伺服馬達", attrs: {} },
  "led-bar-graph": { tag: "wokwi-led-bar-graph", w: 38.2, h: 96.4, label: "LED 長條", attrs: { color: "red" } },
  "rgb-led": { tag: "wokwi-rgb-led", w: 42.1, h: 72.6, label: "RGB LED", attrs: {} },
  // 第二批
  ssd1306: { tag: "wokwi-ssd1306", w: 150, h: 116, label: "OLED SSD1306", attrs: {}, cat: "顯示" },
  lcd1602: { tag: "wokwi-lcd1602", w: 302.4, h: 136.2, label: "LCD1602（I2C）", attrs: { pins: "i2c" }, cat: "顯示" },
  "hc-sr04": { tag: "wokwi-hc-sr04", w: 170.1, h: 94.5, label: "超音波 HC-SR04", attrs: {}, interact: "distance", cat: "感測" },
  dht22: { tag: "wokwi-dht22", w: 57.1, h: 116.7, label: "溫濕度 DHT22", attrs: {}, interact: "climate", cat: "感測" },
  "neopixel-strip": { tag: "wokwi-neopixel-matrix", w: 201.4, h: 22.7, label: "NeoPixel 燈條（8 顆）", attrs: { rows: "1", cols: "8" }, cat: "致動" },
  pir: { tag: "wokwi-pir-motion-sensor", w: 90.7, h: 92.4, label: "PIR 人體感測", attrs: {}, interact: "motion", cat: "感測" },
  relay: { tag: "sim-relay", w: 120, h: 70, label: "繼電器模組", attrs: {}, cat: "致動" },
  stepper: { tag: "wokwi-stepper-motor", w: 163.7, h: 178.8, label: "步進馬達", attrs: { size: "17" }, cat: "致動" },
  joystick: { tag: "wokwi-analog-joystick", w: 102.8, h: 120.2, label: "搖桿", attrs: {}, interact: "joystick", cat: "輸入" },
  // 類比／IC（analog-elements.js 自繪）
  capacitor: { tag: "sim-capacitor", w: 36, h: 60, label: "電解電容", attrs: { value: "100u" }, cat: "類比", attrOptions: { value: ["1u", "10u", "47u", "100u", "220u", "470u", "1000u"] } },
  diode: { tag: "sim-diode", w: 60, h: 22, label: "二極體", attrs: { model: "1N4007" }, cat: "類比", attrOptions: { model: ["1N4007", "1N4148", "1N5819"] } },
  npn: { tag: "sim-npn", w: 44, h: 50, label: "NPN 電晶體", attrs: { model: "2N2222" }, cat: "類比", attrOptions: { model: ["2N2222", "2N3904", "8050"] } },
  ne555: { tag: "sim-ne555", w: 90, h: 60, label: "555 計時器", attrs: {}, cat: "類比" },
};
for (const k of Object.keys(CATALOG)) CATALOG[k].pins = PARTS[k].pins;

/** 取得元件的腳位座標（相對元素左上，未旋轉）。esp32-devkit 與其他 Wokwi 元素由實際元素的 pinInfo 取；這裡是靜態備援表。 */
export const PIN_TABLE = {
  led: { A: [25, 42], C: [15, 42] },
  resistor: { 1: [0, 5.65], 2: [58.8, 5.65] },
  pushbutton: { "1.l": [0, 13], "2.l": [0, 32], "1.r": [67, 13], "2.r": [67, 32] },
  "slide-switch": { 1: [6.5, 34], 2: [16, 34], 3: [25.5, 34] },
  potentiometer: { GND: [29, 68.5], SIG: [39, 68.5], VCC: [49, 68.5] },
  "photoresistor-sensor": { VCC: [172, 16], GND: [172, 26], DO: [172, 35.8], AO: [172, 45.5] },
  buzzer: { 1: [27, 84], 2: [37, 84] },
  servo: { GND: [0, 50], "V+": [0, 59.5], PWM: [0, 69] },
  "rgb-led": { R: [8.5, 44], COM: [18, 54], G: [26.4, 44], B: [35.7, 44] },
};
const mm = 96 / 25.4;
Object.assign(PIN_TABLE, {
  ssd1306: { DATA: [36.5, 12.5], CLK: [45.5, 12.5], DC: [54.5, 12.5], RST: [64.5, 12.5], CS: [74.5, 12.5], "3V3": [83.5, 12.5], VIN: [93.5, 12.5], GND: [103.5, 12] },
  lcd1602: { GND: [4, 32], VCC: [4, 41.5], SDA: [4, 51], SCL: [4, 60.5] },
  "hc-sr04": { VCC: [71.3, 94.5], TRIG: [81.3, 94.5], ECHO: [91.3, 94.5], GND: [101.3, 94.5] },
  dht22: { VCC: [15, 114.9], SDA: [24.5, 114.9], NC: [34.1, 114.9], GND: [43.8, 114.9] },
  "neopixel-strip": { GND: [100.7 - 1.5 * 9.6, 22.7], VCC: [100.7 - 0.5 * 9.6, 22.7], DIN: [100.7 + 0.5 * 9.6, 22.7], DOUT: [100.7 + 1.5 * 9.6, 22.7] },
  pir: { VCC: [36.2, 92], OUT: [45.9, 92], GND: [55.6, 92] },
  relay: { VCC: [12, 64], GND: [28, 64], IN: [44, 64], NO: [76, 64], COM: [92, 64], NC: [108, 64] },
  capacitor: { "+": [10, 60], "-": [26, 60] },
  diode: { A: [0, 11], K: [60, 11] },
  npn: { E: [10, 50], B: [22, 50], C: [34, 50] },
  ne555: { GND: [15, 60], TRIG: [35, 60], OUT: [55, 60], RESET: [75, 60], CTRL: [75, 0], THR: [55, 0], DIS: [35, 0], VCC: [15, 0] },
  stepper: { "A-": [66.8, 178.8], "A+": [66.8 + 2.54 * mm, 178.8], "B+": [66.8 + 5.08 * mm, 178.8], "B-": [66.8 + 7.62 * mm, 178.8] },
  joystick: { VCC: [33, 115.8], VERT: [42.6, 115.8], HORZ: [52.2, 115.8], SEL: [61.8, 115.8], GND: [71.4, 115.8] },
});
PIN_TABLE["led-bar-graph"] = {};
for (let i = 1; i <= 10; i++) { PIN_TABLE["led-bar-graph"]["A" + i] = [1.27 * mm, (1.27 + (i - 1) * 2.54) * mm]; PIN_TABLE["led-bar-graph"]["C" + i] = [8.89 * mm, (1.27 + (i - 1) * 2.54) * mm]; }

/** ESP32 DevKit（Wokwi 元素）腳位名 → 我們的板子腳位（gpio 數字或電源名） */
export const DEVKIT_PINMAP = {
  VIN: "VIN", "GND.2": "GND", "GND.1": "GND", "3V3": "3V3", EN: null, VP: 36, VN: 39,
  D34: 34, D35: 35, D32: 32, D33: 33, D25: 25, D26: 26, D27: 27, D14: 14, D12: 12, D13: 13,
  D15: 15, D2: 2, D4: 4, RX2: 16, TX2: 17, D5: 5, D18: 18, D19: 19, D21: 21, RX0: 3, TX0: 1, D22: 22, D23: 23,
};
export const DEVKIT_PINS = [["VIN", 5, 158.5], ["GND.2", 5, 149], ["D13", 5, 139.5], ["D12", 5, 130.4], ["D14", 5, 120], ["D27", 5, 110.8], ["D26", 5, 101], ["D25", 5, 91.3], ["D33", 5, 81.7], ["D32", 5, 72.2], ["D35", 5, 62.9], ["D34", 5, 53.1], ["VN", 5, 44], ["VP", 5, 34], ["EN", 5, 24],
  ["3V3", 101.3, 158.5], ["GND.1", 101.3, 149], ["D15", 101.3, 139.5], ["D2", 101.3, 130.4], ["D4", 101.3, 120], ["RX2", 101.3, 110.8], ["TX2", 101.3, 101], ["D5", 101.3, 91.3], ["D18", 101.3, 81.7], ["D19", 101.3, 72.2], ["D21", 101.3, 62.9], ["RX0", 101.3, 53.1], ["TX0", 101.3, 44], ["D22", 101.3, 34], ["D23", 101.3, 24]];

/** 自繪板子（T-QT Pro、T-Display S3、XIAO）：外觀規格＋腳位表。pin: 名稱、x、y、對應（gpio 數字或電源名）、說明 */
export const BOARD_ART = {
  tqt_pro: {
    w: 200, h: 185, color: "#141414", title: "T-QT Pro", screen: { x: 36, y: 12, w: 128, h: 128 },
    buttons: [{ gpio: 0, label: "BOOT", x: 4, y: 60, w: 8, h: 28 }, { gpio: 47, label: "KEY", x: 188, y: 60, w: 8, h: 28 }],
    pins: [["5V", 22, 168, "5V"], ["GND", 48, 168, "GND"], ["3V3", 74, 168, "3V3"], ["G16", 100, 168, 16], ["G17", 126, 168, 17], ["G18", 152, 168, 18], ["G48", 178, 168, 48]],
    led: null,
  },
  tdisplay_s3: {
    w: 150, h: 280, color: "#141414", title: "T-Display S3", screen: { x: 40, y: 60, w: 70, h: 130, native: [170, 320] },
    buttons: [{ gpio: 0, label: "BOOT", x: 2, y: 100, w: 7, h: 26 }, { gpio: 14, label: "KEY", x: 2, y: 140, w: 7, h: 26 }],
    pins: (() => { const L = [["3V3", "3V3"], ["GND", "GND"], ["G43", 43], ["G44", 44], ["G18", 18], ["G17", 17], ["G21", 21], ["G16", 16], ["G1", 1], ["G2", 2], ["G3", 3], ["G10", 10], ["G11", 11], ["G12", 12], ["G13", 13]];
      const R = [["5V", "5V"], ["GND", "GND"], ["3V3", "3V3"]]; const out = [];
      L.forEach((p, i) => out.push([p[0], 10, 24 + i * 15.5, p[1]])); R.forEach((p, i) => out.push([p[0], 140, 24 + i * 15.5, p[1]])); return out; })(),
    led: null,
  },
  xiao_esp32s3: {
    w: 90, h: 100, color: "#1c1c1c", title: "XIAO ESP32S3", screen: null,
    buttons: [{ gpio: 0, label: "B", x: 38, y: 8, w: 14, h: 8 }],
    pins: [["D0", 8, 22, 1], ["D1", 8, 34, 2], ["D2", 8, 46, 3], ["D3", 8, 58, 4], ["D4", 8, 70, 5], ["D5", 8, 82, 6], ["D6", 8, 94, 43],
           ["5V", 82, 22, "5V"], ["GND", 82, 34, "GND"], ["3V3", 82, 46, "3V3"], ["D10", 82, 58, 9], ["D9", 82, 70, 8], ["D8", 82, 82, 7], ["D7", 82, 94, 44]],
    led: { gpio: 21, x: 45, y: 50, inverted: true },
  },
};
