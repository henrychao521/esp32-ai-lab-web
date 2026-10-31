# sim/vendor 第三方來源

| 檔案 | 來源 | 版本 | 授權 |
|---|---|---|---|
| wokwi-elements.bundle.min.js | npm `@wokwi/elements`（自含 lit，IIFE，載入後註冊 `<wokwi-*>` 自訂元素，全域 `elements`） | 1.9.2 | MIT（LICENSE-wokwi-elements.txt；內含 lit 的 BSD-3） |

取得：`npm pack @wokwi/elements@1.9.2` → dist/wokwi-elements.bundle.min.js。離線可用，不依賴 CDN。
pinInfo 的 x、y 是元素渲染尺寸的 CSS px（元素 SVG 以 mm 標示寬高，96 dpi 換算）。
| codemirror.bundle.js | CodeMirror 6（@codemirror/state 6.7.6、view 6.43.15、language 6.13.1、commands 6.11.1、lang-python 6.2.1、search 6.7.2、autocomplete 6.20.4、lint 6.9.7、theme-one-dark 6.1.3）用 esbuild 打成單一 ESM | 見左 | MIT（LICENSE-codemirror.txt） |
