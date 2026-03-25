/// <reference lib="deno.unstable" />

import { createWindow, dispose, initialize } from '@goldlight/desktop';

await initialize();
try {
  const window = createWindow({
    title: 'goldlight byow helmet forward demo',
    width: 1200,
    height: 720,
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await dispose();
}
