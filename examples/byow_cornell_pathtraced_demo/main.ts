/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@rieul3d/desktop';

await runDesktopModule({
  title: 'rieul3d byow pathtraced cornell box demo',
  width: 1100,
  height: 760,
  module: new URL('./app.ts', import.meta.url),
});
