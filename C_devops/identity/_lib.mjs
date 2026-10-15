/**
 * Shared foobarch_host shell-tip builders for C_devops/identity.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  generateKeyPair,
  publicKeyHash,
  signWrite,
  buildSignHeaders,
} from "../../flowerpot_v2/src/client/keys.mjs";
import {
  FLOW_MODEL_HTMF_ASSETS,
} from "../flow-model-docs/_catalog.mjs";
import { ECOSYSTEM_HTMF_ASSETS } from "../htmf-ecosystem/_catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const IDENTITY_DIR = __dirname;
export const ROOT = path.resolve(__dirname, "../..");
export const OWNER_PATH = path.join(__dirname, "foobarch_owner.json");
export const PUBLIC_PATH = path.join(__dirname, "foobarch_public.json");
export const POLICY_IB = "policies/foobarch-shell";
export const SCHEMA_IB = "foobarch.schema.keys.v1";
export const SCHEMA_CONTENT_TYPE = "text/x-lua";
export const DEFAULT_HOST = "http://localhost:5353";
export const DEFAULT_STATIC = path.join(ROOT, "foobarch", "static");
export const DEFAULT_USAGE_PASSWORD = process.env.FOOBARCH_USAGE_PASSWORD || "";
export const PROD_HOST = "https://foobarch.net";
/** Local usage-token reserve, keyed by host origin. Filled by _mint_token_reserve.mjs. */
export const TOKEN_RESERVE_PATH =
  process.env.FOOBARCH_TOKEN_RESERVE ||
  path.join(ROOT, "C_devops", "identity", "foobarch_token_reserve.json");

const normalizeHostKey = (base) => String(base || "").trim().replace(/\/+$/, "");

export function readTokenReserve() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_RESERVE_PATH, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

export function writeTokenReserve(reserve) {
  fs.writeFileSync(TOKEN_RESERVE_PATH, JSON.stringify(reserve, null, 2) + "\n");
}

export function tokenReserveCount(base = PROD_HOST) {
  const q = readTokenReserve()[normalizeHostKey(base)];
  return Array.isArray(q) ? q.length : 0;
}

/** Spend one reserved usage token for `base`; null when that host has no reserve. */
export function takeReservedToken(base = PROD_HOST) {
  const key = normalizeHostKey(base);
  const reserve = readTokenReserve();
  const q = Array.isArray(reserve[key]) ? reserve[key] : null;
  if (!q) return null;
  const token = q.shift();
  if (!token) {
    throw new Error(
      `token reserve for ${key} is empty — run: node C_devops/identity/_mint_token_reserve.mjs`
    );
  }
  writeTokenReserve(reserve);
  return token;
}

/** Put an unspent token back (e.g. the write never reached the host). */
export function returnReservedToken(base, token) {
  if (!token) return;
  const key = normalizeHostKey(base);
  const reserve = readTokenReserve();
  (reserve[key] ||= []).unshift(token);
  writeTokenReserve(reserve);
}

/**
 * Usage token for a write to `base`. Prod (or any host with a reserve) spends
 * from the local reserve; other hosts mint with the usage password.
 */
export async function takeUsageToken(base, password = DEFAULT_USAGE_PASSWORD) {
  const key = normalizeHostKey(base);
  const reserved = takeReservedToken(key);
  if (reserved) return reserved;
  if (key === PROD_HOST) {
    throw new Error(
      `no token reserve for ${PROD_HOST} — run: node C_devops/identity/_mint_token_reserve.mjs`
    );
  }
  const res = await fetch(`${key}/foobarch/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Foobarch-Usage-Password": password,
    },
    body: JSON.stringify({ count: 1 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint tokens → ${res.status}: ${text.slice(0, 300)}`);
  const token = JSON.parse(text).tokens?.[0];
  if (!token) throw new Error("mint returned no tokens");
  return token;
}

/**
 * Named write-gate identities under C_devops/identity/.
 * Shared stock schema tip; each identity has its own owner key + policy ib.
 */
export function listIdentities() {
  return ["foobarch", "hypertext", "torus", "hypernetizen"];
}

/**
 * @param {string} [name]
 */
export function getIdentity(name = "foobarch") {
  const id = String(name || "foobarch").trim().toLowerCase() || "foobarch";
  if (id === "foobarch" || id === "shell" || id === "default") {
    return {
      id: "foobarch",
      nickname: "foobarch",
      purpose: "Write-gate publisher for foobarch_host root shell tips",
      ownerPath: OWNER_PATH,
      publicPath: PUBLIC_PATH,
      policyIb: POLICY_IB,
      assets: ASSETS,
      proxies: PROXY_TIPS,
      /** Lock shared schema tip under this policy (shell owns schema). */
      lockSchema: true,
      note: "Write-gate for foobarch_host shell tips — PRIVATE KEY, gitignored.",
    };
  }
  if (id === "hypertext" || id === "ht") {
    const dir = path.join(__dirname, "hypertext");
    return {
      id: "hypertext",
      nickname: "hypertext",
      purpose: "Write-gate publisher for hypertext/* fragment tips",
      ownerPath: path.join(dir, "owner.json"),
      publicPath: path.join(dir, "public.json"),
      policyIb: "policies/hypertext",
      assets: HYPERTEXT_ASSETS,
      proxies: [],
      /** Schema already locked by foobarch identity — only link it. */
      lockSchema: false,
      note: "Write-gate for hypertext/* tips — PRIVATE KEY, gitignored.",
    };
  }
  if (id === "torus" || id === "testkit") {
    const dir = path.join(__dirname, "torus");
    return {
      id: "torus",
      nickname: "torus",
      purpose: "Write-gate publisher for torus/testkit/* HTMF tips",
      ownerPath: path.join(dir, "owner.json"),
      publicPath: path.join(dir, "public.json"),
      policyIb: "policies/torus",
      assets: [...TORUS_ASSETS, ...FLOW_MODEL_HTMF_ASSETS, ...ECOSYSTEM_HTMF_ASSETS],
      proxies: [],
      lockSchema: false,
      note: "Write-gate for torus/testkit/* tips — PRIVATE KEY, gitignored.",
    };
  }
  if (id === "hypernetizen" || id === "warez") {
    const dir = path.join(__dirname, "hypernetizen");
    return {
      id: "hypernetizen",
      nickname: "hypernetizen",
      purpose: "Write-gate publisher for the hypernetizen/warez hostpark index",
      ownerPath: path.join(dir, "owner.json"),
      publicPath: path.join(dir, "public.json"),
      policyIb: "policies/hypernetizen",
      assets: [],
      proxies: [],
      lockSchema: false,
      /** Same key as the warez attester, so index writes stay hypernetizen-signed. */
      seedOwnerPath: path.join(ROOT, "hypernetizen", "hypernetizen_owner.json"),
      note: "Write-gate for hypernetizen/warez — PRIVATE KEY, gitignored.",
    };
  }
  throw new Error(
    `unknown identity '${name}' — known: ${listIdentities().join(", ")}`
  );
}

