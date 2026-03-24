/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@goldlight/desktop';

await runDesktopModule({
  title: 'goldlight byow primitives demo',
  width: 1200,
  height: 720,
  module: new URL('./app.ts', import.meta.url),
});
