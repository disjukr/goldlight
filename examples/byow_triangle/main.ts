/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@rieul3d/desktop';

await runDesktopModule({
  title: 'rieul3d byow triangle',
  width: 960,
  height: 540,
  module: new URL('./app.ts', import.meta.url),
});
