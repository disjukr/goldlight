import { dirname, fromFileUrl, resolve } from '@std/path';

const repoRoot = resolve(dirname(fromFileUrl(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'engine', 'text', 'native', 'Cargo.toml');
const checkOnly = Deno.args.includes('--check');
const release = Deno.args.includes('--release');
const command = new Deno.Command('mise', {
  args: [
    'exec',
    'rust@stable',
    '--',
    'cargo',
    checkOnly ? 'check' : 'build',
    ...(release ? ['--release'] : []),
    '--manifest-path',
    manifestPath,
  ],
  cwd: repoRoot,
  stdin: 'null',
  stdout: 'inherit',
  stderr: 'inherit',
});

const { code } = await command.output();
if (code !== 0) {
  Deno.exit(code);
}
