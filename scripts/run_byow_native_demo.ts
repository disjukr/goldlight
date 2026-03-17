import { exists } from '@std/fs';
import { dirname, fromFileUrl, join } from '@std/path';

const repoRoot = join(dirname(fromFileUrl(import.meta.url)), '..');
const windowsSdl2Path = join(repoRoot, 'vendor', 'sdl2', 'windows-x64');

if (Deno.build.os === 'windows' && !Deno.env.get('DENO_SDL2_PATH')) {
  if (!(await exists(windowsSdl2Path))) {
    throw new Error(
      'SDL2 runtime is not installed. Run `deno task setup:sdl2:windows` first.',
    );
  }

  Deno.env.set('DENO_SDL2_PATH', windowsSdl2Path);
}

await import('../examples/byow_native_demo/main.ts');
