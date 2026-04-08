import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'engine', 'text', 'native', 'Cargo.toml');
const release = process.argv.includes('--release');
const buildMode = release ? 'release' : 'debug';
const command = spawnSync(
  'cargo',
  [
    'build',
    ...(release ? ['--release'] : []),
    '--manifest-path',
    manifestPath,
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if ((command.status ?? 1) !== 0) {
  process.exit(command.status ?? 1);
}

const extension = process.platform === 'win32'
  ? 'dll'
  : process.platform === 'darwin'
  ? 'dylib'
  : 'so';
const crateFileName = process.platform === 'win32'
  ? 'goldlight_text_host.dll'
  : `libgoldlight_text_host.${extension}`;
const artifactPath = resolve(
  repoRoot,
  'engine',
  'text',
  'native',
  'target',
  buildMode,
  crateFileName,
);
const outputPath = resolve(repoRoot, 'engine', 'text', 'native', 'index.node');

if (!existsSync(artifactPath)) {
  throw new Error(`Missing native text artifact at ${artifactPath}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(artifactPath, outputPath);
