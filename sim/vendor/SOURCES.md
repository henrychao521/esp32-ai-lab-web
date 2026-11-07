# sim/vendor 第三方來源

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| wokwi-elements.bundle.min.js | npm `@wokwi/elements`（自含 lit，IIFE，載入後註冊 `<wokwi-*>` 自訂元素，全域 `elements`） | 1.9.2 | MIT（LICENSE-wokwi-elements.txt；內含 lit 的 BSD-3） |

取得：`npm pack @wokwi/elements@1.9.2` → dist/wokwi-elements.bundle.min.js。離線可用，不依賴 CDN。
pinInfo 的 x、y 是元素渲染尺寸的 CSS px（元素 SVG 以 mm 標示寬高，96 dpi 換算）。
| codemirror.bundle.js | CodeMirror 6（@codemirror/state 6.7.6、view 6.43.15、language 6.13.1、commands 6.11.1、lang-python 6.2.1、**lang-cpp 6.0.3（@lezer/cpp 1.1.6，2026-11-07 為 Arduino 加入）**、search 6.7.2、autocomplete 6.20.4、lint 6.9.7、theme-one-dark 6.1.3）用 esbuild 0.28.2 `--bundle --format=esm --minify` 打成單一 ESM；入口檔 `codemirror.entry.js` | 見左 | MIT（LICENSE-codemirror.txt；lang-cpp／@lezer/cpp 同為 MIT） |
| avr8js.esm.js | npm `avr8js`（Wokwi 的 AVR 8 位元模擬器，ATmega328P 等），esbuild 0.28.2 `--bundle --format=esm --legal-comments=inline` 打成單檔（原本 dist/esm 是多檔、import 沒副檔名，瀏覽器原生 ESM 載不進來）；來源原型 `arduino-proto/`（git 005884b） | 0.21.1 | MIT（LICENSE-avr8js.txt） |

## 引擎 B（`sim-engine/`，真韌體）

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| sim-engine/esp32sim.wasm、vendor/jit.mjs | [mikroverk/esp32sim](https://github.com/mikroverk/esp32sim)（ESP32／ESP32-S3 全系統模擬器，Rust → wasm32）＋我們的板子模型與 lab ABI（fork `/Volumes/Work/esp32sim-boards` branch `lab-boards`；修了 S3 GP-SPI `DMA_INT_SET` 未模擬的 bug） | v0.3.0（2026-10） | MIT（sim-engine/vendor/LICENSE-esp32sim.txt） |
| sim-engine/rom/esp32s3_rev0_rom.elf、esp32_rev300_rom.elf | Espressif [esp-rom-elfs](https://github.com/espressif/esp-rom-elfs)（遮罩 ROM 的符號與程式碼，模擬器開機用） | 20260528（tar sha256 見 rom/*.sha256） | Apache-2.0（sim-engine/rom/LICENSE-esp-rom-elfs.txt） |
| sim-engine/arduino/t_qt_weather_clock.bin | 本專案的 T-QT Pro Arduino 天氣時鐘（`/Volumes/Work/t-qt-pro-weather-clock`，arduino-esp32 3.x 編譯的合併映像，含 bootloader／分割表／應用程式） | 2026-10-31 建置 | 專案自有；內含 arduino-esp32（LGPL-2.1）與 ESP-IDF（Apache-2.0）元件 |
| web/firmware/micropython-esp32s3.bin、micropython-esp32.bin | MicroPython 官方釋出（引擎 B 開機用的未修改韌體） | v1.29.0 | MIT（web/firmware/SOURCES.md） |

## 引擎 C（`sim/engine-avr.js`，Arduino UNO）

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| sim/arduino-hex/*.hex | 本專案範例草稿（`tools/arduino_sketches/<id>/<id>.ino`，`tools/examples_gen/uno.py` 產生）以 arduino-cli 1.5.1 `--fqbn arduino:avr:uno` 編譯（`tools/build_arduino_examples.py`） | 2026-11-07 | 草稿為專案自有；hex 內含 Arduino AVR core 1.8.8（LGPL-2.1，[ArduinoCore-avr](https://github.com/arduino/ArduinoCore-avr)）、avr-libc（BSD-3）、Servo 1.3.0（LGPL-2.1，[arduino-libraries/Servo](https://github.com/arduino-libraries/Servo)，只有 uno_servo_sweep 用）；LGPL 物件隨 App 散布要附這段授權說明與原始碼連結 |
