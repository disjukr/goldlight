import { Path2d, Rect2d, Scene2d, buildGlyphClusters, createTextHost, setWindowScene } from "goldlight";
import { createPathTextGroup2d, matchCandidateTypeface } from "../text_shared";

function mount() {
  const host = createTextHost();
  const latin = matchCandidateTypeface(host, ["Calibri", "Palatino Linotype", "Cambria"]);
  if (!latin) {
    throw new Error("text_glyph_clusters could not resolve required fonts");
  }

  const run = host.shapeText({
    typeface: latin.typeface,
    text: "office affinity efficient shuffle",
    size: 62,
    language: "en",
  });
  if (!run) {
    throw new Error("text_glyph_clusters could not shape text");
  }

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  }));
  scene.add(new Rect2d({
    x: 40,
    y: 40,
    width: 1200,
    height: 640,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));

  const baselineX = 96;
  const baselineY = 300;
  const clusters = buildGlyphClusters(run);

  for (let index = 0; index < clusters.length; index += 1) {
    const cluster = clusters[index]!;
    const startX = baselineX + run.positions[cluster.glyphStart * 2]!;
    const width = cluster.advanceX;
    scene.add(new Rect2d({
      x: startX,
      y: baselineY - 72,
      width: Math.max(width, 8),
      height: 96,
      color: index % 2 === 0
        ? { r: 0.98, g: 0.76, b: 0.36, a: 0.18 }
        : { r: 0.38, g: 0.82, b: 0.74, a: 0.18 },
    }));
  }

  scene.add(createPathTextGroup2d(host, run, {
    color: { r: 0.96, g: 0.95, b: 0.9, a: 1 },
    verbs: [],
  }, baselineX, baselineY));

  scene.add(new Path2d({
    style: "stroke",
    strokeWidth: 2,
    color: { r: 0.72, g: 0.8, b: 0.98, a: 0.7 },
    verbs: [
      { kind: "moveTo", to: [baselineX, baselineY + 2] },
      { kind: "lineTo", to: [baselineX + run.advanceX, baselineY + 2] },
    ],
  }));

  return {
    dispose() {
      host.close();
    },
  };
}

const app = mount();

if (import.meta.hot) {
  import.meta.hot.accept(() => {});
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
