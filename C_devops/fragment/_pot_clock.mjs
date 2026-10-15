import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putSystems, TOKEN_FILE } from "../../hypernetizen/warez/_fp.mjs";
import { rewriteHtmlDataPath } from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CLOCK_ROUTES = ["torus/testkit/clock", "testkit/clock"];
const CLOCK_HTML = path.join(__dirname, "navi_clock.html");

const SCHEMAS = [
  {
    routes: [
      "torus/testkit/clock/schema/am",
      "testkit/clock/schema/am",
    ],
    file: path.join(__dirname, "clock_schema_am.json"),
  },
  {
    routes: [
      "torus/testkit/clock/schema/pm",
      "testkit/clock/schema/pm",
    ],
    file: path.join(__dirname, "clock_schema_pm.json"),
  },
  {
    routes: [
      "torus/testkit/clock/schema/24h",
      "testkit/clock/schema/24h",
    ],
    file: path.join(__dirname, "clock_schema_24h.json"),
  },
];

const PASSWORD =
  process.env.FLOWERPOT_PASSWORD ||
  "0f8fe7d4949c53add2dc74905e5611ed3b207a668aa57ce3fed9745b5c67a897";

let store = { "spare tokens": [] };
try {
  store = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8").replace(/^\uFEFF/, ""));
} catch {
  /* empty */
}
const need = CLOCK_ROUTES.length + SCHEMAS.reduce((n, s) => n + s.routes.length, 0);
if ((store["spare tokens"] || []).length < need) {
  const res = await fetch("https://foobarch.net/flowerpot/_flowerpot/tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flowerpot-Usage-Password": PASSWORD,
    },
    body: JSON.stringify({ count: Math.max(8, need) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  store["spare tokens"] = [
    ...JSON.parse(text).tokens,
    ...(store["spare tokens"] || []),
  ];
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2) + "\n");
}

const rawHtml = fs.readFileSync(CLOCK_HTML, "utf8");
for (const route of CLOCK_ROUTES) {
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

for (const sch of SCHEMAS) {
  const bytes = fs.readFileSync(sch.file);
  for (const route of sch.routes) {
    const addr = await putSystems(
      route,
      bytes,
      "application/json; charset=utf-8"
    );
    console.log(`${route} → ${addr}`);
  }
}
