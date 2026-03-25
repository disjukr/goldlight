import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.14';

import { createDesktopWindowRuntime, installDesktopWindowGlobals } from '@goldlight/desktop';

Deno.test('desktop bootstrap installs runtime globals before dynamic imports observe them', async () => {
  const runtime = createDesktopWindowRuntime(1n, () => {});
  const restore = installDesktopWindowGlobals(runtime, () => {});

  try {
    const module = await import(
      'data:text/javascript,export default { hasRaf: typeof globalThis.requestAnimationFrame, hasPostMessage: typeof globalThis.postMessage };'
    );
    assertEquals(module.default, {
      hasRaf: 'function',
      hasPostMessage: 'function',
    });
  } finally {
    restore();
  }
});

Deno.test('desktop runtime cancels callbacks and flushes raf work one frame at a time', () => {
  let requestedFrameCount = 0;
  const runtime = createDesktopWindowRuntime(1n, () => {
    requestedFrameCount += 1;
  });
  const events: string[] = [];

  const cancelledHandle = runtime.requestAnimationFrame(() => {
    events.push('cancelled');
  });
  runtime.cancelAnimationFrame(cancelledHandle);
  runtime.requestAnimationFrame((timeMs: number) => {
    events.push(`frame:${timeMs}`);
    runtime.requestAnimationFrame(() => {
      events.push('nested');
    });
  });

  runtime.flushAnimationFrameCallbacks(12);
  assertEquals(events, ['frame:12']);
  assertEquals(requestedFrameCount, 4);

  runtime.flushAnimationFrameCallbacks(24);
  assertEquals(events, ['frame:12', 'nested']);
  assertEquals(requestedFrameCount, 4);
});

Deno.test('desktop runtime postMessage dispatches queued message events', async () => {
  const runtime = createDesktopWindowRuntime(1n, () => {});
  const received: unknown[] = [];

  runtime.addEventListener('message', (event) => {
    received.push((event as MessageEvent).data);
  });
  runtime.setOnMessage((event) => {
    received.push(`onmessage:${String(event.data)}`);
  });

  runtime.postMessage({ kind: 'ping' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertExists(received[0]);
  assertEquals(received[0], { kind: 'ping' });
  assertEquals(received[1], 'onmessage:[object Object]');
});

Deno.test('desktop runtime expands keyboard host events into keydown and keyup events', () => {
  const runtime = createDesktopWindowRuntime(1n, () => {});
  const received: Array<{ type: string; keyCode: number; pressed: boolean }> = [];

  const handleKeyboardEvent = (type: string) => (event: Event) => {
    const detail = (event as CustomEvent<{ keyCode: number; pressed: boolean }>).detail;
    received.push({
      type,
      keyCode: detail.keyCode,
      pressed: detail.pressed,
    });
  };

  runtime.addEventListener('keydown', handleKeyboardEvent('keydown'));
  runtime.addEventListener('keyup', handleKeyboardEvent('keyup'));
  runtime.addEventListener('keyboard', handleKeyboardEvent('keyboard'));

  runtime.dispatchHostEvent({
    kind: 'keyboard',
    windowId: 1n,
    keyCode: 78,
    pressed: true,
  });
  runtime.dispatchHostEvent({
    kind: 'keyboard',
    windowId: 1n,
    keyCode: 78,
    pressed: false,
  });

  assertEquals(received, [
    { type: 'keyboard', keyCode: 78, pressed: true },
    { type: 'keydown', keyCode: 78, pressed: true },
    { type: 'keyboard', keyCode: 78, pressed: false },
    { type: 'keyup', keyCode: 78, pressed: false },
  ]);
});
