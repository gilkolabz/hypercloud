/**
 * Offline check of the testkit/surfroster/<part> assets: one source renders four parks,
 * each stamped with its part and data-path, carrying about + rel8 to its defining frames.
 *
 *   node C_devops/scranton/_smoke_surfroster_parts.mjs
 */
import assert from "node:assert/strict";
import { buildShellFrame, readAssetBytes, resolvePublishSelection } from "../identity/_lib.mjs";

const want = ["posts", "comments", "stagedirections", "links"];
const { assets } = resolvePublishSelection(["scranton_lobby_v1_surfroster_part"], "torus");
assert.deepEqual(assets.map((a) => a.ib), want.map((p) => `testkit/surfroster/${p}`));

const scripts = new Set();
for (const a of assets) {
  const html = readAssetBytes(a).toString("utf8");
  const part = a.ib.split("/").pop();
  assert.ok(!html.includes("__PART__"), `${a.ib}: placeholder left`);
  assert.match(html, new RegExp(`data-path="${a.ib}"`));
  assert.match(html, new RegExp(`data-surfroster-part="${part}"`));
  const js = html.split("<script>")[1].split("</script>")[0];
  new Function(js);
  scripts.add(js);
  assert.equal(a.about.part, part);
  assert.deepEqual(Object.keys(a.rel8), ["scranton.frame", "scranton.schema", "scranton.policy"], `${a.ib}: rel8 names frames only`);
  for (const [k, ibs] of Object.entries(a.rel8)) {
    assert.equal(ibs.length, 1, `${a.ib}: one ${k}`);
    assert.match(ibs[0], /^scranton\//, `${a.ib}: ${k} is a scranton frame`);
  }
  assert.ok(!/surfroster_stage_member|surfroster_navi_script/.test(html), `${a.ib}: names no mod`);
  const frame = buildShellFrame(a, Buffer.from(html), { rel8ns: { "scranton.frame": ["scranton/x^X"] } });
  assert.equal(frame.data.about.part, part);
  assert.deepEqual(frame.rel8ns["scranton.frame"], ["scranton/x^X"]);
  console.log(`ok ${a.ib}  ${Object.entries(a.rel8).map(([k, v]) => `${k}:${v.length}`).join(" ")}`);
}
assert.equal(scripts.size, 1, "every part runs the same script");
console.log("SURFROSTER PARTS SMOKE PASS");
