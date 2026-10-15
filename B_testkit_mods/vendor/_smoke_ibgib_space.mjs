import fs from "fs";
import { pathToFileURL } from "url";

const vendor = fs.readFileSync("B_testkit_mods/vendor/tsgib.min.js", "utf8");
const wrapPath = "B_testkit_mods/vendor/_tmp_wrap.mjs";
fs.writeFileSync(wrapPath, `export default (async () => {\n${vendor}\n})();`);
const w = await import(pathToFileURL(wrapPath).href + "?t=" + Date.now());
await w.default;
fs.unlinkSync(wrapPath);

const store = new Map();
const navi = {
  storage: {
    item: {
      async set(k, v) {
        store.set(k, v);
      },
      async get(k) {
        return store.has(k) ? store.get(k) : null;
      },
      async keys() {
        return [...store.keys()];
      },
    },
  },
};

const mod = await import(
  pathToFileURL("B_testkit_mods/tiny_ibgib_space.js").href + "?t=" + Date.now()
);
const api = mod.register(navi);
await api.onMount();
const created = JSON.parse(
  await api.commands.ibgib.execute("create", "note", '{"text":"hi"}')
);
console.log("create", created.addr);
const got = JSON.parse(await api.commands.ibgib.execute("get", created.addr));
console.log("get data", got.data);
const mut = JSON.parse(
  await api.commands.ibgib.execute("mut8", created.addr, '{"text":"hello"}')
);
console.log("mut8", mut.addr);
const tip = JSON.parse(await api.commands.ibgib.execute("tip", "note"));
console.log("tip", tip.addr, tip.ibGib?.data);
console.log("OK frames", store.size);
