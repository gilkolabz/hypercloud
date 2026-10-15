/**
 * Regenerate src/embedded_hosting.ts = src/index.ts + hostparkinator_5000 plant
 * (B_native_mods/hostparkinator_5000.js embedded as a string literal).
 * index.ts is the source of truth; never hand-edit embedded_hosting.ts.
 *   node navi_shell/_sync_embed_hostparkinator_5000.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostPath = path.join(__dirname, "..", "B_native_mods", "hostparkinator_5000.js");
const indexPath = path.join(__dirname, "src", "index.ts");
const embPath = path.join(__dirname, "src", "embedded_hosting.ts");

const host = fs.readFileSync(hostPath, "utf8");
let src = fs.readFileSync(indexPath, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";

const inject = (anchor, text, where) => {
  const at = src.indexOf(anchor);
  if (at < 0 || src.indexOf(anchor, at + 1) >= 0) {
    throw new Error(`anchor not unique in index.ts: ${anchor.trim()}`);
  }
  const pos = where === "after" ? at + anchor.length : at;
  src = src.slice(0, pos) + text.split("\n").join(eol) + src.slice(pos);
};

inject(
  "            this.callout('[navi] Surf module planted as tip+bin (surf)');",
  "\n            const hostparkinatorModuleCode = \"" +
    JSON.stringify(host).slice(1, -1) +
    "\";\n            await this.plantHostparkinatorModuleBin(hostparkinatorModuleCode);" +
    "\n            this.callout('[navi] hostparkinator_5000 planted as tip+bin (navi:hostparkinator_5000)');",
  "after"
);

inject(
  "    /** Put surf source in bins store",
  `    /** Plant hostparkinator_5000.js as navi:hostparkinator_5000 tip+bin (embedded at build time). */
    private async plantHostparkinatorModuleBin(moduleCode: string): Promise<void> {
        const trimmed = String(moduleCode ?? '').trim();
        if (!trimmed) {
            throw new Error('[navi] hostparkinator_5000 module string is empty');
        }
        const ib = moduleParkIb('hostparkinator_5000');
        const sha = await this.sha256Hex(trimmed);
        const ref = \`bin \${sha}\`;
        const tip = await this.getTip(ib);
        const current = Array.isArray(tip?.rel8ns?.bin) ? tip.rel8ns!.bin[0] : null;
        const subject = tip?.data?.module?.subject_seed;
        if (current === ref && subject === ref) {
            return;
        }
        await this.plantModulePark({
            name: 'hostparkinator_5000',
            media: trimmed,
            mime: 'application/navi-module',
        });
    }

`,
  "before"
);

fs.writeFileSync(embPath, src);
const ver = /version:\s*"([^"]+)"/.exec(host)?.[1] || "?";
console.log(`embedded_hosting.ts ← index.ts + hostparkinator_5000 v${ver} (${host.length} chars)`);
