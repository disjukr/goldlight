import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { renderBasicPathsSnapshot } from '../examples/render_basic_paths/render.ts';

const expectedPngSha256 = 'b2fc8f9969a3d271a959152977fae23111bab98cfd0905de961a04d1cab7f986';

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
