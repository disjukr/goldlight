import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';
import app from './app.tsx';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow react bunny demo',
    width: 1280,
    height: 720,
    entry: app,
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
