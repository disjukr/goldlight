import { createWindow, disposeMain, initializeMain } from '@disjukr/goldlight/desktop';
import app from '../triangle/app.ts';

await initializeMain();
try {
  const leftWindow = createWindow({
    title: 'goldlight multiwindow left',
    width: 360,
    height: 240,
    backgroundColor: [0.07, 0.11, 0.17, 1],
    entry: app,
  });
  const rightWindow = createWindow({
    title: 'goldlight multiwindow right',
    width: 360,
    height: 240,
    backgroundColor: [0.16, 0.08, 0.09, 1],
    entry: app,
  });

  await Promise.all([
    leftWindow.whenClosed(),
    rightWindow.whenClosed(),
  ]);
} finally {
  await disposeMain();
}
