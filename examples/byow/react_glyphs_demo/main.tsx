/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow react glyphs demo',
    width: 1280,
    height: 720,
    backgroundColor: [0.09, 0.1, 0.13, 1],
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
