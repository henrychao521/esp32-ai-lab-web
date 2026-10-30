# 韌體來源（MicroPython v1.29.0，2026-08-24 官方釋出，MIT 授權）

| 檔名 | 晶片 | 官方檔名與網址 | 燒錄位址 | sha256 |
|---|---|---|---|---|
| micropython-esp32.bin | ESP32（WROOM；DevKit、T-Display v1.1） | https://micropython.org/resources/firmware/ESP32_GENERIC-20260824-v1.29.0.bin | 0x1000 | e67ad6015a0a504c1fec9aa9bbf589d0432ed28e62546f4f8dd8a147f8bd95f6 |
| micropython-esp32s2.bin | ESP32-S2（無 BLE，原生 USB） | https://micropython.org/resources/firmware/ESP32_GENERIC_S2-20260824-v1.29.0.bin | 0x1000 | c7e30ea6978437432cbb6233886a8037db766e84d6ae844acb6ed20d00cf5873 |
| micropython-esp32s3.bin | ESP32-S3 四線 PSRAM（T-QT Pro、DevKitC-1 N8R2） | https://micropython.org/resources/firmware/ESP32_GENERIC_S3-20260824-v1.29.0.bin | 0x0 | 1dd9dcd27ba2d6a1cb7f7b49a063f46d3d807d68b0151161233920228285e300 |
| micropython-esp32s3-octal.bin | ESP32-S3 八線 PSRAM（T-Display S3、XIAO ESP32S3、DevKitC-1 N16R8） | https://micropython.org/resources/firmware/ESP32_GENERIC_S3-SPIRAM_OCT-20260824-v1.29.0.bin | 0x0 | ab24eadfe3ef0e6ee38834d730e648def7cd82f3fa51ee0bbc59c29a6e1bd176 |
| micropython-esp32c3.bin | ESP32-C3（RISC-V；XIAO ESP32C3、SuperMini） | https://micropython.org/resources/firmware/ESP32_GENERIC_C3-20260824-v1.29.0.bin | 0x0 | bf72ed9eb88ad3a8f49d02c3d371f9ea34c90a8a303aeb9e324d8efd4a2a655a |
| micropython-esp32c6.bin | ESP32-C6（RISC-V，Wi-Fi 6） | https://micropython.org/resources/firmware/ESP32_GENERIC_C6-20260824-v1.29.0.bin | 0x0 | 3688ba4e2c3949e639f5772e99fdb0efa1258b162a496133f78c108434195c89 |

- 2026-10-31 下載並以 `shasum -a 256` 核對；`tools/verify_firmware.sh` 可重新核對。
- 1.26 起 `ESP32_GENERIC_S3` 標準版自動偵測 flash 大小（4MB 以上皆可），不再需要 FLASH_4M 變體。
- 八線 PSRAM 的 S3 板（T-Display S3、XIAO ESP32S3）要用 `-octal` 版，否則 PSRAM 不會啟用（程式仍可跑，但記憶體只有內建 SRAM）。
- ESP32-S2 沒有 BLE；C3／C6 是 RISC-V，`_thread` 模組在 C3 可用、效能較低。
- 舊 ESP32（WROOM）與 T-Display v1.1 用 CP2104／CH9102 UART 晶片，瀏覽器可自動進下載模式，**不必按 BOOT**；原生 USB 的板（S2、S3、C3、C6）跑著程式時要按住 BOOT 再按 RST。
