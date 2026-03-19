/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@rieul3d/desktop';

await runDesktopModule({
  title: 'rieul3d byow react bunny demo',
  width: 1280,
  height: 720,
  module: new URL('./app.tsx', import.meta.url),
});
