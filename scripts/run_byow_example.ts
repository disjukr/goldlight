import { exists } from '@std/fs';
import { dirname, fromFileUrl, join, resolve, toFileUrl } from '@std/path';

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..');
const windowsSdl2Path = join(repoRoot, 'vendor', 'sdl2', 'windows-x64');
const entrypoint = Deno.args[0];

if (!entrypoint) {
  throw new Error(
    'Missing BYOW example entrypoint. Pass a relative path such as ./examples/byow_triangle/main.ts',
  );
}

if (Deno.build.os === 'windows' && !Deno.env.get('DENO_SDL2_PATH')) {
  if (!(await exists(windowsSdl2Path))) {
    throw new Error(
      'SDL2 runtime is not installed. Run `deno task setup:sdl2:windows` first.',
    );
  }

  Deno.env.set('DENO_SDL2_PATH', windowsSdl2Path);
}

await import(toFileUrl(resolve(repoRoot, entrypoint)).href);
