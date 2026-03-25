/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow helmet forward demo',
    width: 1200,
    height: 720,
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
