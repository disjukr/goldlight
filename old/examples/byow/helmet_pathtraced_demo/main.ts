import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';
import app from './app.ts';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight helmet pathtraced demo',
    width: 1280,
    height: 720,
    entry: app,
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
