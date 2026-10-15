/**
 * Client-independent ed25519 key helpers (Node).
 *
 * Keys are never minted by Flowerpot. Any JS client can generate the same
 * shape: OKP / Ed25519 JWK (`x` public, `d` private). Browsers can use
 * WebCrypto or @noble/ed25519 and produce the same base64url `x` / signatures.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

export const WRITE_SIGN_PREFIX = 'flowerpot-write-v1';
/** foobarch_host / network_proposal commit envelopes */
export const PROPOSAL_WRITE_PREFIX = 'proposal-write-v1';
export const READ_SIGN_PREFIX = 'flowerpot-read-v1';

/**
 * @param {{ prefix?: string, scheme?: string }} [opts]
 */
export function resolveWritePrefix(opts = {}) {
  if (opts.prefix != null && String(opts.prefix).trim()) {
    return String(opts.prefix).trim();
  }
  const scheme = String(opts.scheme || '').toLowerCase();
  if (
    scheme === 'proposal' ||
    scheme === 'foobarch' ||
    scheme === 'netproposal'
  ) {
    return PROPOSAL_WRITE_PREFIX;
  }
  return WRITE_SIGN_PREFIX;
}

/**
 * @returns {{ publicKey: string, privateKey: string, jwk: import('node:crypto').JsonWebKey }}
 *   publicKey = JWK `x` (base64url, 32 bytes)
 *   privateKey = JWK `d` (base64url)
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privJwk = privateKey.export({ format: 'jwk' });
  return {
    publicKey: pubJwk.x,
    privateKey: privJwk.d,
    jwk: privJwk,
  };
}

/**
 * Stable short id for namespaces / aside prefixes (not a secret).
 * @param {string} publicKeyX
 */
export function publicKeyHash(publicKeyX) {
  return createHash('sha256').update(publicKeyX, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Canonical message for write authorization.
 * @param {{
 *   ib: string,
 *   parentAddr?: string,
 *   body: Buffer | Uint8Array | string,
 *   contentType: string,
 *   prefix?: string,
 *   scheme?: string,
 * }} opts
 */
export function writeMessage({
  ib,
  parentAddr = '',
  body,
  contentType,
  prefix,
  scheme,
}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
  const contentSha256 = createHash('sha256').update(buf).digest('hex');
  return [
    resolveWritePrefix({ prefix, scheme }),
    ib,
    parentAddr || '',
    contentSha256,
    contentType || 'application/octet-stream',
  ].join('\n');
}

/**
 * @param {{
 *   privateKey: string,
 *   publicKey: string,
 *   ib: string,
 *   parentAddr?: string,
 *   body: Buffer | Uint8Array | string,
 *   contentType: string,
 *   prefix?: string,
 *   scheme?: string,
 * }} opts
 * @returns {{ publicKey: string, signature: string, message: string }}
 */
export function signWrite(opts) {
  const message = writeMessage(opts);
  const key = createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: opts.publicKey,
      d: opts.privateKey,
    },
    format: 'jwk',
  });
  const signature = sign(null, Buffer.from(message, 'utf8'), key).toString('base64url');
  return { publicKey: opts.publicKey, signature, message };
}

/**
 * @param {{
 *   publicKey: string,
 *   signature: string,
 *   ib: string,
 *   parentAddr?: string,
 *   body: Buffer | Uint8Array | string,
 *   contentType: string,
 * }} opts
 */
export function verifyWriteSignature(opts) {
  const message = writeMessage(opts);
  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: opts.publicKey },
      format: 'jwk',
    });
    return verify(
      null,
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(opts.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/**
 * Canonical message for read authorization. Binds `ib` + `timestamp` so a
 * client can sign to read the *latest* of an ib without first knowing its
 * current addr. `timestamp` is optional; when a schema ignores time, pass ''
 * and both sides still agree.
 * @param {{ ib: string, timestamp?: string | number }} opts
 */
export function readMessage({ ib, timestamp = '' }) {
  return [
    READ_SIGN_PREFIX,
    ib,
    timestamp === '' || timestamp == null ? '' : String(timestamp),
  ].join('\n');
}

/**
 * @param {{
 *   privateKey: string,
 *   publicKey: string,
 *   ib: string,
 *   timestamp?: string | number,
 * }} opts
 * @returns {{ publicKey: string, signature: string, message: string, timestamp: string }}
 */
export function signRead(opts) {
  const timestamp =
    opts.timestamp === '' || opts.timestamp == null ? '' : String(opts.timestamp);
  const message = readMessage({ ib: opts.ib, timestamp });
  const key = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: opts.publicKey, d: opts.privateKey },
    format: 'jwk',
  });
  const signature = sign(null, Buffer.from(message, 'utf8'), key).toString('base64url');
  return { publicKey: opts.publicKey, signature, message, timestamp };
}

/**
 * Headers a client sends with PUT/DELETE.
 * @param {{ publicKeys: string[], signatures: string[] }} opts
 */
export function buildSignHeaders({ publicKeys, signatures }) {
  return {
    'X-Flowerpot-Sign-Keys': publicKeys.join(','),
    'X-Flowerpot-Signatures': signatures.join(','),
  };
}

/**
 * Headers for a signed read. Includes optional timestamp (echoed into the
 * signed message the server rebuilds).
 * @param {{ publicKeys: string[], signatures: string[], timestamp?: string | number }} opts
 */
export function buildReadHeaders({ publicKeys, signatures, timestamp }) {
  /** @type {Record<string,string>} */
  const h = {
    'X-Flowerpot-Sign-Keys': publicKeys.join(','),
    'X-Flowerpot-Signatures': signatures.join(','),
  };
  if (timestamp !== undefined && timestamp !== '' && timestamp !== null) {
    h['X-Flowerpot-Timestamp'] = String(timestamp);
  }
  return h;
}
