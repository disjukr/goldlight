/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow react 3d scene in 3d demo',
    width: 1280,
    height: 720,
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
