import esbuild from 'esbuild';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const htmxSource = readFileSync(path.join(__dirname, 'lib', 'htmx.min.js'), 'utf8');

console.log('Starting build process...');

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: false,
  minify: false,
  external: ['fs', 'path', 'os', 'url', 'events', 'readline', 'async_hooks'],
  loader: {
    '.ts': 'ts',
    '.js': 'js',
    '.json': 'json',
    '.d.ts': 'ts',
  },
  resolveExtensions: ['.ts', '.js', '.json', '.d.ts'],
};

const browserConfig = {
  ...shared,
  outfile: 'dist/navi_shell.js',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  define: {
    NODE_ENV: '"development"',
    DEBUG: '"true"',
  },
  globalName: 'naviShell',
  banner: {
    js: `${htmxSource}\nconsole.log("[NaviShell Bundle] Starting...", {timestamp: new Date().toISOString()});`,
  },
};

// Node-only localnavi package input for pkg → navi_shell.exe
const localnaviConfig = {
  ...shared,
  outfile: 'dist/navi_shell_localnavi.cjs',
  format: 'cjs',
  platform: 'node',
  target: ['node22'],
  banner: {
    js: 'process.env.NAVI_LOCALNAVI = process.env.NAVI_LOCALNAVI || process.env.NAVI_NATIVE || "1";',
  },
};

console.log('Starting esbuild...');

Promise.all([esbuild.build(browserConfig), esbuild.build(localnaviConfig)])
  .then(() => {
    console.log('Build completed successfully');
  })
  .catch((error) => {
    console.error('Build failed:', error);
    process.exit(1);
  });
