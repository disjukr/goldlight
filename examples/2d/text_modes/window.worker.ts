import { Rect2d, Scene2d, Text2d, buildDirectMaskSubRun, buildSdfSubRun, createTextHost, setWindowScene } from "goldlight";
import { createPathTextGroup2d, matchCandidateTypeface } from "../text_shared";

function mount() {
  const host = createTextHost();
  const latin = matchCandidateTypeface(host, ["Calibri", "Palatino Linotype", "Cambria"]);
  const hangul = matchCandidateTypeface(host, ["Malgun Gothic", "Segoe UI", "Arial Unicode MS"]);
  if (!latin || !hangul) {
    throw new Error("text_modes could not resolve required fonts");
  }

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  }));

  scene.add(new Rect2d({
    x: 42,
    y: 42,
    width: 1196,
    height: 876,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));

  const panelXs = [72, 460, 848];
  const accents = [
    { r: 0.9, g: 0.42, b: 0.2, a: 1 },
    { r: 0.16, g: 0.68, b: 0.58, a: 1 },
    { r: 0.35, g: 0.54, b: 0.94, a: 1 },
  ];
  for (let index = 0; index < 3; index += 1) {
    scene.add(new Rect2d({
      x: panelXs[index],
      y: 108,
      width: 360,
      height: 220,
      color: { r: 0.12, g: 0.13, b: 0.16, a: 1 },
    }));
    scene.add(new Rect2d({
      x: panelXs[index],
      y: 108,
      width: 360,
      height: 8,
      color: accents[index],
    }));
  }

  const directRun = host.shapeText({
    typeface: latin.typeface,
    text: "Direct Mask",
    size: 30,
    language: "en",
  });
  const sdfRun = host.shapeText({
    typeface: hangul.typeface,
    text: "SDF text",
    size: 40,
    language: "en",
  });
  const fallbackRun = host.shapeText({
    typeface: latin.typeface,
    text: "Path fallback",
    size: 50,
    language: "en",
  });
  if (!directRun || !sdfRun || !fallbackRun) {
    throw new Error("text_modes could not shape text");
  }

  const directSubRun = buildDirectMaskSubRun(host, directRun);
  const sdfSubRun = buildSdfSubRun(host, sdfRun);

  scene.add(new Text2d({
    kind: "direct-mask",
    x: panelXs[0] + 28,
    y: 246,
    color: { r: 0.96, g: 0.95, b: 0.9, a: 1 },
    glyphs: directSubRun.glyphs,
  }));

  scene.add(new Text2d({
    kind: "sdf",
    x: panelXs[1] + 28,
    y: 246,
    color: { r: 0.96, g: 0.95, b: 0.9, a: 1 },
    glyphs: sdfSubRun.glyphs,
  }));

  scene.add(createPathTextGroup2d(host, fallbackRun, {
    color: { r: 0.96, g: 0.95, b: 0.9, a: 1 },
    verbs: [],
  }, panelXs[2] + 28, 246));

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
