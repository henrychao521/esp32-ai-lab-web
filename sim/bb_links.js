// bb_links.js — 範例／存檔的麵包板導通：同一直排／電源軌的孔相通、元件插孔（snaps）接到孔。
// 和 sim.js 的 breadboardLinks() 相同，給 Node 測試與匯出工具用（2026-11-08 範例改成元件插麵包板後，網路表一定要算這個）。
import { BREADBOARD } from "./breadboard.js";
export function breadboardLinks(doc) {
  const links = []; if (!doc.breadboard) return links;
  for (const ids of Object.values(BREADBOARD.strips)) for (let i = 1; i < ids.length; i++) links.push(["bb:" + ids[0], "bb:" + ids[i]]);
  for (const [id, p] of Object.entries(doc.parts || {})) for (const [pin, hole] of Object.entries(p.snaps || {})) links.push([id + ":" + pin, "bb:" + hole]);
  return links;
}
