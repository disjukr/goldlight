import {
  Group2d,
  Rect2d,
  Scene2d,
  ScrollContainer2d,
  Text2d,
  cancelAnimationFrame,
  createTextHost,
  getWindowInfo,
  requestAnimationFrame,
  setWindowScene,
  type ColorValue,
  type ShapedRun,
  type TextHost,
} from "goldlight";
import { matchCandidateTypeface } from "../text_shared";

const panelX = 96;
const panelY = 40;
const panelWidth = 1088;
const panelHeight = 736;
const viewportX = 160;
const viewportY = 212;
const viewportWidth = 960;
const viewportHeight = 436;
const contentWidth = 1880;
const contentHeight = 1220;
const headerX = 160;
const titleY = 98;
const subtitleLine1Y = 138;
const subtitleLine2Y = 160;
const subtitleLine3Y = 182;
const footerTrackX = 160;
const footerTrackWidth = viewportWidth;
const scrollLabelY = 680;
const horizontalLabelY = 712;
const horizontalTrackY = 722;
const verticalLabelY = 748;
const verticalTrackY = 758;

const panelColor = { r: 0.1, g: 0.12, b: 0.15, a: 1 } satisfies ColorValue;
const panelInsetColor = { r: 0.06, g: 0.07, b: 0.09, a: 1 } satisfies ColorValue;
const lineColor = { r: 0.16, g: 0.2, b: 0.25, a: 1 } satisfies ColorValue;
const xTrackColor = { r: 0.18, g: 0.21, b: 0.24, a: 1 } satisfies ColorValue;
const yTrackColor = { r: 0.14, g: 0.18, b: 0.21, a: 1 } satisfies ColorValue;
const xFillColor = { r: 0.95, g: 0.55, b: 0.29, a: 1 } satisfies ColorValue;
const yFillColor = { r: 0.27, g: 0.78, b: 0.86, a: 1 } satisfies ColorValue;
const bodyTextColor = { r: 0.88, g: 0.88, b: 0.84, a: 1 } satisfies ColorValue;
const detailTextColor = { r: 0.57, g: 0.63, b: 0.71, a: 1 } satisfies ColorValue;
const fpsTextColor = { r: 0.96, g: 0.87, b: 0.52, a: 1 } satisfies ColorValue;
const contentBaseColor = { r: 0.08, g: 0.09, b: 0.11, a: 1 } satisfies ColorValue;
const contentGridColor = { r: 0.14, g: 0.16, b: 0.19, a: 1 } satisfies ColorValue;

const cardAccents = [
  { r: 0.96, g: 0.45, b: 0.28, a: 1 },
  { r: 0.95, g: 0.75, b: 0.32, a: 1 },
  { r: 0.24, g: 0.78, b: 0.74, a: 1 },
  { r: 0.35, g: 0.58, b: 0.97, a: 1 },
] satisfies ColorValue[];

