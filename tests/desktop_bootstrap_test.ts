import { assertEquals, assertExists } from 'jsr:@std/assert@^1.0.14';

import { createDesktopWindowRuntime, installDesktopWindowGlobals } from '@rieul3d/desktop';

Deno.test('desktop bootstrap installs runtime globals before dynamic imports observe them', async () => {
  const runtime = createDesktopWindowRuntime(1n, () => {});
  const restore = installDesktopWindowGlobals(runtime);

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
  assertEquals(requestedFrameCount, 2);

  runtime.flushAnimationFrameCallbacks(24);
  assertEquals(events, ['frame:12', 'nested']);
  assertEquals(requestedFrameCount, 2);
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
