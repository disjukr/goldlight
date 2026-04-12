import { Rect2d, Scene2d, Text2d, buildSdfSubRun, createTextHost, setWindowScene } from "goldlight";
import { matchCandidateTypeface } from "../text_shared";

function mount() {
  const host = createTextHost();
  const latin = matchCandidateTypeface(host, ["Calibri", "Palatino Linotype", "Cambria"]);
  const hangul = matchCandidateTypeface(host, ["Malgun Gothic", "Segoe UI", "Arial Unicode MS"]);
  if (!latin || !hangul) {
    throw new Error("text_sdf could not resolve required fonts");
  }

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  }));
  scene.add(new Rect2d({
    x: 40,
    y: 40,
    width: 1200,
    height: 680,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));

  const lines = [
    { typeface: latin.typeface, text: "SDF text", size: 52, color: { r: 0.98, g: 0.76, b: 0.36, a: 1 }, language: "en" },
    { typeface: hangul.typeface, text: "한글 SDF 렌더링", size: 44, color: { r: 0.38, g: 0.82, b: 0.74, a: 1 }, language: "ko" },
    { typeface: latin.typeface, text: "Sharp at scale", size: 32, color: { r: 0.72, g: 0.8, b: 0.98, a: 1 }, language: "en" },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const run = host.shapeText(line);
    if (!run) {
      continue;
    }
    const subRun = buildSdfSubRun(host, run);
    scene.add(new Text2d({
      kind: "sdf",
      x: 96,
      y: 184 + (index * 118),
      color: line.color,
      glyphs: subRun.glyphs,
    }));
  }

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
