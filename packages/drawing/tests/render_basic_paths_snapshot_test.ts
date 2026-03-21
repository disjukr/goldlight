import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { renderBasicPathsSnapshot } from '../examples/render_basic_paths/render.ts';

const expectedPngSha256 = '33fe578ba208d8c0d3f13f6b076e0fda11f195a836ab78e1d61af03301fa982e';

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

Deno.test({
  name: 'render basic paths snapshot matches expected PNG hash',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    if (!globalThis.navigator?.gpu) {
      return;
    }

    const snapshot = await renderBasicPathsSnapshot();
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', snapshot.png.slice().buffer),
    );

    assertEquals(snapshot.unsupportedCommandCount, 0);
    assertEquals(snapshot.passCount, 5);
    assertEquals(toHex(digest), expectedPngSha256);
  },
});
