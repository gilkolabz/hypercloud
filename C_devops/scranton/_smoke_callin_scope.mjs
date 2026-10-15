/**
 * Live smoke: overlapping callins must each see their own navi.callinRequest.
 * Boots a throwaway native navi (temp HOME) from a build, mounts a probe mod,
 * fires relay + local callins at once, and checks viaRelay before/after awaits.
 *   node C_devops/scranton/_smoke_callin_scope.mjs [path/to/navi_shell_host_localnavi.cjs]
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD = path.resolve(process.argv[2] || path.join(ROOT, "navi_shell/dist/navi_shell_host_localnavi.cjs"));

const PROBE = `export const register = (navi) => ({
  name: "raceprobe",
  version: "0.0.1",
  commands: {
    raceprobe: {
      name: "raceprobe",
      methods: ["GET", "POST"],
      execute: async (...args) => {
        if (args[0] === "hit") {
          const start = !!navi.callinRequest?.viaRelay;
          await new Promise((r) => setTimeout(r, Number(args[2] || 0)));
          const after = !!navi.callinRequest?.viaRelay;
          return args[1] + "|" + start + "|" + after + "|" + (navi.callinRequest?.path || "-");
        }
        const jobs = [];
        for (let i = 0; i < 30; i++) {
          const relay = i % 2 === 0;
          jobs.push(
            navi
              .callin({ path: "raceprobe/hit/" + (relay ? "R" : "L") + i + "/" + ((i * 7) % 23), method: "POST", viaRelay: relay })
              .then((r) => String(r?.media ?? r), (e) => "ERR " + e.message)
          );
        }
        const res = await Promise.all(jobs);
        const bad = res.filter((r) => {
          const [tag, start, after] = r.split("|");
          const want = String(tag?.[0] === "R");
          return start !== want || after !== want;
        });
        return "RACE RESULT bad=" + bad.length + "/" + res.length + (bad.length ? " e.g. " + bad.slice(0, 4).join(" ") : "");
      },
    },
  },
  onMount: () => navi.relayWhitelist?.add("raceprobe", ["raceprobe"]),
});
`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/javascript" });
  res.end(PROBE);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const home = fs.mkdtempSync(path.join(os.tmpdir(), "navi-scope-"));
const child = spawn(process.execPath, [BUILD], {
  cwd: home,
  env: { ...process.env, HOME: home, USERPROFILE: home },
  stdio: ["pipe", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (re, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = out.match(re);
    if (m) return m;
    await sleep(200);
  }
  return null;
};

let code = 1;
try {
  await sleep(6000);
  child.stdin.write(`mount http://127.0.0.1:${port}/raceprobe.js\n`);
  await waitFor(/raceprobe/i, 15000);
  await sleep(1500);
  child.stdin.write("raceprobe go\n");
  const m = await waitFor(/RACE RESULT bad=(\d+)\/(\d+)[^\n]*/, 30000);
  if (!m) {
    console.log("no result; tail:\n" + out.slice(-1500));
  } else {
    console.log(m[0]);
    code = m[1] === "0" ? 0 : 2;
  }
} finally {
  child.kill();
  server.close();
  await sleep(500);
  fs.rmSync(home, { recursive: true, force: true });
}
console.log(code === 0 ? "CALLIN SCOPE SMOKE PASS" : "CALLIN SCOPE SMOKE FAIL");
process.exit(code);
