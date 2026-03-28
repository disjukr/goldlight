/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow layout demo',
    width: 1280,
    height: 820,
    backgroundColor: [0.08, 0.09, 0.11, 1],
    module: new URL('./app.ts', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
