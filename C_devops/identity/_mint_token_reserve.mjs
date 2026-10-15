/**
 * Mint foobarch usage tokens into the local reserve that hostpark scripts spend
 * (C_devops/identity/_lib.mjs takeUsageToken). This is the only script that
 * holds the prod usage password.
 *
 *   node C_devops/identity/_mint_token_reserve.mjs            # top up to 1000
 *   node C_devops/identity/_mint_token_reserve.mjs --add 250  # mint 250 more
 *   node C_devops/identity/_mint_token_reserve.mjs --count    # show reserve size
 *
 * Env: FOOBARCH_HOST (default https://foobarch.net), FOOBARCH_USAGE_PASSWORD,
 *      FOOBARCH_TOKEN_RESERVE (reserve file path)
 */
import {
  PROD_HOST,
  TOKEN_RESERVE_PATH,
  readTokenReserve,
  tokenReserveCount,
  writeTokenReserve,
} from "./_lib.mjs";

const PROD_USAGE_PASSWORD = "764hvSuet30";
const TARGET = 1000;
/** /foobarch/tokens caps each mint at 100. */
const BATCH = 100;

const base = (process.env.FOOBARCH_HOST || PROD_HOST).replace(/\/+$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || (base === PROD_HOST ? PROD_USAGE_PASSWORD : "");
if (!password) throw new Error(`FOOBARCH_USAGE_PASSWORD required for ${base}`);

const args = process.argv.slice(2);
const have = tokenReserveCount(base);
if (args.includes("--count")) {
  console.log(`${base}: ${have} tokens in ${TOKEN_RESERVE_PATH}`);
  process.exit(0);
}
const addIdx = args.indexOf("--add");
const want = addIdx >= 0 ? Math.max(0, Number(args[addIdx + 1]) || 0) : Math.max(0, TARGET - have);
if (!want) {
  console.log(`${base}: reserve already has ${have} tokens (target ${TARGET})`);
  process.exit(0);
}

let minted = 0;
while (minted < want) {
  const count = Math.min(BATCH, want - minted);
  const res = await fetch(`${base}/foobarch/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Foobarch-Usage-Password": password,
    },
    body: JSON.stringify({ count }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint tokens → ${res.status}: ${text.slice(0, 300)}`);
  const tokens = JSON.parse(text).tokens || [];
  if (!tokens.length) throw new Error("mint returned no tokens");
  // Persist every batch so a mid-run failure keeps what was already minted.
  const reserve = readTokenReserve();
  reserve[base] = [...(Array.isArray(reserve[base]) ? reserve[base] : []), ...tokens];
  writeTokenReserve(reserve);
  minted += tokens.length;
}
console.log(`${base}: minted ${minted}, reserve now ${tokenReserveCount(base)} (${TOKEN_RESERVE_PATH})`);
