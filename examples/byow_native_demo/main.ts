/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@goldlight/desktop';

await runDesktopModule({
  title: 'goldlight byow native demo',
  width: 960,
  height: 540,
  module: new URL('./app.ts', import.meta.url),
});
