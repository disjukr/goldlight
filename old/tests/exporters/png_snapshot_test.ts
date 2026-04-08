import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.14';
import { exportPngRgba } from '@disjukr/goldlight/exporters';

const decodeAscii = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

Deno.test('exportPngRgba writes a deterministic PNG with signature and core chunks', () => {
  const png = exportPngRgba({
    width: 2,
    height: 1,
    bytes: new Uint8Array([
      255,
      0,
      0,
      255,
      0,
      255,
      0,
      255,
    ]),
  });

  assertEquals([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assertEquals(decodeAscii(png.slice(12, 16)), 'IHDR');
  assertEquals(decodeAscii(png.slice(37, 41)), 'IDAT');
  assertEquals(decodeAscii(png.slice(png.length - 8, png.length - 4)), 'IEND');
});

Deno.test('exportPngRgba rejects invalid byte lengths', () => {
  assertThrows(() =>
    exportPngRgba({
      width: 2,
      height: 2,
      bytes: new Uint8Array([0, 0, 0, 0]),
    })
  );
});
