/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@goldlight/desktop';

await runDesktopModule({
  title: 'goldlight byow react 3d scene in 3d demo',
  width: 1280,
  height: 720,
  module: new URL('./app.tsx', import.meta.url),
});
