# sim/vendor 第三方來源

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| wokwi-elements.bundle.min.js | npm `@wokwi/elements`（自含 lit，IIFE，載入後註冊 `<wokwi-*>` 自訂元素，全域 `elements`） | 1.9.2 | MIT（LICENSE-wokwi-elements.txt；內含 lit 的 BSD-3） |

取得：`npm pack @wokwi/elements@1.9.2` → dist/wokwi-elements.bundle.min.js。離線可用，不依賴 CDN。
pinInfo 的 x、y 是元素渲染尺寸的 CSS px（元素 SVG 以 mm 標示寬高，96 dpi 換算）。