/** Keep in sync with B_native_mods/hostparkinator_5000/schemas/keys_v1.lua */
export const KEYS_V1_LUA = `-- foobarch.schema.keys.v1
-- m-of-n ed25519 write authorization (client-generated keys).
-- Policy instance data: { threshold = n, keys = { "x1", "x2", ... } }
-- ctx is provided by foobarch_host; flowerpot.* / foobarch.* are host builtins.

function authorize()
  local keys = ctx.policy.keys
  local threshold = ctx.policy.threshold
  if type(keys) ~= "table" or #keys < 1 then
    return { allow = false, aside_ok = true, error = "policy.keys required" }
  end
  if type(threshold) ~= "number" or threshold < 1 then
    threshold = #keys
  end
  if threshold > #keys then
    return { allow = false, aside_ok = false, error = "invalid threshold" }
  end

  local sign_keys = ctx.sign_keys or {}
  local signatures = ctx.signatures or {}
  local used = {}
  local valid = 0
  local n = math.min(#sign_keys, #signatures)
  local verify = (foobarch and foobarch.verify_ed25519)
    or (flowerpot and flowerpot.verify_ed25519)

  for i = 1, n do
    local pub = sign_keys[i]
    local sig = signatures[i]
    if pub and sig and not used[pub] then
      local listed = false
      for _, k in ipairs(keys) do
        if k == pub then
          listed = true
          break
        end
      end
      if listed and verify(pub, ctx.message, sig) then
        used[pub] = true
        valid = valid + 1
      end
    end
  end

  if valid >= threshold then
    return { allow = true }
  end
  return {
    allow = false,
    aside_ok = true,
    error = "keys threshold not met",
    valid = valid,
    threshold = threshold,
  }
end
`;

export const ASSETS = [
  {
    ib: "navi_shell.js",
    path: "navi_shell/dist/navi_shell.js",
    content_type: "application/javascript; charset=utf-8",
  },
  {
    ib: "navi_shell.exe",
    path: "navi_shell/navi_shell.exe",
    content_type: "application/vnd.microsoft.portable-executable",
  },
  {
    ib: "sw.js",
    file: "sw.js",
    content_type: "application/javascript; charset=utf-8",
  },
  {
    ib: "favicon.ico",
    file: "favicon.ico",
    content_type: "image/x-icon",
  },
  {
    ib: "manifest.json/icon-192.png",
    file: "icon-192.png",
    content_type: "image/png",
  },
  {
    ib: "manifest.json/icon-512.png",
    file: "icon-512.png",
    content_type: "image/png",
  },
  {
    ib: "humans.txt",
    file: "humans.txt",
    content_type: "text/plain; charset=utf-8",
  },
  {
    ib: "robots.txt",
    file: "robots.txt",
    content_type: "text/plain; charset=utf-8",
  },
  {
    ib: "security.txt",
    file: "security.txt",
    content_type: "text/plain; charset=utf-8",
  },
  {
    ib: "manifest.json",
    file: "manifest.json",
    content_type: "application/manifest+json; charset=utf-8",
  },
  {
    ib: "scripts/ua_get",
    path: "C_devops/identity/scripts/ua_get.lua",
    content_type: "text/x-lua; charset=utf-8",
    gate: true,
  },
  {
    ib: "readme/scripts/ua_get",
    path: "C_devops/identity/readme/scripts/ua_get.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "scripts/ua_get/readme",
    path: "C_devops/identity/readme/scripts/ua_get.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "scripts/hypertext/hypernetizenwarez_text",
    path: "C_devops/identity/scripts/hypertext/hypernetizenwarez_text.lua",
    content_type: "text/x-lua; charset=utf-8",
    gate: true,
  },
  {
    ib: "foobarch.schema.policy_and.v1",
    path: "C_devops/identity/schemas/policy_and_v1.lua",
    content_type: "text/x-lua; charset=utf-8",
    gate: true,
  },
  // torus/text/spawn/* — B_fragments HTML (ib without .html, like /enter)
  {
    ib: "stash_58016",
    path: "B_fragments/data/stash_58016.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    /** Republish must not drop data.foobarch.tokens on this reserve tip. */
    keepReserve: true,
  },
  {
    ib: "torus/text/spawn/enter",
    path: "B_fragments/data/enter.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/welcome",
    path: "B_fragments/data/welcome.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/bulletinboard",
    path: "B_fragments/data/bulletinboard.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/flowerpot_faq",
    path: "B_fragments/data/flowerpot_faq.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/gadgets",
    path: "B_fragments/data/gadgets.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/hypernetizenwarez",
    path: "B_fragments/data/hypernetizenwarez.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/skellyrelay",
    path: "B_fragments/data/skellyrelay.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/intro",
    path: "B_fragments/data/intro.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/phonebooth",
    path: "B_fragments/data/phonebooth.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/pages/caniuseflowerpothere",
    path: "B_fragments/data/pages/caniuseflowerpothere.html",
    content_type: "text/html; charset=utf-8",
  },
  {
    ib: "torus/text/spawn/pages/whatisflowerpot",
    path: "B_fragments/data/pages/whatisflowerpot.html",
    content_type: "text/html; charset=utf-8",
  },
];

