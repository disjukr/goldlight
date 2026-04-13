import {
  LayoutGroup2d,
  LayoutItem2d,
  Rect2d,
  Scene2d,
  Text2d,
  addWindowEventListener,
  cancelAnimationFrame,
  createTextHost,
  getWindowInfo,
  requestAnimationFrame,
  setWindowScene,
  type ShapedRun,
  type TextHost,
  type TypefaceHandle,
} from "goldlight";
import { matchCandidateTypeface } from "../../2d/text_shared";

type LayoutTextLine = {
  run: ShapedRun;
  width: number;
  height: number;
};

function shapeLine(
  host: TextHost,
  typeface: TypefaceHandle,
  text: string,
  size: number,
): ShapedRun {
  const run = host.shapeText({
    typeface,
    text,
    size,
    language: "en",
  });
  if (!run) {
    throw new Error(`resize_feedback could not shape text: ${text}`);
  }
  return run;
}

function createLayoutTextLine(
  host: TextHost,
  typeface: TypefaceHandle,
  text: string,
  size: number,
): LayoutTextLine {
  const source = shapeLine(host, typeface, text, size);
  const lineHeight = Math.max(1, Math.round(size * 1.2));
  const baseline = Math.round(lineHeight * 0.82);
  const positions = new Float32Array(source.positions);
  for (let index = 1; index < positions.length; index += 2) {
    positions[index] += baseline;
  }
  return {
    run: {
      ...source,
      positions,
    },
    width: Math.max(1, Math.ceil(source.advanceX)),
    height: lineHeight,
  };
}

