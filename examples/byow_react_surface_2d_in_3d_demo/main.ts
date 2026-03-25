/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow react 2d surface demo',
    width: 1280,
    height: 720,
    backgroundColor: [0.08, 0.19, 0.26, 1],
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
