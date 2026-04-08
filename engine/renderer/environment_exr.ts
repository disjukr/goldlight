import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const exrLoader = new EXRLoader();

export const parseExrEnvironmentImage = (bytes: ArrayBuffer): {
  width: number;
  height: number;
  data: Uint16Array;
} =>
  exrLoader.parse(bytes) as {
    width: number;
    height: number;
    data: Uint16Array;
  };

