/// <reference lib="deno.unstable" />

import { createWindow, dispose, initialize } from '@goldlight/desktop';

await initialize();
try {
  const window = createWindow({
    title: 'goldlight byow cornell pathtraced demo',
    width: 1280,
    height: 720,
    module: new URL('./app.ts', import.meta.url),
  });
  await window.whenClosed();
} finally {
  await dispose();
}
