/**
 * Fresh localnavi (temp HOME) → first-ever callin of a hostpark mod WITH args must keep args.
 *   node navi_shell/_check_host_pin_args.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "navi_pin_check_"));
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

await sleep(10000);
await send("keychain", 6000);
await send("token_distro_endpoint role approver", 8000);
await send("token_distro_endpoint status", 3000);
p.stdin.write("exit\n");
await sleep(1500);
p.kill();
fs.rmSync(home, { recursive: true, force: true });

const roleSet = /role set: approver/.test(out);
const status = /role: approver/.test(out);
console.log(out.split("\n").filter((l) => /token_distro_endpoint|role|error/i.test(l)).slice(-12).join("\n"));
console.log(`\nrole set: ${roleSet}  status approver: ${status}`);
process.exit(roleSet && status ? 0 : 1);