/**
 * hypertext/* — same fragments as spawn, under hypertext/ (pages under flowerpot_faq/).
 */
export const HYPERTEXT_ASSETS = [
  {
    ib: "hypertext/enter",
    path: "B_fragments/data/enter.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/welcome",
    path: "B_fragments/data/welcome.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/bulletinboard",
    path: "B_fragments/data/bulletinboard.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/flowerpot_faq",
    path: "B_fragments/data/flowerpot_faq.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/gadgets",
    path: "B_fragments/data/gadgets.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/hypernetizenwarez",
    path: "B_fragments/data/hypernetizenwarez.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/skellyrelay",
    path: "B_fragments/data/skellyrelay.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/intro",
    path: "B_fragments/data/intro.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/phonebooth",
    path: "B_fragments/data/phonebooth.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/flowerpot_faq/pages/caniuseflowerpothere.html",
    path: "B_fragments/data/pages/caniuseflowerpothere.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "hypertext/flowerpot_faq/pages/whatisflowerpot.html",
    path: "B_fragments/data/pages/whatisflowerpot.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
];

/**
 * torus/testkit/* HTMFs from C_devops/fragment/. Local files keep
 * data-path="torus/testkit/<leaf>". After you edit an HTMF and publish
 * torus testkit, also land it on the short parks:
 *
 *   1. Keep the torus/testkit/<leaf> asset (gate: true).
 *   2. Clone it: same `path`, ib "testkit/<leaf>", gate: true,
 *      rewrite_data_path: true. That flag rewrites data-path to the
 *      clone ib in memory — do not edit the local HTML for the clone.
 *   3. FOOBARCH_HOST=https://foobarch.net
 *      node C_devops/identity/_publish.mjs --yes --identity torus
 *
 * New gadget: add both rows, or the short park will stay stale / missing.
 */
export const TORUS_ASSETS = [
  {
    ib: "torus/linux/navi_shell-linux-x64",
    path: "navi_shell/navi_shell-linux-x64",
    content_type: "application/octet-stream",
  },
  {
    ib: "torus/linux/navi_shell_localnavi.cjs",
    path: "navi_shell/dist/navi_shell_localnavi.cjs",
    content_type: "application/javascript; charset=utf-8",
  },
  {
    ib: "torus/linux/navi_shell_host_localnavi.cjs",
    path: "navi_shell/dist/navi_shell_host_localnavi.cjs",
    content_type: "application/javascript; charset=utf-8",
  },
  {
    ib: "torus/linux/navi_shell.sh",
    path: "C_devops/identity/linux/navi_shell.sh",
    content_type: "text/x-shellscript; charset=utf-8",
  },
  {
    ib: "torus/scripts/stagemods",
    path: "C_devops/scripts/stagemods.txt",
    content_type: "text/plain; charset=utf-8",
  },
  {
    ib: "torus/scripts/link_phrase",
    path: "C_devops/scripts/link_phrase.txt",
    content_type: "text/plain; charset=utf-8",
    about: {
      label: "link phrase",
      description: "Find an HTMF by data-path, match innerText, wrap it as <a> via parsehtm executeEntry when mounted.",
    },
  },
  {
    ib: "torus/testkit/text_editor",
    path: "C_devops/fragment/navi_text_editor.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/tablemaker",
    path: "C_devops/fragment/navi_tablemaker.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/notemaker",
    path: "C_devops/fragment/navi_notemaker.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/legacy/notemaker_v1",
    path: "C_devops/fragment/navi_notemaker_v1.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/tinyviewport",
    path: "C_devops/fragment/navi_tinyviewport.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/clock",
    path: "C_devops/fragment/navi_clock.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/gmaps-scraper",
    path: "C_devops/fragment/navi_gmaps_scraper.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/clock/schema/am",
    path: "C_devops/fragment/clock_schema_am.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/clock/schema/pm",
    path: "C_devops/fragment/clock_schema_pm.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/clock/schema/24h",
    path: "C_devops/fragment/clock_schema_24h.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/relaytest",
    path: "C_devops/fragment/navi_relaytest.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/meshyrelay",
    path: "C_devops/fragment/navi_meshyrelay.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/storagetest",
    path: "C_devops/fragment/navi_storagetest.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/scripter",
    path: "C_devops/fragment/navi_cli.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/fofum",
    path: "C_devops/fragment/navi_fofum.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/cornersphere",
    path: "C_devops/fragment/navi_cornersphere.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/cornersphere/tips-stage",
    path: "C_devops/fragment/navi_cornersphere_tips_stage.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/nexus-sphere",
    path: "C_devops/fragment/navi_nexus_sphere.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/warezashyperlinks",
    path: "C_devops/fragment/navi_warezashyperlinks.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/mod/fsdevopstracker",
    path: "B_native_mods/fsdevopstracker.js",
    content_type: "application/navi-module",
    gate: true,
  },
  {
    ib: "torus/testkit/mod/fsdevopstracker/readme",
    path: "C_devops/fragment/navi_fsdevopstracker_readme.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/testkit/native/fofum_server",
    path: "B_native_mods/fofum_server.js",
    content_type: "application/navi-module",
    gate: true,
  },
  {
    ib: "torus/native/hostparkinator_5000",
    path: "B_native_mods/hostparkinator_5000.js",
    content_type: "application/navi-module",
    gate: true,
  },
  {
    ib: "torus/native/cursor_sdk",
    path: "B_native_mods/cursor_sdk.js",
    content_type: "application/navi-module",
    gate: true,
  },
  {
    ib: "torus/testkit/mod/scranton_lobby_v1_client",
    path: "B_testkit_mods/scranton_lobby_v1_client.js",
    content_type: "application/navi-module",
    gate: true,
  },
  {
    ib: "torus/host-catalog",
    path: "C_devops/fragment/torus_host_catalog.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "torus/flowerpot-catalog",
    path: "C_devops/fragment/torus_flowerpot_catalog.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
  {
    ib: "testkit/text_editor",
    path: "C_devops/fragment/navi_text_editor.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/tablemaker",
    path: "C_devops/fragment/navi_tablemaker.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/notemaker",
    path: "C_devops/fragment/navi_notemaker.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/keychain",
    path: "C_devops/fragment/navi_keychain.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/surfroster",
    path: "C_devops/scranton/scranton_lobby_v1_surfroster.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  ...surfrosterPartAssets(),
  {
    ib: "testkit/youtube_search",
    path: "C_devops/fragment/navi_youtube_search.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
    about: {
      label: "youtube search",
      description: "Search YouTube with your own Data API key; picking a video copies its embed html and builds a stageable square.",
    },
  },
  {
    ib: "testkit/legacy/notemaker_v1",
    path: "C_devops/fragment/navi_notemaker_v1.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/tinyviewport",
    path: "C_devops/fragment/navi_tinyviewport.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/clock",
    path: "C_devops/fragment/navi_clock.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/gmaps-scraper",
    path: "C_devops/fragment/navi_gmaps_scraper.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/clock/schema/am",
    path: "C_devops/fragment/clock_schema_am.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "testkit/clock/schema/pm",
    path: "C_devops/fragment/clock_schema_pm.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "testkit/clock/schema/24h",
    path: "C_devops/fragment/clock_schema_24h.json",
    content_type: "application/json; charset=utf-8",
    gate: true,
  },
  {
    ib: "testkit/relaytest",
    path: "C_devops/fragment/navi_relaytest.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/meshyrelay",
    path: "C_devops/fragment/navi_meshyrelay.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/storagetest",
    path: "C_devops/fragment/navi_storagetest.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/scripter",
    path: "C_devops/fragment/navi_cli.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/fofum",
    path: "C_devops/fragment/navi_fofum.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/cornersphere",
    path: "C_devops/fragment/navi_cornersphere.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/cornersphere/tips-stage",
    path: "C_devops/fragment/navi_cornersphere_tips_stage.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/nexus-sphere",
    path: "C_devops/fragment/navi_nexus_sphere.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/warezashyperlinks",
    path: "C_devops/fragment/navi_warezashyperlinks.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "testkit/media-explorer",
    path: "C_devops/fragment/navi_media_explorer.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
  },
  {
    ib: "horizon/clear",
    path: "C_devops/fragment/horizon_clear.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
  },
];

export { FLOW_MODEL_HTMF_ASSETS } from "../flow-model-docs/_catalog.mjs";
export { ECOSYSTEM_HTMF_ASSETS } from "../htmf-ecosystem/_catalog.mjs";

/** @deprecated use torus/testkit/mod/fsdevopstracker */
export const FSDEVOPS_LEGACY_IB = "torus/testkit/fsdevopstracker.js";

/** Proxy network_proposals (no bin) — e.g. mimex → xomud.quest/mimex */
export const PROXY_TIPS = [
  {
    ib: "mimex",
    target: "https://xomud.quest/mimex",
    park: "capture",
  },
  {
    ib: "arbiter",
    target: "https://xogilko.online/arbiter",
    park: "capture",
    default_method: "POST",
    methods: ["GET", "POST"],
  },
  {
    ib: "fusion",
    target: "https://xogilko.online/fusion",
    park: "capture",
    default_method: "POST",
    methods: ["GET", "POST"],
  },
  {
    ib: "flowerpot",
    target: "https://xomud.quest/flowerpotv2",
    park: "capture",
    // Upstream flowerpot verbs; foobarch mut8 of this tip / under-park via PATCH commit.
    methods: ["GET", "POST", "PUT", "DELETE"],
    commit_methods: ["PATCH"],
  },
  {
    ib: "devops_feedback_host_v1",
    target: "https://usernet.cloud/devops_feedback_host_v1",
    park: "capture",
  },
  {
    ib: "fofum",
    target: "https://xomud.quest/fofum",
    park: "capture",
    // Identity API: login/validate/prove/logout + admin delete
    methods: ["GET", "POST", "DELETE"],
  },
  {
    ib: "phonebook",
    target: "https://usernet.cloud/phonebook",
    park: "capture",
  },
  {
    ib: "torus_faucet",
    target: "https://usernet.cloud/faucet",
    park: "capture",
  },
];

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim());
}

function saveJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Load or create write-gate owner; always refresh public companion file.
 * @param {string | ReturnType<typeof getIdentity>} [identityOrName]
 */
export function loadOrCreateOwner(identityOrName = "foobarch") {
  const identity =
    typeof identityOrName === "string" || identityOrName == null
      ? getIdentity(identityOrName || "foobarch")
      : identityOrName;
  const ownerPath = identity.ownerPath;
  const publicPath = identity.publicPath;
  fs.mkdirSync(path.dirname(ownerPath), { recursive: true });

  let store;
  if (fs.existsSync(ownerPath)) {
    store = loadJson(ownerPath);
  } else {
    const seeded =
      identity.seedOwnerPath && fs.existsSync(identity.seedOwnerPath)
        ? loadJson(identity.seedOwnerPath).owner
        : null;
    const pair = seeded?.privateKey && seeded?.publicKey ? seeded : generateKeyPair();
    store = {
      created_at: new Date().toISOString(),
      note: identity.note,
      identity: identity.id,
      policy_ib: identity.policyIb,
      schema_ib: SCHEMA_IB,
      owner: {
        publicKey: pair.publicKey,
        privateKey: pair.privateKey,
        hash: publicKeyHash(pair.publicKey),
      },
    };
    saveJson(ownerPath, store);
  }
  if (!store.schema_ib || store.schema_ib === "flowerpot.schema.keys.v1") {
    store.schema_ib = SCHEMA_IB;
  }
  if (!store.policy_ib) store.policy_ib = identity.policyIb;
  if (!store.identity) store.identity = identity.id;
  saveJson(ownerPath, store);
  saveJson(publicPath, {
    nickname: identity.nickname,
    purpose: identity.purpose,
    identity: identity.id,
    policy_ib: identity.policyIb,
    schema_ib: store.schema_ib || SCHEMA_IB,
    public_key: store.owner.publicKey,
    public_key_hash: store.owner.hash,
    created_at: store.created_at,
  });
  return store;
}

export function assetPath(asset, staticDir = DEFAULT_STATIC) {
  if (asset.path) {
    return path.isAbsolute(asset.path)
      ? asset.path
      : path.join(ROOT, asset.path);
  }
  return path.join(staticDir, asset.file);
}

export function readAssetBytes(asset, staticDir = DEFAULT_STATIC) {
  const fp = assetPath(asset, staticDir);
  if (!fs.existsSync(fp)) {
    throw new Error(`missing asset file: ${fp}`);
  }
  let bytes = fs.readFileSync(fp);
  // One source, several parks: __NAME__ → asset.vars.NAME.
  if (asset.vars) {
    let text = bytes.toString("utf8");
    for (const [k, v] of Object.entries(asset.vars)) text = text.split(`__${k}__`).join(String(v));
    bytes = Buffer.from(text, "utf8");
  }
  // Clone parks: rewrite data-path="…" to asset.ib; source file stays as-is.
  if (asset.rewrite_data_path === true) {
    return rewriteHtmlDataPath(bytes, asset.ib);
  }
  return bytes;
}

/**
 * testkit/surfroster/<part>: standalone views of one surfroster section, all from
 * scranton_lobby_v1_surfroster_part.html. `rel8` names the frames whose pattern the part
 * shows; publish pins each to its current tip addr (rel8ns). Readers point at the frames,
 * never the reverse: the frames name no part, and a mod's own park acknowledges the
 * frames it works with (about.acknowledges).
 */
function surfrosterPartAssets() {
  const A = "scranton/affordance/v1";
  const row = (name) => ({
    "scranton.frame": [`${A}/${name}`],
    "scranton.schema": [`${A}/${name}/schema`],
    "scranton.policy": [`${A}/${name}/policy`],
  });
  const parts = [
    {
      part: "posts",
      description: "Posts on the surfed page's scranton lobby, each drawn by whatever affordance claims its post kind.",
      rel8: {
        "scranton.frame": ["scranton/lobby/v1"],
        "scranton.schema": ["scranton/lobby/v1/schema"],
        "scranton.policy": ["scranton/lobby/v1/policy"],
      },
    },
    {
      part: "comments",
      description: "The comments/{page} affordance for the surfed page: read, add, delete your own.",
      rel8: row("comments"),
    },
    {
      part: "stagedirections",
      description: "The stagedir/{page} affordance for the surfed page: shared placements, place one or all.",
      rel8: row("stagedir"),
    },
    {
      part: "links",
      description: "The links/{page} affordance for the surfed page: paths that surf on click.",
      rel8: row("links"),
    },
  ];
  return parts.map((p) => ({
    ib: `testkit/surfroster/${p.part}`,
    path: "C_devops/scranton/scranton_lobby_v1_surfroster_part.html",
    content_type: "text/html; charset=utf-8",
    gate: true,
    rewrite_data_path: true,
    vars: { PART: p.part },
    about: { label: `surfroster · ${p.part}`, description: p.description, part: p.part, part_of: "testkit/surfroster" },
    rel8: p.rel8,
  }));
}

/** In-memory only. Used by testkit/* clones of torus/testkit HTMFs. */
export function rewriteHtmlDataPath(bytes, ib) {
  const pathIb = String(ib || "").trim();
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  // Root stamp only — never global: inline scripts may contain data-path= literals
  // (e.g. tinyviewport rewriteDataPath regex) and paths with / break regex literals.
  const re = /data-path=(["'])[^"']*\1/;
  if (!re.test(text)) return Buffer.from(text, "utf8");
  const next = text.replace(re, `data-path=$1${pathIb}$1`);
  return Buffer.from(next, "utf8");
}

function naviScriptMime(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase() === "application/navi-script";
}

/** GET bin for every shell asset; navi-script parks also POST the bin (navi.script). */
function naviScriptParkMethods(asset) {
  /** @type {Record<string, unknown>} */
  const method = {
    GET: { kind: "bin" },
    PUT: { kind: "commit" },
  };
  if (naviScriptMime(asset?.content_type)) {
    const mode =
      String(asset.script_mode || "js").toLowerCase() === "callin" ? "callin" : "js";
    method.POST = { kind: "bin", script_mode: mode };
  }
  return method;
}

/**
 * Build network_proposal + ibgib_frame tip for a shell bin asset.
 * @param {{ policyAddr?: string|null, parentAddr?: string|null, n?: number, rel8ns?: Record<string, string[]> }} [opts]
 */
export function buildShellFrame(asset, bytes, opts = {}) {
  const sha = sha256Hex(bytes);
  const gib = sha.toUpperCase();
  const n = opts.n != null ? Number(opts.n) : 0;
  /** @type {Record<string, unknown>} */
  const rel8ns = {
    bin: [`bin ${sha}`],
    past: opts.parentAddr ? [String(opts.parentAddr)] : [],
    tjp: [],
    dna: [],
  };
  if (opts.policyAddr) {
    rel8ns.policy = [String(opts.policyAddr)];
  }
  Object.assign(rel8ns, opts.rel8ns || {});
  return {
    ib: asset.ib,
    gib,
    data: {
      parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
      park: "defer",
      ...(asset.gate === true ? { gate: true } : {}),
      ...(asset.about ? { about: asset.about } : {}),
      content_type: asset.content_type,
      default_method: "GET",
      method: naviScriptParkMethods(asset),
      ...(naviScriptMime(asset.content_type)
        ? { script_mode: String(asset.script_mode || "js").toLowerCase() === "callin" ? "callin" : "js" }
        : {}),
      n,
      timestamp: new Date().toUTCString(),
    },
    rel8ns,
  };
}

/**
 * Build a bin-bearing module park tip (provision + verbs).
 * Host GET: Accept application/navi-module → bin bytes;
 * Accept application/navi-mod → multipart/related (eframe + addressed bin);
 * Accept application/eframe alone → tip JSON.
 * @param {{
 *   ib: string,
 *   target: string,
 *   command?: string,
 *   commands?: string[],
 *   about?: Record<string, unknown>,
 *   gate?: boolean,
 * }} asset
 * @param {Buffer|string} bytes
 * @param {{ policyAddr?: string|null, parentAddr?: string|null, n?: number }} [opts]
 */
export function buildModParkFrame(asset, bytes, opts = {}) {
  const sha = sha256Hex(bytes);
  const gib = sha.toUpperCase();
  const n = opts.n != null ? Number(opts.n) : 0;
  const target = String(asset.target || asset.ib || "").trim();
  const command = String(asset.command || target || "").trim();
  const commands = Array.isArray(asset.commands)
    ? asset.commands.map(String).filter(Boolean)
    : [];
  /** @type {Record<string, unknown>} */
  const getCtrl = {
    kind: "mod",
    target,
    command: command || target,
    mode: "async",
  };
  if (commands.length > 1) getCtrl.commands = commands;
  /** @type {Record<string, unknown>} */
  const rel8ns = {
    bin: [`bin ${sha}`],
    past: opts.parentAddr ? [String(opts.parentAddr)] : [],
    tjp: [],
    dna: [],
  };
  if (opts.policyAddr) {
    rel8ns.policy = [String(opts.policyAddr)];
  }
  const about =
    asset.about && typeof asset.about === "object" ? { ...asset.about } : {};
  if (!about.navi_name) about.navi_name = target;
  if (!about.name) about.name = String(asset.ib || target);
  return {
    ib: asset.ib,
    gib,
    data: {
      parts: ["navi_park", "network_proposal", "ibgib_frame", "manifest", "json"],
      park: "capture",
      ...(asset.gate === true ? { gate: true } : {}),
      content_type: "application/navi-module",
      default_method: "GET",
      method: {
        GET: { ...getCtrl },
        POST: { ...getCtrl },
        PUT: { kind: "commit", mode: "async" },
        PATCH: { kind: "commit", mode: "async" },
        DELETE: { kind: "tombstone", mode: "async" },
      },
      module: { name: target },
      about,
      n,
      timestamp: new Date().toUTCString(),
    },
    rel8ns,
  };
}

/**
 * Proxy/redirect park tip (no bin).
 * - kind "proxy" (default): target is absolute URL; host joins target + "/" + remainder.
 * - kind "redirect": target is a route ib; host redispatches internally the same way.
 * @param {{
 *   ib: string,
 *   target: string,
 *   kind?: "proxy" | "redirect",
 *   park?: "capture" | "defer", // default "capture" for proxies
 *   default_method?: string,
 *   methods?: string[],
 *   commit_methods?: string[],
 * }} tip
 * @param {{ policyAddr?: string|null, parentAddr?: string|null, n?: number }} [opts]
 */
export function buildProxyFrame(tip, opts = {}) {
  const n = opts.n != null ? Number(opts.n) : 0;
  const kind = String(tip.kind || "proxy").toLowerCase() === "redirect"
    ? "redirect"
    : "proxy";
  const methods = (tip.methods?.length ? tip.methods : ["GET"]).map((m) =>
    String(m).toUpperCase()
  );
  const commitMethods = (tip.commit_methods || []).map((m) =>
    String(m).toUpperCase()
  );
  /** @type {Record<string, { kind: string, target?: string }>} */
  const method = {};
  // Default: tip remains mut8-able via PUT commit unless PUT is explicitly
  // listed as a proxied/redirected method (e.g. flowerpot gateway).
  if (!methods.includes("PUT") && !commitMethods.includes("PUT")) {
    method.PUT = { kind: "commit" };
  }
  for (const m of methods) {
    method[m] = { kind, target: tip.target };
  }
  for (const m of commitMethods) {
    method[m] = { kind: "commit" };
  }
  const park =
    tip.park === "capture" || tip.park === "defer" ? tip.park : "capture";
  const data = {
    parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
    park,
    default_method: String(tip.default_method || "GET").toUpperCase(),
    method,
    n,
    timestamp: new Date().toUTCString(),
  };
  const gib = sha256Hex(Buffer.from(JSON.stringify(data), "utf8")).toUpperCase();
  /** @type {Record<string, unknown>} */
  const rel8ns = {
    past: opts.parentAddr ? [String(opts.parentAddr)] : [],
    tjp: [],
    dna: [],
  };
  if (opts.policyAddr) {
    rel8ns.policy = [String(opts.policyAddr)];
  }
  return {
    ib: tip.ib,
    gib,
    data,
    rel8ns,
  };
}

/**
 * Lua schema tip (write-gate pattern). Open firstGen; lock later via policy.
 * @param {{ parentAddr?: string|null, policyAddr?: string|null, n?: number, lua?: string }} [opts]
 */
export function buildSchemaFrame(opts = {}) {
  const lua = opts.lua != null ? String(opts.lua) : KEYS_V1_LUA;
  const bytes = Buffer.from(lua, "utf8");
  const sha = sha256Hex(bytes);
  const n = opts.n != null ? Number(opts.n) : 0;
  /** @type {Record<string, unknown>} */
  const rel8ns = {
    bin: [`bin ${sha}`],
    past: opts.parentAddr ? [String(opts.parentAddr)] : [],
    tjp: [],
    dna: [],
  };
  if (opts.policyAddr) {
    rel8ns.policy = [String(opts.policyAddr)];
  }
  const data = {
    parts: ["write_schema", "ibgib_frame", "manifest", "json"],
    content_type: SCHEMA_CONTENT_TYPE,
    schema_kind: "keys_v1",
    default_method: "GET",
    method: {
      GET: { kind: "bin" },
      PUT: { kind: "commit" },
      PATCH: { kind: "commit" },
    },
    n,
    timestamp: new Date().toUTCString(),
  };
  // Gib from frame identity (data+rel8ns), not raw lua alone — mut8 lock must advance.
  const gib = sha256Hex(
    Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")
  ).toUpperCase();
  return {
    ib: SCHEMA_IB,
    gib,
    data,
    rel8ns,
    _luaBytes: bytes,
    _luaSha: sha,
  };
}

/**
 * Keys-policy tip (params for schema). Must link schemaAddr.
 * @param {{
 *   parentAddr?: string|null,
 *   policyAddr?: string|null,
 *   schemaAddr?: string|null,
 *   n?: number,
 *   policyIb?: string,
 * }} [opts]
 */
export function buildPolicyFrame(ownerStore, opts = {}) {
  const publicKey = ownerStore.owner.publicKey;
  const schemaAddr = opts.schemaAddr ? String(opts.schemaAddr) : "";
  const policyIb =
    opts.policyIb ||
    ownerStore.policy_ib ||
    POLICY_IB;
  const body = {
    parts: ["keys_policy", "ibgib_frame", "manifest", "json"],
    schema_ib: SCHEMA_IB,
    threshold: 1,
    keys: [publicKey],
    n: opts.n != null ? Number(opts.n) : 0,
    timestamp: new Date().toUTCString(),
  };
  const gib = sha256Hex(Buffer.from(JSON.stringify(body), "utf8")).toUpperCase();
  /** @type {Record<string, unknown>} */
  const rel8ns = {
    past: opts.parentAddr ? [String(opts.parentAddr)] : [],
    tjp: [],
    dna: [],
  };
  if (schemaAddr) {
    rel8ns.schema = [schemaAddr];
  }
  if (opts.policyAddr) {
    rel8ns.policy = [String(opts.policyAddr)];
  }
  return {
    ib: policyIb,
    gib,
    data: body,
    rel8ns,
  };
}

/**
 * Commit envelope. By default strips bytes_b64 (for shape dumps).
 * @param {{ includeBytes?: boolean, transform?: string }} [opts]
 */
export function buildEnvelope(frame, bytes, contentType, opts = {}) {
  const sha = sha256Hex(bytes);
  const transform =
    opts.transform ||
    (Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past.length
      ? "mut8"
      : "firstGen");
  /** @type {Record<string, unknown>} */
  const bin = {
    sha256: sha,
    content_type: contentType,
    byte_length: bytes.length,
  };
  if (opts.includeBytes) {
    bin.bytes_b64 = bytes.toString("base64");
  } else {
    bin.bytes_b64 = `(omitted — ${bytes.length} bytes; pass --include-bytes)`;
  }
  return {
    transform,
    newIbGib: frame,
    dnas: [],
    intermediateIbGibs: [],
    bin,
  };
}

/** Envelope ready for HTTP PUT (always includes bytes_b64). */
export function buildPutEnvelope(frame, bytes, contentType) {
  const env = buildEnvelope(frame, bytes, contentType, {
    includeBytes: true,
    transform:
      Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past.length
        ? "mut8"
        : "firstGen",
  });
  return env;
}

export function buildPolicyEnvelope(frame, opts = {}) {
  const transform =
    opts.transform ||
    (Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past.length
      ? "mut8"
      : "firstGen");
  return {
    transform,
    newIbGib: frame,
    dnas: [],
    intermediateIbGibs: [],
  };
}

/** Park tip verb controls (`data.method`, or legacy `data.http` for commit-verb lookup). */
export function parkMethodBlock(frame) {
  const method = frame?.data?.method;
  if (method && typeof method === "object" && !Array.isArray(method)) {
    return method;
  }
  const http = frame?.data?.http;
  if (http && typeof http === "object" && !Array.isArray(http)) {
    return http;
  }
  return null;
}

export function needsParkMethodMigrate(frame) {
  const data = frame?.data;
  return !!(
    data?.http &&
    typeof data.http === "object" &&
    !Array.isArray(data.http) &&
    !data?.method
  );
}

export function buildMethodMigratedFrame(tipRow) {
  const frame = tipRow?.frame;
  if (!frame?.ib || !needsParkMethodMigrate(frame)) return null;
  const data = { ...(frame.data && typeof frame.data === "object" ? frame.data : {}) };
  data.method = { ...data.http };
  delete data.http;
  data.n = (Number(data.n) || 0) + 1;
  data.timestamp = new Date().toUTCString();
  const gib = sha256Hex(Buffer.from(JSON.stringify(data), "utf8")).toUpperCase();
  return {
    ib: String(frame.ib),
    gib,
    data,
    rel8ns: {
      ...(frame.rel8ns && typeof frame.rel8ns === "object" ? frame.rel8ns : {}),
      past: tipRow.addr ? [String(tipRow.addr)] : [],
    },
  };
}

/**
 * Resolve preferred park claim from new or legacy fields.
 * @returns {"capture"|"defer"|null} null = omit (not in resolve set)
 */
export function resolveParkClaim(data) {
  const p = data?.park;
  if (typeof p === "string") {
    const s = p.trim().toLowerCase();
    if (s === "capture") return "capture";
    if (s === "defer") return "defer";
  }
  const prec = String(data?.park_precedence || "").toLowerCase();
  const capture = prec === "capture" || !!data?.park_capture;
  if (p === true) return capture ? "capture" : "defer";
  // Legacy capture flags with park omitted — still a resolve claim.
  if (capture) return "capture";
  return null;
}

export function needsParkClaimMigrate(frame) {
  const data = frame?.data;
  if (!data || typeof data !== "object") return false;
  if ("park_depth" in data || "park_precedence" in data || "park_capture" in data) {
    return true;
  }
  if (data.park === true) return true;
  if (typeof data.park === "string") {
    const s = data.park.trim().toLowerCase();
    return s !== "capture" && s !== "defer";
  }
  return false;
}

/**
 * Mut8 shape: park → "capture"|"defer" (or omit), drop park_depth / precedence / capture.
 * Also folds data.http → data.method when that migrate is still pending.
 */
export function buildParkClaimMigratedFrame(tipRow) {
  const frame = tipRow?.frame;
  if (!frame?.ib) return null;
  const needsClaim = needsParkClaimMigrate(frame);
  const needsMethod = needsParkMethodMigrate(frame);
  if (!needsClaim && !needsMethod) return null;

  const data = {
    ...(frame.data && typeof frame.data === "object" ? frame.data : {}),
  };
  if (needsMethod) {
    data.method = { ...data.http };
    delete data.http;
  }

  const claim = resolveParkClaim(data);
  delete data.park_depth;
  delete data.park_precedence;
  delete data.park_capture;
  if (claim) data.park = claim;
  else delete data.park;

  data.n = (Number(data.n) || 0) + 1;
  data.timestamp = new Date().toUTCString();
  const gib = sha256Hex(Buffer.from(JSON.stringify(data), "utf8")).toUpperCase();
  return {
    ib: String(frame.ib),
    gib,
    data,
    rel8ns: {
      ...(frame.rel8ns && typeof frame.rel8ns === "object" ? frame.rel8ns : {}),
      past: tipRow.addr ? [String(tipRow.addr)] : [],
    },
  };
}

export function signHeadersForBody(ownerStore, { ib, parentAddr, body }) {
  const signed = signWrite({
    privateKey: ownerStore.owner.privateKey,
    publicKey: ownerStore.owner.publicKey,
    ib,
    parentAddr: parentAddr || "",
    body,
    contentType: "application/json",
    scheme: "proposal",
  });
  return buildSignHeaders({
    publicKeys: [signed.publicKey],
    signatures: [signed.signature],
  });
}

/** Multi-owner proposal-write signatures (for policy_and schemas). */
export function signHeadersForOwners(ownerStores, { ib, parentAddr, body }) {
  const publicKeys = [];
  const signatures = [];
  for (const ownerStore of ownerStores) {
    if (!ownerStore?.owner?.privateKey) {
      throw new Error("signHeadersForOwners: owner missing privateKey");
    }
    const signed = signWrite({
      privateKey: ownerStore.owner.privateKey,
      publicKey: ownerStore.owner.publicKey,
      ib,
      parentAddr: parentAddr || "",
      body,
      contentType: "application/json",
      scheme: "proposal",
    });
    publicKeys.push(signed.publicKey);
    signatures.push(signed.signature);
  }
  return buildSignHeaders({ publicKeys, signatures });
}

/**
 * @param {string[]} [filterNames]
 * @param {ReturnType<typeof getIdentity> | string} [identityOrName]
 */
export function resolveAssets(filterNames, identityOrName = "foobarch") {
  const identity =
    typeof identityOrName === "string" || identityOrName == null
      ? getIdentity(identityOrName || "foobarch")
      : identityOrName;
  const catalog = identity.assets;
  if (!filterNames?.length) return catalog.slice();
  const set = new Set(filterNames.map(String));
  const out = catalog.filter((a) => assetMatches(a, set));
  if (!out.length) {
    throw new Error(
      `no matching assets for ${filterNames.join(", ")}; known: ${catalog.map((a) => a.ib).join(", ")}`
    );
  }
  return out;
}

function assetMatches(a, set) {
  if (set.has(a.ib) || (a.file && set.has(a.file))) return true;
  if (a.path) {
    const base = path.basename(a.path);
    if (set.has(base) || set.has(base.replace(/\.html?$/i, ""))) return true;
  }
  const leaf = a.ib.split("/").pop();
  if (leaf && set.has(leaf)) return true;
  // allow torus/text/spawn/welcome or spawn/welcome
  for (const s of set) {
    if (a.ib === s || a.ib.endsWith("/" + s) || a.ib.endsWith(s)) return true;
  }
  return false;
}

/**
 * @param {string[]} [filterNames]
 * @param {ReturnType<typeof getIdentity> | string} [identityOrName]
 */
export function resolveProxyTips(filterNames, identityOrName = "foobarch") {
  const identity =
    typeof identityOrName === "string" || identityOrName == null
      ? getIdentity(identityOrName || "foobarch")
      : identityOrName;
  const catalog = identity.proxies;
  if (!filterNames?.length) return catalog.slice();
  const set = new Set(filterNames.map(String));
  return catalog.filter((t) => set.has(t.ib));
}

/**
 * @param {string[]} [filterNames]
 * @param {ReturnType<typeof getIdentity> | string} [identityOrName]
 */
export function resolvePublishSelection(filterNames, identityOrName = "foobarch") {
  const identity =
    typeof identityOrName === "string" || identityOrName == null
      ? getIdentity(identityOrName || "foobarch")
      : identityOrName;
  const catalogA = identity.assets;
  const catalogP = identity.proxies;
  if (!filterNames?.length) {
    return { assets: catalogA.slice(), proxies: catalogP.slice() };
  }
  const set = new Set(filterNames.map(String));
  const assets = catalogA.filter((a) => assetMatches(a, set));
  const proxies = catalogP.filter((t) => set.has(t.ib));
  if (!assets.length && !proxies.length) {
    const known = [
      ...catalogA.map((a) => a.ib),
      ...catalogP.map((t) => t.ib),
    ].join(", ");
    throw new Error(`no matching tips for ${filterNames.join(", ")}; known: ${known}`);
  }
  return { assets, proxies };
}

export { saveJson, loadJson };