function createTextRunFactory(
  host: TextHost,
  typeface: Parameters<TextHost["shapeText"]>[0]["typeface"],
  language = "en",
) {
  const cache = new Map<string, ShapedRun>();
  return (text: string, size: number) => {
    const key = `${language}:${size}:${text}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const run = host.shapeText({ typeface, text, size, language });
    if (!run) {
      throw new Error(`scroll_container could not shape text: ${text}`);
    }
    cache.set(key, run);
    return run;
  };
}

function createAutoText(
  host: TextHost,
  run: ShapedRun,
  x: number,
  y: number,
  color: ColorValue,
) {
  return new Text2d({
    kind: "auto",
    host,
    run,
    x,
    y,
    color,
    useSdfForSmallText: false,
  });
}

function mixColor(left: ColorValue, right: ColorValue, amount: number): ColorValue {
  const t = Math.max(0, Math.min(1, amount));
  const leftAlpha = left.a ?? 1;
  const rightAlpha = right.a ?? 1;
  return {
    r: left.r + ((right.r - left.r) * t),
    g: left.g + ((right.g - left.g) * t),
    b: left.b + ((right.b - left.b) * t),
    a: leftAlpha + ((rightAlpha - leftAlpha) * t),
  };
}

function addCard(
  container: ScrollContainer2d,
  x: number,
  y: number,
  width: number,
  height: number,
  accent: ColorValue,
  seed: number,
) {
  const group = container.add(new Group2d({
    transform: [1, 0, 0, 1, x, y],
  }));

  const shellColor = mixColor(panelColor, accent, 0.2);
  group.add(new Rect2d({
    width,
    height,
    color: shellColor,
  }));
  group.add(new Rect2d({
    width,
    height: 10,
    color: accent,
  }));
  group.add(new Rect2d({
    x: 18,
    y: 26,
    width: Math.max(72, width * 0.52),
    height: 18,
    color: mixColor(accent, { r: 1, g: 1, b: 1, a: 1 }, 0.12),
  }));
  group.add(new Rect2d({
    x: 18,
    y: 56,
    width: Math.max(96, width - 48),
    height: 8,
    color: mixColor(lineColor, accent, 0.2),
  }));
  group.add(new Rect2d({
    x: 18,
    y: 74,
    width: Math.max(84, width * 0.44),
    height: 8,
    color: mixColor(lineColor, accent, 0.1),
  }));

  const chartBaseY = height - 26;
  const chartBarCount = 7;
  const chartBarGap = 8;
  const chartBarWidth = Math.max(12, (width - 36 - ((chartBarCount - 1) * chartBarGap)) / chartBarCount);
  for (let index = 0; index < chartBarCount; index += 1) {
    const phase = seed + index;
    const ratio = 0.2 + (((Math.sin((phase * 1.37) + seed) + 1) * 0.5) * 0.8);
    const barHeight = 24 + (ratio * (height * 0.34));
    group.add(new Rect2d({
      x: 18 + (index * (chartBarWidth + chartBarGap)),
      y: chartBaseY - barHeight,
      width: chartBarWidth,
      height: barHeight,
      color: mixColor(accent, { r: 1, g: 1, b: 1, a: 1 }, 0.08 + (index * 0.04)),
    }));
  }

  for (let index = 0; index < 3; index += 1) {
    group.add(new Rect2d({
      x: width - 84 + (index * 18),
      y: 24,
      width: 10,
      height: 10,
      color: mixColor(accent, panelInsetColor, 0.3 + (index * 0.2)),
    }));
  }
}

function addContent(container: ScrollContainer2d) {
  container.add(new Rect2d({
    width: contentWidth,
    height: contentHeight,
    color: contentBaseColor,
  }));

  for (let x = 0; x <= contentWidth; x += 80) {
    container.add(new Rect2d({
      x,
      y: 0,
      width: 1,
      height: contentHeight,
      color: contentGridColor,
    }));
  }

  for (let y = 0; y <= contentHeight; y += 80) {
    container.add(new Rect2d({
      x: 0,
      y,
      width: contentWidth,
      height: 1,
      color: contentGridColor,
    }));
  }

  container.add(new Rect2d({
    x: 64,
    y: 72,
    width: 460,
    height: 180,
    color: { r: 0.14, g: 0.18, b: 0.23, a: 1 },
  }));
  container.add(new Rect2d({
    x: 1240,
    y: 880,
    width: 520,
    height: 220,
    color: { r: 0.12, g: 0.16, b: 0.2, a: 1 },
  }));
  container.add(new Rect2d({
    x: 980,
    y: 140,
    width: 620,
    height: 32,
    color: { r: 0.18, g: 0.11, b: 0.09, a: 1 },
  }));
  container.add(new Rect2d({
    x: 1016,
    y: 182,
    width: 540,
    height: 12,
    color: { r: 0.22, g: 0.15, b: 0.11, a: 1 },
  }));

  let seed = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const width = 248 + (((row + column) % 3) * 32);
      const height = 156 + (((row * 2 + column) % 3) * 24);
      const x = 74 + (column * 336) + (row % 2 === 0 ? 0 : 42);
      const y = 94 + (row * 248);
      const accent = cardAccents[(row + column) % cardAccents.length]!;
      addCard(container, x, y, width, height, accent, seed);
      seed += 1;
    }
  }

  for (let index = 0; index < 18; index += 1) {
    const size = 22 + ((index % 5) * 10);
    container.add(new Rect2d({
      x: 1450 + ((index % 3) * 56),
      y: 320 + (index * 38),
      width: size,
      height: size,
      color: mixColor(cardAccents[index % cardAccents.length]!, contentBaseColor, 0.18),
    }));
  }
}

function formatScrollLabel(scrollX: number, scrollY: number) {
  const maxScrollX = contentWidth - viewportWidth;
  const maxScrollY = contentHeight - viewportHeight;
  return `scroll x ${Math.round(scrollX)} / ${maxScrollX}    scroll y ${Math.round(scrollY)} / ${maxScrollY}`;
}

function formatFpsLabel(fps: number) {
  return `${Math.round(fps)} fps`;
}

function rightAlignedTextX(run: ShapedRun, width: number, inset: number) {
  return Math.max(inset, width - inset - Math.max(0, run.advanceX));
}

function mount() {
  const host = createTextHost();
  const bodyFace = matchCandidateTypeface(host, ["Segoe UI", "Calibri", "Arial", "Helvetica"]);
  const monoFace = matchCandidateTypeface(host, ["Cascadia Mono", "Consolas", "Courier New", "Segoe UI"]);
  if (!bodyFace || !monoFace) {
    throw new Error("scroll_container could not resolve required HUD fonts");
  }
  const getBodyRun = createTextRunFactory(host, bodyFace.typeface);
  const getMonoRun = createTextRunFactory(host, monoFace.typeface);

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.05, g: 0.06, b: 0.08, a: 1 },
  }));

  scene.add(new Rect2d({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
    color: panelColor,
  }));
  scene.add(new Rect2d({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: 8,
    color: xFillColor,
  }));
  scene.add(new Rect2d({
    x: viewportX - 18,
    y: viewportY - 18,
    width: viewportWidth + 36,
    height: viewportHeight + 36,
    color: panelInsetColor,
  }));

  const scrollContainer = scene.add(new ScrollContainer2d({
    transform: [1, 0, 0, 1, viewportX, viewportY],
    width: viewportWidth,
    height: viewportHeight,
  })) as ScrollContainer2d;
  addContent(scrollContainer);

  scene.add(new Rect2d({
    x: viewportX - 2,
    y: viewportY - 2,
    width: viewportWidth + 4,
    height: 2,
    color: { r: 0.94, g: 0.95, b: 0.98, a: 0.72 },
  }));
  scene.add(new Rect2d({
    x: viewportX - 2,
    y: viewportY + viewportHeight,
    width: viewportWidth + 4,
    height: 2,
    color: { r: 0.94, g: 0.95, b: 0.98, a: 0.72 },
  }));
  scene.add(new Rect2d({
    x: viewportX - 2,
    y: viewportY,
    width: 2,
    height: viewportHeight,
    color: { r: 0.94, g: 0.95, b: 0.98, a: 0.72 },
  }));
  scene.add(new Rect2d({
    x: viewportX + viewportWidth,
    y: viewportY,
    width: 2,
    height: viewportHeight,
    color: { r: 0.94, g: 0.95, b: 0.98, a: 0.72 },
  }));

  scene.add(createAutoText(
    host,
    getBodyRun("ScrollContainer2d", 34),
    headerX,
    titleY,
    bodyTextColor,
  ));
  scene.add(createAutoText(
    host,
    getBodyRun("A clipped viewport over a much larger retained 2D surface.", 18),
    headerX,
    subtitleLine1Y,
    detailTextColor,
  ));
  scene.add(createAutoText(
    host,
    getBodyRun("No pointer input yet, so this demo drives scrollX and scrollY from requestAnimationFrame.", 16),
    headerX,
    subtitleLine2Y,
    detailTextColor,
  ));
  scene.add(createAutoText(
    host,
    getMonoRun(`viewport ${viewportWidth} x ${viewportHeight}    content ${contentWidth} x ${contentHeight}`, 14),
    headerX,
    subtitleLine3Y,
    detailTextColor,
  ));

  const initialWindowInfo = getWindowInfo();
  const initialFpsRun = getMonoRun(formatFpsLabel(0), 16);
  const fpsText = scene.add(createAutoText(
    host,
    initialFpsRun,
    rightAlignedTextX(initialFpsRun, initialWindowInfo.width, 18),
    22,
    fpsTextColor,
  )) as Text2d;

  const scrollLabel = scene.add(createAutoText(
    host,
    getMonoRun(formatScrollLabel(0, 0), 17),
    footerTrackX,
    scrollLabelY,
    bodyTextColor,
  )) as Text2d;

  scene.add(createAutoText(
    host,
    getBodyRun("horizontal scroll", 13),
    footerTrackX,
    horizontalLabelY,
    detailTextColor,
  ));
  scene.add(createAutoText(
    host,
    getBodyRun("vertical scroll", 13),
    footerTrackX,
    verticalLabelY,
    detailTextColor,
  ));

  const scrollXTrack = scene.add(new Rect2d({
    x: footerTrackX,
    y: horizontalTrackY,
    width: footerTrackWidth,
    height: 10,
    color: xTrackColor,
  })) as Rect2d;
  const scrollXFill = scene.add(new Rect2d({
    x: footerTrackX,
    y: horizontalTrackY,
    width: 0,
    height: 10,
    color: xFillColor,
  })) as Rect2d;
  const scrollYTrack = scene.add(new Rect2d({
    x: footerTrackX,
    y: verticalTrackY,
    width: footerTrackWidth,
    height: 10,
    color: yTrackColor,
  })) as Rect2d;
  const scrollYFill = scene.add(new Rect2d({
    x: footerTrackX,
    y: verticalTrackY,
    width: 0,
    height: 10,
    color: yFillColor,
  })) as Rect2d;
  void scrollXTrack;
  void scrollYTrack;

  let frameHandle = 0;
  let disposed = false;
  let lastScrollLabel = formatScrollLabel(0, 0);
  let lastFrameTimestamp = 0;
  let smoothedDeltaMs = 1000 / 60;
  let displayedFpsLabel = formatFpsLabel(0);
  let displayedFpsX = rightAlignedTextX(initialFpsRun, initialWindowInfo.width, 18);

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }

    const windowInfo = getWindowInfo();
    if (lastFrameTimestamp > 0) {
      const deltaMs = Math.max(1, timestampMs - lastFrameTimestamp);
      smoothedDeltaMs = (smoothedDeltaMs * 0.85) + (deltaMs * 0.15);
    }
    lastFrameTimestamp = timestampMs;

    const maxScrollX = contentWidth - viewportWidth;
    const maxScrollY = contentHeight - viewportHeight;
    const scrollX = ((Math.sin(timestampMs / 1800) + 1) * 0.5) * maxScrollX;
    const scrollY = ((Math.sin((timestampMs / 2300) + 0.9) + 1) * 0.5) * maxScrollY;
    scrollContainer.set({ scrollX, scrollY });

    const nextLabel = formatScrollLabel(scrollX, scrollY);
    if (nextLabel !== lastScrollLabel) {
      lastScrollLabel = nextLabel;
      scrollLabel.set({
        run: getMonoRun(nextLabel, 17),
      });
    }

    scrollXFill.set({
      width: (footerTrackWidth * scrollX) / Math.max(1, maxScrollX),
    });
    scrollYFill.set({
      width: (footerTrackWidth * scrollY) / Math.max(1, maxScrollY),
    });

    const nextFpsLabel = formatFpsLabel(1000 / smoothedDeltaMs);
    const nextFpsRun = getMonoRun(nextFpsLabel, 16);
    const nextFpsX = rightAlignedTextX(nextFpsRun, windowInfo.width, 18);
    if (nextFpsLabel !== displayedFpsLabel || Math.abs(nextFpsX - displayedFpsX) > 0.5) {
      displayedFpsLabel = nextFpsLabel;
      displayedFpsX = nextFpsX;
      fpsText.set({
        run: nextFpsRun,
        x: nextFpsX,
      });
    }

    frameHandle = requestAnimationFrame(tick);
  }

  frameHandle = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      if (frameHandle !== 0) {
        cancelAnimationFrame(frameHandle);
      }
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
