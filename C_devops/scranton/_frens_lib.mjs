/** <identity>/frens signing (read side: scranton_lobby readFrens). */
import crypto from "node:crypto";

export const FRENS_SIG_PREFIX = "scranton-frens-v1\n";
export const EDITORS_SIG_PREFIX = "scranton-frens-editors-v1\n";

const signText = (owner, text) => {
  const key = crypto.createPrivateKey({
    key: { kty: "OKP", crv: "Ed25519", x: owner.publicKey, d: owner.privateKey },
    format: "jwk",
  });
  return { key: owner.publicKey, sig: crypto.sign(null, Buffer.from(text, "utf8"), key).toString("base64url") };
};

/** ed25519 over FRENS_SIG_PREFIX + JSON(frens) with an owner key { publicKey, privateKey } (jwk x / d). */
export function signFrens(owner, frens) {
  return signText(owner, FRENS_SIG_PREFIX + JSON.stringify(frens));
}

/** data.frens_editors: keys the identity lets edit its list (signed by the identity). */
export function signEditors(owner, identity, editors) {
  return { identity, editors, sig: signText(owner, EDITORS_SIG_PREFIX + JSON.stringify({ identity, editors })) };
}

/** data for an <identity>/frens generation. */
export function frensData(identity, frens, frensSig, n, frensEditors = null) {
  return {
    parts: ["scranton_frens_v1", "ibgib_frame", "manifest", "json"],
    contract: "scranton/affordance/v1/frens",
    about: { label: `${identity} frens`, description: `Keys ${identity} vouches for, and identities it vouches for. Signed by a policies/${identity} key or a named editor.` },
    frens,
    frens_sig: frensSig,
    ...(frensEditors ? { frens_editors: frensEditors } : {}),
    default_method: "GET",
    method: { GET: { kind: "frame" }, PUT: { kind: "commit" }, PATCH: { kind: "commit" } },
    n,
    timestamp: new Date().toUTCString(),
  };
}
