/**
 * Live check: each testkit/surfroster/<part> serves its own HTMF, the main surfroster is
 * unchanged, and every rel8 pin points at a generation of the ib it names.
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_check_surfroster_parts_live.mjs
 */
const base = (process.env.FOOBARCH_HOST || "https://foobarch.net").replace(/\/$/, "");
let bad = 0;
const main = await (await fetch(`${base}/testkit/surfroster`)).text();
console.log(`testkit/surfroster  ${main.includes('name="scranton_lobby_v1_surfroster"') ? "ok" : "WRONG"}`);
for (const part of ["posts", "comments", "stagedirections", "links"]) {
  const ib = `testkit/surfroster/${part}`;
  const html = await (await fetch(`${base}/${ib}`)).text();
  const served = html.includes(`data-surfroster-part="${part}"`);
  const tip = await (await fetch(`${base}/foobarch/tip/${ib}`)).json();
  const pins = Object.entries(tip.frame?.rel8ns || {}).filter(([k]) => k.includes("."));
  const tidy = pins.every(([, addrs]) => addrs.every((a) => /\^[0-9A-F]{64}$/.test(a)));
  if (!served || !tidy || !pins.length) bad += 1;
  console.log(`${ib}  served=${served}  about.part=${tip.frame?.data?.about?.part}`);
  for (const [k, addrs] of pins) console.log(`    ${k}: ${addrs.map((a) => a.slice(0, a.indexOf("^") + 9)).join(", ")}`);
}
if (bad) throw new Error(`${bad} part(s) wrong`);
console.log("SURFROSTER PARTS LIVE OK");