function createLayoutTextLineFactory(host: TextHost) {
  const cache = new Map<string, LayoutTextLine>();
  return (typeface: TypefaceHandle, text: string, size: number) => {
    const key = `${typeface.toString()}:${size}:${text}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const line = createLayoutTextLine(host, typeface, text, size);
    cache.set(key, line);
    return line;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatFpsLabel(fps: number) {
  return `${Math.round(fps)} fps`;
}

function mount() {
  const initialWindowInfo = getWindowInfo();
  const host = createTextHost();
  const face = matchCandidateTypeface(host, ["Segoe UI", "Calibri", "Arial", "Helvetica"]);
  if (!face) {
    throw new Error("resize_feedback could not resolve a UI typeface");
  }
  const typeface = face.typeface;
  const hudFace = matchCandidateTypeface(host, ["Cascadia Mono", "Consolas", "Courier New", face.family]);
  const hudTypeface = hudFace?.typeface ?? typeface;
  const getLine = createLayoutTextLineFactory(host);

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.06, g: 0.08, b: 0.11, a: 1 },
  }));

  const root = scene.add(new LayoutGroup2d().setLayout({
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
  }));

  const backdropItem = root.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
  }));
  backdropItem.setContent(new Rect2d({
    color: { r: 0.06, g: 0.08, b: 0.11, a: 1 },
  }));

  const overlay = root.add(new LayoutGroup2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  }));

  const hudOverlay = root.add(new LayoutGroup2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
    display: "flex",
    justifyContent: "end",
    alignItems: "start",
    paddingTop: 16,
    paddingRight: 18,
  }));

  const fpsItem = hudOverlay.add(new LayoutItem2d());
  const fpsText = fpsItem.setContent(new Text2d({
    kind: "auto",
    host,
    run: getLine(hudTypeface, formatFpsLabel(0), 16).run,
    color: { r: 0.96, g: 0.8, b: 0.47, a: 1 },
  })).getContent() as Text2d;

  const panelItem = overlay.add(new LayoutItem2d().setLayout({
    width: 720,
    height: 320,
  }));

  const panel = new LayoutGroup2d().setLayout({
    width: 720,
    height: 320,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    paddingTop: 34,
    paddingBottom: 28,
  });
  panelItem.setContent(panel);

  const panelBackground = panel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: 720,
    height: 320,
  }));
  panelBackground.setContent(new Rect2d({
    color: { r: 0.11, g: 0.14, b: 0.19, a: 1 },
  }));

  const accentBar = panel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: 720,
    height: 10,
  }));
  accentBar.setContent(new Rect2d({
    color: { r: 0.94, g: 0.56, b: 0.24, a: 1 },
  }));

  const labelItem = panel.add(new LayoutItem2d().setLayout({
    marginBottom: 2,
  }));
  const labelLine = getLine(typeface, "Window Resize", 26);
  const labelText = labelItem.setContent(new Text2d({
    kind: "auto",
    host,
    run: labelLine.run,
    color: { r: 0.69, g: 0.75, b: 0.84, a: 1 },
  })).getContent() as Text2d;

  const valueItem = panel.add(new LayoutItem2d());
  const initialValueSize = clamp(
    Math.round(Math.min(initialWindowInfo.width, initialWindowInfo.height) * 0.12),
    44,
    92,
  );
  const initialValueLine = getLine(
    typeface,
    `${initialWindowInfo.width} x ${initialWindowInfo.height}`,
    initialValueSize,
  );
  const valueText = valueItem.setContent(new Text2d({
    kind: "auto",
    host,
    run: initialValueLine.run,
    color: { r: 0.98, g: 0.97, b: 0.92, a: 1 },
  })).getContent() as Text2d;

  const noteItem = panel.add(new LayoutItem2d().setLayout({
    marginTop: 4,
  }));
  const noteLine = getLine(typeface, "layout-driven live resize", 18);
  const noteText = noteItem.setContent(new Text2d({
    kind: "auto",
    host,
    run: noteLine.run,
    color: { r: 0.79, g: 0.84, b: 0.91, a: 1 },
  })).getContent() as Text2d;

  let lastFrameTimestamp = 0;
  let smoothedDeltaMs = 1000 / 60;
  let displayedFpsLabel = formatFpsLabel(0);
  let displayedValueKey = `${initialWindowInfo.width}x${initialWindowInfo.height}:${initialValueSize}`;
  let lightValueColor = false;
  let frameHandle = 0;
  let disposed = false;

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }
    if (lastFrameTimestamp > 0) {
      const deltaMs = Math.max(1, timestampMs - lastFrameTimestamp);
      smoothedDeltaMs = (smoothedDeltaMs * 0.85) + (deltaMs * 0.15);
      const fps = 1000 / smoothedDeltaMs;
      const nextLabel = formatFpsLabel(fps);
      if (nextLabel !== displayedFpsLabel) {
        displayedFpsLabel = nextLabel;
        fpsText.set({
          run: getLine(hudTypeface, nextLabel, 16).run,
        });
      }
    }
    lastFrameTimestamp = timestampMs;
    frameHandle = requestAnimationFrame(tick);
  }

  function updateLayout(width: number, height: number) {
    root.setLayout({ width, height });
    backdropItem.setLayout({ width, height });
    overlay.setLayout({ width, height });
    hudOverlay.setLayout({ width, height });

    const panelWidth = clamp(Math.round(width * 0.68), 420, 820);
    const panelHeight = clamp(Math.round(height * 0.34), 220, 360);
    const panelGap = clamp(Math.round(panelHeight * 0.06), 14, 24);

    panelItem.setLayout({
      width: panelWidth,
      height: panelHeight,
    });
    panel.setLayout({
      width: panelWidth,
      height: panelHeight,
      gap: panelGap,
      paddingTop: clamp(Math.round(panelHeight * 0.12), 26, 40),
      paddingBottom: clamp(Math.round(panelHeight * 0.09), 20, 34),
    });
    panelBackground.setLayout({
      width: panelWidth,
      height: panelHeight,
    });
    accentBar.setLayout({
      width: panelWidth,
    });

    const dynamicSize = clamp(Math.round(Math.min(width, height) * 0.12), 44, 92);
    const valueLabel = `${width} x ${height}`;
    const valueKey = `${width}x${height}:${dynamicSize}`;
    if (valueKey !== displayedValueKey) {
      displayedValueKey = valueKey;
      valueText.set({
        run: getLine(typeface, valueLabel, dynamicSize).run,
      });
    }
    const nextLightValueColor = dynamicSize < 72;
    if (nextLightValueColor !== lightValueColor) {
      lightValueColor = nextLightValueColor;
      valueText.set({
        color: lightValueColor
          ? { r: 0.9, g: 0.95, b: 0.99, a: 1 }
          : { r: 0.98, g: 0.97, b: 0.92, a: 1 },
      });
    }

    root.flushLayout();
  }

  function updateLayoutFromWindow() {
    const windowInfo = getWindowInfo();
    updateLayout(windowInfo.width, windowInfo.height);
  }

  updateLayoutFromWindow();
  frameHandle = requestAnimationFrame(tick);

  addWindowEventListener("resize", () => {
    updateLayoutFromWindow();
  });

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
