import { assertEquals } from 'jsr:@std/assert@^1.0.14';
import { resolve } from '@std/path';
import { resolveOutputPath } from '../../scripts/render_headless_snapshot.ts';

Deno.test('resolveOutputPath keeps caller-provided paths rooted at the current working directory', () => {
  assertEquals(
    resolveOutputPath('./tmp/custom.png'),
    resolve(Deno.cwd(), 'tmp/custom.png'),
  );
});
