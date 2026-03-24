/// <reference lib="deno.unstable" />

import { runDesktopModule } from '@goldlight/desktop';

await runDesktopModule({
  title: 'goldlight byow helmet forward demo',
  width: 1200,
  height: 720,
  module: new URL('./app.tsx', import.meta.url),
});
