/**
 * Local smoke for units/callin coherency (no browser).
 * Usage: node scripts/smoke_units.mjs   (from navi_shell/)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const seedDir = path.join(root, '..', 'C_devops', 'navi_redux', 'seed');
const index = JSON.parse(
  fs.readFileSync(path.join(seedDir, 'index.json'), 'utf8')
);

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok', msg);
  else {
    console.error('  FAIL', msg);
    failed++;
  }
}

console.log('1) seed tips present + GET/POST');
for (const ib of index.tips) {
  const file = index.files[ib];
  ok(!!file, `${ib} mapped`);
  const frame = JSON.parse(
    fs.readFileSync(path.join(seedDir, file), 'utf8')
  );
  ok(frame.ib === ib, `${ib} frame.ib`);
  const http = frame.data?.method || frame.data?.http || {};
  const kindG = String(http.GET?.kind || '').toLowerCase();
  if (kindG === 'mod' || kindG === 'surface' || kindG === 'relay' || !kindG) {
    // root is frame-only GET — still fine
  }
  if (kindG === 'mod' || kindG === 'surface') {
    ok(!!http.POST, `${ib} has POST`);
    ok(!!http.GET, `${ib} has GET`);
  }
  if (ib === 'navi') {
    ok(!http.POST || http.POST.kind !== 'navi_root', 'navi has no navi_root POST');
    ok(!frame.data.links, 'navi has no links guide');
  }
  if (ib === 'unit') {
    ok(frame.data.units && typeof frame.data.units === 'object', 'unit has units{}');
  }
  if (ib === 'plug') {
    const m = frame.data?.method || frame.data?.http || {};
    ok(m.GET?.target === 'plug' && m.POST?.target === 'plug', 'plug surface');
  }
}

console.log('2) ibSegments / callin fold (esbuild seeds)');
const out = path.join(root, 'dist', 'smoke_seeds.mjs');
execSync(
  `npx esbuild src/navi_redux_seeds.ts --bundle --platform=node --format=esm --outfile=${out}`,
  { cwd: root, stdio: 'pipe' }
);
const seeds = await import(pathToFileUrl(out));
const { ibSegments, tipIbsMatch, moduleParkIb, NAVI_REDUX_SEED_TIPS } = seeds;

function callinToParkPath(trimmed) {
  let raw = String(trimmed || '').trim().replace(/^\/+/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* */
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  const segs = [];
  for (const t of tokens) {
    const parts = ibSegments(t);
    if (parts.length) segs.push(...parts);
    else segs.push(t);
  }
  return segs.join('/');
}

ok(
  JSON.stringify(ibSegments('navi/surf/hypertext/welcome')) ===
    JSON.stringify(['navi', 'surf', 'hypertext', 'welcome']),
  'slash segs'
);
ok(
  JSON.stringify(ibSegments('navi surf hypertext welcome')) ===
    JSON.stringify(['navi', 'surf', 'hypertext', 'welcome']),
  'space segs'
);
ok(tipIbsMatch('surf', 'surf'), 'surf tipIbsMatch bare');
ok(moduleParkIb('surf') === 'surf', 'moduleParkIb surf bare');
ok(
  callinToParkPath('surf hypertext/welcome') === 'surf/hypertext/welcome',
  'callin fold surf bare'
);
ok(
  callinToParkPath('unit/01/unmount surf') === 'unit/01/unmount/surf',
  'callin fold unit bare'
);
ok(
  callinToParkPath('reseed force') === 'reseed/force',
  'callin fold reseed bare'
);
ok(
  NAVI_REDUX_SEED_TIPS.some((t) => t.ib === 'plug') &&
    NAVI_REDUX_SEED_TIPS.some((t) => t.ib === 'factoryreset'),
  'seed array includes plug + factoryreset'
);
ok(
  !NAVI_REDUX_SEED_TIPS.some((t) => t.ib === 'navi:admin'),
  'no admin seed'
);

console.log(failed ? `\n${failed} FAIL` : '\nall ok');
process.exit(failed ? 1 : 0);

function pathToFileUrl(p) {
  const u = path.resolve(p).replace(/\\/g, '/');
  return u.startsWith('/') ? `file://${u}` : `file:///${u}`;
}
