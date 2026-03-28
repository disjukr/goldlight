import { exists } from '@std/fs';
import { dirname, fromFileUrl, join, resolve, toFileUrl } from '@std/path';

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..');
const entrypoint = Deno.args[0];
const desktopHostLibrary = join(
  repoRoot,
  'engine',
  'desktop',
  'native',
  'target',
  'debug',
  'goldlight_desktop_host.dll',
);

if (!entrypoint) {
  throw new Error(
    'Missing BYOW example entrypoint. Pass a relative path such as ./examples/byow/triangle/main.ts',
  );
}

if (!(await exists(desktopHostLibrary))) {
  const command = new Deno.Command('deno', {
    args: ['run', '-A', './scripts/build_desktop_host.ts'],
    cwd: repoRoot,
    stdin: 'null',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const { code } = await command.output();
  if (code !== 0) {
    Deno.exit(code);
  }
}

await import(toFileUrl(resolve(repoRoot, entrypoint)).href);
