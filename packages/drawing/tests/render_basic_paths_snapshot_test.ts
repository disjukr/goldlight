import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { canUseWebGPU } from '@rieul3d/gpu';
import { renderBasicPathsSnapshot } from '../examples/render_basic_paths/render.ts';

const expectedPngSha256 = '90fabc0728ab9ecbdbb73a87946a0d5825c3f1b86e4df189dc65617c46a5d59d';

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
    assertEquals(snapshot.passCount, 4);
    assertEquals(toHex(digest), expectedPngSha256);
  },
});
