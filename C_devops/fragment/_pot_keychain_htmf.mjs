/**
 * Flowerpot the keychain control HTMF.
 *
 *   node C_devops/fragment/_pot_keychain_htmf.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putSystems, TOKEN_FILE } from "../../hypernetizen/warez/_fp.mjs";
import { rewriteHtmlDataPath } from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = ["hypercloud/testkit/htmf/keychain", "testkit/keychain"];
const HTML = path.join(__dirname, "navi_keychain.html");

const PASSWORD =
  process.env.FLOWERPOT_PASSWORD ||
  "0f8fe7d4949c53add2dc74905e5611ed3b207a668aa57ce3fed9745b5c67a897";

let store = { "spare tokens": [] };
try {
  store = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8").replace(/^\uFEFF/, ""));
} catch {
  /* empty */
}
if ((store["spare tokens"] || []).length < ROUTES.length) {
  const res = await fetch("https://foobarch.net/flowerpot/_flowerpot/tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flowerpot-Usage-Password": PASSWORD,
    },
    body: JSON.stringify({ count: Math.max(4, ROUTES.length) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  store["spare tokens"] = [
    ...JSON.parse(text).tokens,
    ...(store["spare tokens"] || []),
  ];
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2) + "\n");
}

const rawHtml = fs.readFileSync(HTML, "utf8");
for (const route of ROUTES) {
  const html = rewriteHtmlDataPath(Buffer.from(rawHtml, "utf8"), route).toString(
    "utf8"
  );
  const addr = await putSystems(
    route,
    Buffer.from(html, "utf8"),
    "text/html; charset=utf-8"
  );
  console.log(`${route} → ${addr}`);
}
