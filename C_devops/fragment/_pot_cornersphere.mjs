import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putSystems, TOKEN_FILE } from "../../hypernetizen/warez/_fp.mjs";
import { rewriteHtmlDataPath } from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES = ["torus/testkit/cornersphere", "testkit/cornersphere"];
const LOCAL = path.join(__dirname, "navi_cornersphere.html");

const PASSWORD =
  process.env.FLOWERPOT_PASSWORD ||
  "0f8fe7d4949c53add2dc74905e5611ed3b207a668aa57ce3fed9745b5c67a897";

let store = { "spare tokens": [] };
try {
  store = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8").replace(/^\uFEFF/, ""));
} catch {
  /* empty */
}
if ((store["spare tokens"] || []).length < 2) {
  const res = await fetch("https://foobarch.net/flowerpot/_flowerpot/tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flowerpot-Usage-Password": PASSWORD,
    },
    body: JSON.stringify({ count: 4 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  store["spare tokens"] = [
    ...JSON.parse(text).tokens,
    ...(store["spare tokens"] || []),
  ];
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2) + "\n");
}

const raw = fs.readFileSync(LOCAL, "utf8");
for (const route of ROUTES) {
  const html = rewriteHtmlDataPath(Buffer.from(raw, "utf8"), route).toString("utf8");
  const addr = await putSystems(
    route,
    Buffer.from(html, "utf8"),
    "text/html; charset=utf-8"
  );
  console.log(`${route} → ${addr}`);
}
