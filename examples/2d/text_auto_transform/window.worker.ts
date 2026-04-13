import {
  Group2d,
  Rect2d,
  Scene2d,
  Text2d,
  cancelAnimationFrame,
  createTextHost,
  inspectAutoTextSelection,
  requestAnimationFrame,
  setWindowScene,
  type AutoTextMode,
  type AutoTextSelection,
  type ColorValue,
  type ShapedRun,
  type TextHost,
  type Transform2d,
} from "goldlight";
import { matchCandidateTypeface } from "../text_shared";

const panelWidth = 392;
const panelHeight = 760;
const panelTop = 118;
const panelXs = [72, 484, 896];
const statusChipWidth = 72;
const statusChipHeight = 24;
const statusChipGap = 6;
const autoTextModes = [
  "direct-mask",
  "transformed-mask",
  "sdf",
  "path",
] satisfies AutoTextMode[];
const autoTextModeLabels = {
  "direct-mask": "DIRECT",
  "transformed-mask": "T-MASK",
  sdf: "SDF",
  path: "PATH",
} satisfies Record<AutoTextMode, string>;
const autoTextModeColors = {
  "direct-mask": { r: 0.98, g: 0.64, b: 0.32, a: 1 },
  "transformed-mask": { r: 0.48, g: 0.9, b: 0.78, a: 1 },
  sdf: { r: 0.98, g: 0.84, b: 0.39, a: 1 },
  path: { r: 0.48, g: 0.72, b: 1, a: 1 },
} satisfies Record<AutoTextMode, ColorValue>;
const inactiveStatusChipColor = { r: 0.15, g: 0.17, b: 0.21, a: 1 } satisfies ColorValue;
const inactiveStatusTextColor = { r: 0.54, g: 0.58, b: 0.65, a: 1 } satisfies ColorValue;

function createRunCache(
  host: TextHost,
  typeface: Parameters<TextHost["shapeText"]>[0]["typeface"],
  size: number,
  language: string,
) {
  const runs = new Map<string, ShapedRun>();
  return (text: string) => {
    let run = runs.get(text);
    if (!run) {
      run = shapeRequired(host, { typeface, text, size, language }, text);
      runs.set(text, run);
    }
    return run;
  };
}

function formatAutoTextDetail(selection: AutoTextSelection) {
  if (selection.mode === "sdf" && selection.sdfStrikeSize) {
    return `${Math.round(selection.approximateDeviceTextSize)} px -> ${
      autoTextModeLabels[selection.mode]
    } (${selection.sdfStrikeSize}px strike)`;
  }
  return `${Math.round(selection.approximateDeviceTextSize)} px -> ${autoTextModeLabels[selection.mode]}`;
}

function createAutoTextStatusOverlay(
  scene: Scene2d,
  host: TextHost,
  typeface: Parameters<TextHost["shapeText"]>[0]["typeface"],
  panelIndex: number,
) {
  const labelRuns = createRunCache(host, typeface, 11, "en");
  const detailRuns = createRunCache(host, typeface, 12, "en");
  const panelX = panelXs[panelIndex]!;
  const chipX = panelX + 36;
  const chipY = panelTop + 112;
  const chips = autoTextModes.map((mode, index) => {
    const x = chipX + (index * (statusChipWidth + statusChipGap));
    const rect = scene.add(new Rect2d({
      x,
      y: chipY,
      width: statusChipWidth,
      height: statusChipHeight,
      color: inactiveStatusChipColor,
    }));
    const label = scene.add(createAutoText(
      host,
      labelRuns(autoTextModeLabels[mode]),
      x + 8,
      chipY + 16,
      inactiveStatusTextColor,
      { useSdfForSmallText: false },
    ));
    return { mode, rect, label };
  });
  const detail = scene.add(createAutoText(
    host,
    detailRuns("0 px -> DIRECT"),
    chipX,
    chipY + 46,
    inactiveStatusTextColor,
    { useSdfForSmallText: false },
  ));

  let lastMode: AutoTextMode | null = null;
  let lastDetail = "";
  return {
    update(selection: AutoTextSelection) {
      if (selection.mode !== lastMode) {
        for (const chip of chips) {
          const active = chip.mode === selection.mode;
          chip.rect.set({
            color: active ? autoTextModeColors[chip.mode] : inactiveStatusChipColor,
          });
          chip.label.set({
            color: active ? { r: 0.08, g: 0.09, b: 0.11, a: 1 } : inactiveStatusTextColor,
          });
        }
        lastMode = selection.mode;
      }
      const nextDetail = formatAutoTextDetail(selection);
      if (nextDetail !== lastDetail) {
        detail.set({
          run: detailRuns(nextDetail),
          color: autoTextModeColors[selection.mode],
        });
        lastDetail = nextDetail;
      }
    },
  };
}

