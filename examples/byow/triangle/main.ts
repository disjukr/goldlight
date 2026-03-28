/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow triangle',
    width: 960,
    height: 540,
    module: new URL('./app.ts', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
