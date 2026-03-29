/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow layout 3d demo',
    width: 1024,
    height: 768,
    backgroundColor: [0.06, 0.07, 0.09, 1],
    module: new URL('./app.tsx', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
