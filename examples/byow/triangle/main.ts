import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';
import app from './app.ts';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight triangle demo',
    width: 960,
    height: 540,
    entry: app,
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
