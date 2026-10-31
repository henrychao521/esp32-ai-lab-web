# vboard 第三方來源

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| micropython.mjs、micropython.wasm | npm `@micropython/micropython-webassembly-pyscript`（MicroPython 官方 ports/webassembly，pyscript 變體） | 1.29.0-6（MicroPython v1.29.0，2026-08-25 建置） | MIT（見 LICENSE-micropython.txt） |

取得方式：`npm pack @micropython/micropython-webassembly-pyscript` → 取 package/ 裡的兩個檔。
與板子上的 MicroPython 同為 1.29，語法檢查結果一致；差異（無 machine／network／_thread 等）由 `lab_virtual.py` 的替身補上。
| py/ssd1306.py | micropython-lib `micropython/drivers/display/ssd1306`（學生 `import ssd1306` 用，與實機同一份） | 2026-10 master | MIT |
| py/lcd_api.py、py/machine_i2c_lcd.py | dhylands/python_lcd（PCF8574 I2C 背板的 LCD1602 驅動，`from machine_i2c_lcd import I2cLcd`） | 2026-10 master | MIT |
