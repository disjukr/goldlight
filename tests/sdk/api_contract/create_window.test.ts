import { describe, expect, it } from 'bun:test';

import type { WindowHandle, WindowOptions } from 'goldlight';
import { createWindow } from 'goldlight';

describe('goldlight sdk contract', () => {
  it('exports createWindow as a function', () => {
    expect(typeof createWindow).toBe('function');
  });

  it('accepts typed window options', () => {
    const options: WindowOptions = {
      title: 'example',
      width: 640,
      height: 480,
      workerEntrypoint: 'file:///window.worker.js',
    };

    expect(options.title).toBe('example');
    expect(options.width).toBe(640);
    expect(options.height).toBe(480);
    expect(options.workerEntrypoint).toBe('file:///window.worker.js');
  });

  it('describes the window handle shape', () => {
    const handle: WindowHandle = { id: 1 };

    expect(handle.id).toBe(1);
  });

  it('throws outside the runtime', () => {
    expect(() => createWindow()).toThrow(
      'The "goldlight" module is provided by the goldlight runtime at execution time.',
    );
  });
});
