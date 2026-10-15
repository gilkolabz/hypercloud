/**
 * Fresh localnavi (temp HOME) → relay connect foobarch.net, advertise a throwaway alias,
 * set a per-alias token, then call it with no / wrong / right token. Retires the alias after.
 *   node navi_shell/_check_alias_tokens.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "navi_alias_tok_"));
const alias = `agent_aliastok_${Math.random().toString(36).slice(2, 8)}`;
const base = "https://foobarch.net";
const p = spawn(process.execPath, [path.join(here, "dist", "navi_shell_host_localnavi.cjs")], {
  env: { ...process.env, HOME: home, USERPROFILE: home },
  stdio: ["pipe", "pipe", "pipe"],
});
let out = "";
p.stdout.on("data", (d) => (out += d));
p.stderr.on("data", (d) => (out += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = async (line, ms) => {
  p.stdin.write(line + "\n");
  await sleep(ms);
};
const call = async (token) => {
  const res = await fetch(`${base}/navi-${alias}/`, {
    headers: { "X-Navi-Shell-Wait": "1", ...(token ? { "X-Navi-Shell-Usage-Token": token } : {}) },
  });
  return { status: res.status, text: (await res.text()).slice(0, 160) };
};

let ok = false;
try {
  await sleep(10000);
  await send("relay connect -", 6000);
  await send(`relay advertise ${alias} 600`, 6000);
  const open = await call("");
  await send(`relay alias-token ${alias} new`, 8000);
  const token = out.match(new RegExp(`${alias}: alias token set → (\\S+)`))?.[1] || "";
  const none = await call("");
  const bad = await call("wrong-token");
  const good = await call(token);
  await send(`relay alias-token ${alias} clear`, 8000);
  const reopened = await call("");
  console.log({ open: open.status, none: none.status, bad: bad.status, good: good.status, reopened: reopened.status });
  console.log("none body:", none.text);
  console.log("good body:", good.text);
  ok =
    open.status === 200 &&
    !!token &&
    none.status === 401 &&
    bad.status === 401 &&
    good.status === 200 &&
    /"ping":true/.test(good.text) &&
    reopened.status === 200;
} finally {
  await send(`relay retire ${alias}`, 5000);
  p.stdin.write("exit\n");
  await sleep(1500);
  p.kill();
  fs.rmSync(home, { recursive: true, force: true });
}
console.log(out.split("\n").filter((l) => /alias token|advertised|retired|Error/i.test(l)).slice(-8).join("\n"));
console.log(ok ? "\nALIAS TOKEN E2E PASS" : "\nALIAS TOKEN E2E FAIL");
process.exit(ok ? 0 : 1);
