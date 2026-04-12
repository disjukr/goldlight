import { Path2d, Rect2d, Scene2d, createTextHost, setWindowScene } from "goldlight";
import { createTextOnPolylineGroup2d, matchCandidateTypeface, sampleCubicBezier } from "../text_shared";

function mount() {
  const host = createTextHost();
  const latin = matchCandidateTypeface(host, ["Calibri", "Palatino Linotype", "Cambria"]);
  const hangul = matchCandidateTypeface(host, ["Malgun Gothic", "Segoe UI", "Arial Unicode MS"]);
  if (!latin || !hangul) {
    throw new Error("text_on_path could not resolve required fonts");
  }

  const latinRun = host.shapeText({
    typeface: latin.typeface,
    text: "The quick brown fox jumps over the lazy dog",
    size: 34,
    language: "en",
  });
  const hangulRun = host.shapeText({
    typeface: hangul.typeface,
    text: "한글 텍스트를 곡선 위에 배치합니다",
    size: 42,
    language: "ko",
  });
  if (!latinRun || !hangulRun) {
    throw new Error("text_on_path could not shape text");
  }

  const topCurve = sampleCubicBezier([70, 250], [300, 30], [940, 20], [1210, 260], 128);
  const bottomCurve = sampleCubicBezier([90, 585], [280, 440], [970, 700], [1210, 555], 128);

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  }));
  scene.add(new Rect2d({
    x: 38,
    y: 38,
    width: 1204,
    height: 684,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));

  scene.add(new Path2d({
    style: "stroke",
    strokeWidth: 2,
    color: { r: 0.94, g: 0.56, b: 0.24, a: 0.55 },
    verbs: [
      { kind: "moveTo", to: topCurve[0]! },
      ...topCurve.slice(1).map((point) => ({ kind: "lineTo" as const, to: point })),
    ],
  }));
  scene.add(new Path2d({
    style: "stroke",
    strokeWidth: 2,
    color: { r: 0.24, g: 0.76, b: 0.64, a: 0.55 },
    verbs: [
      { kind: "moveTo", to: bottomCurve[0]! },
      ...bottomCurve.slice(1).map((point) => ({ kind: "lineTo" as const, to: point })),
    ],
  }));

  scene.add(createTextOnPolylineGroup2d(host, latinRun, topCurve, {
    color: { r: 0.98, g: 0.97, b: 0.94, a: 1 },
    verbs: [],
  }, {
    align: "center",
    normalOffset: -20,
  }));
  scene.add(createTextOnPolylineGroup2d(host, hangulRun, bottomCurve, {
    color: { r: 0.9, g: 1, b: 0.96, a: 1 },
    verbs: [],
  }, {
    align: "center",
    normalOffset: -20,
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
