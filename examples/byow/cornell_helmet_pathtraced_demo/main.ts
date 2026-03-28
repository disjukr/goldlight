/// <reference lib="deno.unstable" />

import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow cornell helmet pathtraced demo',
    width: 1280,
    height: 720,
    module: new URL('./app.ts', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
