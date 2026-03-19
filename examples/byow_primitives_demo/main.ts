/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@rieul3d/desktop';

await runDesktopModule({
  title: 'rieul3d byow primitives demo',
  width: 1200,
  height: 720,
  module: new URL('./app.ts', import.meta.url),
});
