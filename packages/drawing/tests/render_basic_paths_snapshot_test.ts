import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { canUseWebGPU } from '@goldlight/gpu';
import { renderBasicPathsSnapshot } from '../examples/render_basic_paths/render.ts';

const expectedPngSha256 = '3d8b89e39b0544c21f1fb8ba318bd33bc7948692b9293a8f9fc9437b61055a68';

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.test({
  name: 'render basic paths snapshot matches expected PNG hash',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (!(await canUseWebGPU())) {
      return;
    }

    const snapshot = await renderBasicPathsSnapshot();
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', snapshot.png.slice().buffer),
    );

    assertEquals(snapshot.unsupportedCommandCount, 0);
    assertEquals(snapshot.passCount, 1);
    assertEquals(toHex(digest), expectedPngSha256);
  },
});
