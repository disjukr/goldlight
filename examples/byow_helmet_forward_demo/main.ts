/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@rieul3d/desktop';

await runDesktopModule({
  title: 'rieul3d byow helmet forward demo',
  width: 1200,
  height: 720,
  module: new URL('./app.tsx', import.meta.url),
});