function createAffineTransform(
  translateX: number,
  translateY: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
): Transform2d {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return [
    cosine * scaleX,
    sine * scaleX,
    -sine * scaleY,
    cosine * scaleY,
    translateX,
    translateY,
  ];
}

function shapeRequired(
  host: TextHost,
  input: Parameters<TextHost["shapeText"]>[0],
  label: string,
): ShapedRun {
  const run = host.shapeText(input);
  if (!run) {
    throw new Error(`text_auto_transform could not shape ${label}`);
  }
  return run;
}

function createAutoText(
  host: TextHost,
  run: ShapedRun,
  x: number,
  y: number,
  color: ColorValue,
  options: {
    useSdfForSmallText?: boolean;
  } = {},
): Text2d {
  return new Text2d({
    kind: "auto",
    host,
    run,
    x,
    y,
    color,
    useSdfForSmallText: options.useSdfForSmallText,
  });
}

function addPanel(scene: Scene2d, index: number, accent: ColorValue) {
  const x = panelXs[index]!;
  scene.add(new Rect2d({
    x,
    y: panelTop,
    width: panelWidth,
    height: panelHeight,
    color: { r: 0.11, g: 0.12, b: 0.15, a: 1 },
  }));
  scene.add(new Rect2d({
    x,
    y: panelTop,
    width: panelWidth,
    height: 8,
    color: accent,
  }));
  scene.add(new Rect2d({
    x: x + 24,
    y: panelTop + 88,
    width: panelWidth - 48,
    height: panelHeight - 128,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));
}

function mount() {
  const host = createTextHost();
  const latin = matchCandidateTypeface(host, ["Calibri", "Palatino Linotype", "Cambria"]);
  const hangul = matchCandidateTypeface(host, ["Malgun Gothic", "Segoe UI", "Arial Unicode MS"]);
  if (!latin || !hangul) {
    throw new Error("text_auto_transform could not resolve required fonts");
  }

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  }));
  scene.add(new Rect2d({
    x: 40,
    y: 40,
    width: 1280,
    height: 880,
    color: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
  }));

  const accents = [
    { r: 0.94, g: 0.43, b: 0.22, a: 1 },
    { r: 0.2, g: 0.76, b: 0.62, a: 1 },
    { r: 0.35, g: 0.58, b: 0.96, a: 1 },
  ] satisfies ColorValue[];
  for (let index = 0; index < panelXs.length; index += 1) {
    addPanel(scene, index, accents[index]!);
  }

  const leftTitleRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "Translate + Scale",
    size: 20,
    language: "en",
  }, "left title");
  const middleTitleRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "Rotate + Scale",
    size: 20,
    language: "en",
  }, "middle title");
  const rightTitleRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "Large Scale Path",
    size: 20,
    language: "en",
  }, "right title");
  const leftNoteRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "direct -> sdf -> path",
    size: 15,
    language: "en",
  }, "left note");
  const middleNoteRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "rotation keeps bitmap masks",
    size: 15,
    language: "en",
  }, "middle note");
  const rightNoteRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "oversized glyphs fall back to path",
    size: 15,
    language: "en",
  }, "right note");

  scene.add(createAutoText(host, leftTitleRun, panelXs[0]! + 24, panelTop + 42, accents[0]!));
  scene.add(createAutoText(host, middleTitleRun, panelXs[1]! + 24, panelTop + 42, accents[1]!));
  scene.add(createAutoText(host, rightTitleRun, panelXs[2]! + 24, panelTop + 42, accents[2]!));
  scene.add(createAutoText(
    host,
    leftNoteRun,
    panelXs[0]! + 24,
    panelTop + panelHeight - 28,
    { r: 0.76, g: 0.79, b: 0.84, a: 1 },
  ));
  scene.add(createAutoText(
    host,
    middleNoteRun,
    panelXs[1]! + 24,
    panelTop + panelHeight - 28,
    { r: 0.76, g: 0.79, b: 0.84, a: 1 },
    { useSdfForSmallText: false },
  ));
  scene.add(createAutoText(
    host,
    rightNoteRun,
    panelXs[2]! + 24,
    panelTop + panelHeight - 28,
    { r: 0.76, g: 0.79, b: 0.84, a: 1 },
  ));

  const autoRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "Auto",
    size: 18,
    language: "en",
  }, "auto");
  const rotateRun = shapeRequired(host, {
    typeface: hangul.typeface,
    text: "회전",
    size: 18,
    language: "ko",
  }, "rotate");
  const maskRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "mask",
    size: 14,
    language: "en",
  }, "mask");
  const pathRun = shapeRequired(host, {
    typeface: latin.typeface,
    text: "Gold",
    size: 34,
    language: "en",
  }, "path");

  const translateGroup = scene.add(new Group2d());
  translateGroup.add(createAutoText(
    host,
    autoRun,
    -8,
    18,
    { r: 0.98, g: 0.97, b: 0.94, a: 1 },
  ));

  const rotateGroup = scene.add(new Group2d());
  rotateGroup.add(createAutoText(
    host,
    rotateRun,
    -22,
    4,
    { r: 0.9, g: 0.98, b: 0.94, a: 1 },
    { useSdfForSmallText: false },
  ));
  rotateGroup.add(createAutoText(
    host,
    maskRun,
    -16,
    38,
    { r: 0.56, g: 0.92, b: 0.84, a: 1 },
    { useSdfForSmallText: false },
  ));

  const pathGroup = scene.add(new Group2d());
  pathGroup.add(createAutoText(
    host,
    pathRun,
    -16,
    16,
    { r: 0.95, g: 0.97, b: 1, a: 1 },
  ));

  const translateStatus = createAutoTextStatusOverlay(scene, host, latin.typeface, 0);
  const rotateStatus = createAutoTextStatusOverlay(scene, host, latin.typeface, 1);
  const pathStatus = createAutoTextStatusOverlay(scene, host, latin.typeface, 2);

  let disposed = false;
  let frameHandle = 0;

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }

    const seconds = timestampMs * 0.001;
    const translateTransform = createAffineTransform(
      panelXs[0]! + panelWidth * 0.5 + Math.cos(seconds * 0.95) * 52,
      panelTop + panelHeight * 0.48 + Math.sin(seconds * 1.35) * 34,
      0,
      0.65 + ((Math.sin(seconds * 0.72) + 1) * 0.5 * 21.0),
      0.65 + ((Math.sin(seconds * 0.72) + 1) * 0.5 * 21.0),
    );
    const rotateTransform = createAffineTransform(
      panelXs[1]! + panelWidth * 0.5 + Math.cos(seconds * 0.8 + 0.4) * 48,
      panelTop + panelHeight * 0.5 + Math.sin(seconds * 1.18) * 42,
      Math.sin(seconds * 1.05) * 0.95,
      1.0 + ((Math.cos(seconds * 1.25) + 1) * 0.5 * 2.8),
      0.9 + ((Math.sin(seconds * 0.9) + 1) * 0.5 * 2.4),
    );
    const pathTransform = createAffineTransform(
      panelXs[2]! + panelWidth * 0.5 + Math.cos(seconds * 0.55) * 24,
      panelTop + panelHeight * 0.52 + Math.sin(seconds * 0.82) * 28,
      seconds * 0.28,
      9.8 + ((Math.sin(seconds * 0.58) + 1) * 0.5 * 3.6),
      9.2 + ((Math.cos(seconds * 0.66) + 1) * 0.5 * 3.2),
    );

    translateGroup.set({
      transform: translateTransform,
    });

    rotateGroup.set({
      transform: rotateTransform,
    });

    pathGroup.set({
      transform: pathTransform,
    });

    translateStatus.update(inspectAutoTextSelection(autoRun, translateTransform));
    rotateStatus.update(inspectAutoTextSelection(
      rotateRun,
      rotateTransform,
      { useSdfForSmallText: false },
    ));
    pathStatus.update(inspectAutoTextSelection(pathRun, pathTransform));

    frameHandle = requestAnimationFrame(tick);
  }

  tick(0);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
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
