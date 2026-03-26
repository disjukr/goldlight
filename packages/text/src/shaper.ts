import type { GlyphCluster, ShapedRun, ShapeTextInput, TextHost } from './types.ts';

export class TextShaper {
  readonly #host: TextHost;

  constructor(host: TextHost) {
    this.#host = host;
  }

  shapeText(input: ShapeTextInput): ShapedRun {
    return this.#host.shapeText(input);
  }
}

export const buildGlyphClusters = (run: ShapedRun): readonly GlyphCluster[] => {
  const clusters: GlyphCluster[] = [];
  const glyphCount = run.glyphIDs.length;
  if (glyphCount === 0) {
    return clusters;
  }

  if (run.direction === 'ltr') {
    let glyphStart = 0;
    let clusterStart = run.clusterIndices[0];
    for (let glyphIndex = 1; glyphIndex <= glyphCount; glyphIndex += 1) {
      const nextCluster = run.clusterIndices[glyphIndex];
      if (nextCluster <= clusterStart) {
        continue;
      }
      clusters.push({
        textStart: clusterStart,
        textEnd: nextCluster,
        glyphStart,
        glyphEnd: glyphIndex,
        advanceX: run.positions[glyphIndex * 2] - run.positions[glyphStart * 2],
        advanceY: run.positions[glyphIndex * 2 + 1] - run.positions[glyphStart * 2 + 1],
      });
      glyphStart = glyphIndex;
      clusterStart = nextCluster;
    }
  } else {
    let glyphEnd = glyphCount;
    let clusterStart = run.utf8RangeStart;
    for (let glyphStart = glyphCount - 1; glyphStart >= 0; glyphStart -= 1) {
      const nextCluster = glyphStart === 0 ? run.utf8RangeEnd : run.clusterIndices[glyphStart - 1];
      if (nextCluster <= clusterStart) {
        continue;
      }
      clusters.push({
        textStart: clusterStart,
        textEnd: nextCluster,
        glyphStart,
        glyphEnd,
        advanceX: run.positions[glyphEnd * 2] - run.positions[glyphStart * 2],
        advanceY: run.positions[glyphEnd * 2 + 1] - run.positions[glyphStart * 2 + 1],
      });
      glyphEnd = glyphStart;
      clusterStart = nextCluster;
    }
  }

  return clusters;
};
