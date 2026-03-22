import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { canUseWebGPU } from '@rieul3d/gpu';
import { renderBasicPathsSnapshot } from '../examples/render_basic_paths/render.ts';

const expectedPngSha256 = 'ab02e590a033b83b5ebd4c75d462b7225d1729931bba4eac28a516b7c0f2a0d7';

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
    assertEquals(snapshot.passCount, 3);
    assertEquals(toHex(digest), expectedPngSha256);
  },
});
