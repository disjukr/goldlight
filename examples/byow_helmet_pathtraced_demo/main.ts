/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@goldlight/desktop';

await runDesktopModule({
  title: 'goldlight byow helmet pathtraced demo',
  width: 1280,
  height: 720,
  module: new URL('./app.ts', import.meta.url),
});
