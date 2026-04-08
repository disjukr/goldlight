import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';
import app from './app.tsx';

await initializeMain();
try {
  const window = createWindow({
    title: 'goldlight byow layout demo',
    width: 1024,
    height: 768,
    backgroundColor: [0.08, 0.09, 0.11, 1],
    entry: app,
  });
  await window.whenClosed();
} finally {
  await disposeMain();
}
