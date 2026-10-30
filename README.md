# ESP32 AI Lab 首燒網站

給 [esp32-ai-lab](https://github.com/henrychao521/esp32-ai-lab) 教學平台用的一次性首燒頁：
在電腦的 Chrome／Edge 開 **https://henrychao521.github.io/esp32-ai-lab-web/**，
① ESP Web Tools 燒官方 MicroPython（`firmware/`，v1.29.0，ESP32-S3 與 ESP32）② Web Serial raw REPL 寫入代理程式（`agent_bundle.json`）與 Wi-Fi 設定。

原生 USB 的板子（LILYGO T-QT Pro 等）燒錄前要按住 BOOT 再按 RST／重插 USB 進下載模式，頁面上有步驟。
本 repo 只放靜態網頁與公開韌體；代理程式原始碼、App、伺服器在主專案。MicroPython 為 MIT 授權，Microdot 為 MIT 授權。
