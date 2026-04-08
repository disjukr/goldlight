import { createScratchMatrixBuffer } from '@disjukr/goldlight/renderer';

const writeWithFunction = (target: Float32Array, iterations: number) => {
  for (let index = 0; index < iterations; index += 1) {
    const offset = (index % (target.length / 16)) * 16;
    target[offset] = index;
    target[offset + 5] = index;
    target[offset + 10] = index;
    target[offset + 15] = 1;
  }
};

class MatrixScratch {
  constructor(readonly target: Float32Array) {}

  write(iterations: number) {
    for (let index = 0; index < iterations; index += 1) {
      const offset = (index % (this.target.length / 16)) * 16;
      this.target[offset] = index;
      this.target[offset + 5] = index;
      this.target[offset + 10] = index;
      this.target[offset + 15] = 1;
    }
  }
}

Deno.bench('function scratch writes', () => {
  const target = createScratchMatrixBuffer(256);
  writeWithFunction(target, 100_000);
});

Deno.bench('class scratch writes', () => {
  const scratch = new MatrixScratch(createScratchMatrixBuffer(256));
  scratch.write(100_000);
});
