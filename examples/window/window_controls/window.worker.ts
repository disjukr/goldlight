import {
  LayoutGroup2d,
  LayoutItem2d,
  Rect2d,
  Scene2d,
  Text2d,
  addWindowEventListener,
  createTextHost,
  getWindowInfo,
  setWindowInfo,
  setWindowScene,
  type ShapedRun,
  type TextHost,
  type TypefaceHandle,
  type WindowInfo,
  type WindowStyle,
} from "goldlight";
import { matchCandidateTypeface } from "../../2d/text_shared";

type LayoutTextLine = {
  run: ShapedRun;
  width: number;
  height: number;
};

type FixedTextLine = {
  node: Text2d;
  size: number;
  value: string;
};

const MOVE_STEP = 30;
const RESIZE_STEP = 30;
const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 240;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
    throw new Error(`window_controls could not shape text: ${text}`);
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

function setFixedLineText(
  line: FixedTextLine,
  typeface: TypefaceHandle,
  text: string,
  getLine: ReturnType<typeof createLayoutTextLineFactory>,
) {
  if (line.value === text) {
    return;
  }
  line.value = text;
  line.node.set({
    run: getLine(typeface, text, line.size).run,
  });
}

function createFixedLine(
  parent: LayoutGroup2d,
  host: TextHost,
  typeface: TypefaceHandle,
  getLine: ReturnType<typeof createLayoutTextLineFactory>,
  text: string,
  size: number,
  color: { r: number; g: number; b: number; a: number },
) {
  const item = parent.add(new LayoutItem2d());
  const node = item.setContent(new Text2d({
    kind: "auto",
    host,
    run: getLine(typeface, text, size).run,
    color,
  })).getContent() as Text2d;
  return {
    item,
    line: {
      node,
      size,
      value: text,
    },
  };
}

function formatWindowPosition(value: number | null) {
  return value === null ? "unavailable" : `${value}`;
}

function formatClearColor(info: WindowInfo) {
  const { r, g, b, a } = info.initialClearColor;
  return `${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)}, ${a.toFixed(2)}`;
}

function buildWindowInfoLines(info: WindowInfo) {
  return [
    `title: ${info.title}`,
    `style: ${info.style}`,
    `position: ${formatWindowPosition(info.x)}, ${formatWindowPosition(info.y)}`,
    `size: ${info.width} x ${info.height}`,
    `resizable: ${info.resizable}`,
    `initial clear: ${formatClearColor(info)}`,
  ];
}

function nextWindowPatch(info: WindowInfo, code: string, shiftKey: boolean) {
  if (code === "Enter") {
    const nextStyle: WindowStyle = info.style === "fullscreen" ? "default" : "fullscreen";
    return { style: nextStyle };
  }

  if (shiftKey) {
    switch (code) {
      case "ArrowLeft":
        return { width: Math.max(MIN_WINDOW_WIDTH, info.width - RESIZE_STEP) };
      case "ArrowRight":
        return { width: info.width + RESIZE_STEP };
      case "ArrowUp":
        return { height: Math.max(MIN_WINDOW_HEIGHT, info.height - RESIZE_STEP) };
      case "ArrowDown":
        return { height: info.height + RESIZE_STEP };
      default:
        return null;
    }
  }

  const x = info.x ?? 0;
  const y = info.y ?? 0;
  switch (code) {
    case "ArrowLeft":
      return { x: x - MOVE_STEP };
    case "ArrowRight":
      return { x: x + MOVE_STEP };
    case "ArrowUp":
      return { y: y - MOVE_STEP };
    case "ArrowDown":
      return { y: y + MOVE_STEP };
    default:
      return null;
  }
}

function mount() {
  const initialWindowInfo = getWindowInfo();
  const host = createTextHost();
  const bodyFace = matchCandidateTypeface(host, ["Segoe UI", "Calibri", "Arial", "Helvetica"]);
  if (!bodyFace) {
    throw new Error("window_controls could not resolve a UI typeface");
  }
  const monoFace = matchCandidateTypeface(host, ["Cascadia Mono", "Consolas", "Courier New", bodyFace.family]);
  const bodyTypeface = bodyFace.typeface;
  const monoTypeface = monoFace?.typeface ?? bodyTypeface;
  const getLine = createLayoutTextLineFactory(host);

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
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
    color: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
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

  const panelItem = overlay.add(new LayoutItem2d().setLayout({
    width: 780,
    height: 460,
  }));

  const panel = new LayoutGroup2d().setLayout({
    width: 780,
    height: 460,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    paddingTop: 34,
    paddingBottom: 28,
  });
  panelItem.setContent(panel);

  const panelBackground = panel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: 780,
    height: 460,
  }));
  panelBackground.setContent(new Rect2d({
    color: { r: 0.1, g: 0.13, b: 0.18, a: 1 },
  }));

  const accentBar = panel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: 780,
    height: 10,
  }));
  accentBar.setContent(new Rect2d({
    color: { r: 0.35, g: 0.79, b: 0.93, a: 1 },
  }));

  createFixedLine(
    panel,
    host,
    bodyTypeface,
    getLine,
    "Window Controls",
    30,
    { r: 0.97, g: 0.96, b: 0.92, a: 1 },
  );
  createFixedLine(
    panel,
    host,
    bodyTypeface,
    getLine,
    "Press Enter or the arrow keys to mutate native window state.",
    18,
    { r: 0.73, g: 0.79, b: 0.87, a: 1 },
  );

  const controlsSection = panel.add(new LayoutGroup2d().setLayout({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  }));
  createFixedLine(
    controlsSection,
    host,
    monoTypeface,
    getLine,
    "Usage",
    18,
    { r: 0.99, g: 0.76, b: 0.43, a: 1 },
  );
  createFixedLine(
    controlsSection,
    host,
    monoTypeface,
    getLine,
    "Enter: toggle default / fullscreen",
    20,
    { r: 0.89, g: 0.92, b: 0.96, a: 1 },
  );
  createFixedLine(
    controlsSection,
    host,
    monoTypeface,
    getLine,
    "Arrow keys: move window position by 30 px",
    20,
    { r: 0.89, g: 0.92, b: 0.96, a: 1 },
  );
  createFixedLine(
    controlsSection,
    host,
    monoTypeface,
    getLine,
    "Shift + Arrow keys: resize width / height by 30 px",
    20,
    { r: 0.89, g: 0.92, b: 0.96, a: 1 },
  );

  const infoSection = panel.add(new LayoutGroup2d().setLayout({
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  }));
  createFixedLine(
    infoSection,
    host,
    monoTypeface,
    getLine,
    "Window Info",
    18,
    { r: 0.99, g: 0.76, b: 0.43, a: 1 },
  );

  const infoLines = buildWindowInfoLines(initialWindowInfo).map((text) =>
    createFixedLine(
      infoSection,
      host,
      monoTypeface,
      getLine,
      text,
      20,
      { r: 0.97, g: 0.97, b: 0.94, a: 1 },
    ).line,
  );

  function updateLayout(width: number, height: number) {
    root.setLayout({ width, height });
    backdropItem.setLayout({ width, height });
    overlay.setLayout({ width, height });

    const panelWidth = clamp(Math.round(width * 0.76), 560, 940);
    const panelHeight = clamp(Math.round(height * 0.68), 400, 560);
    panelItem.setLayout({
      width: panelWidth,
      height: panelHeight,
    });
    panel.setLayout({
      width: panelWidth,
      height: panelHeight,
      gap: clamp(Math.round(panelHeight * 0.03), 12, 18),
      paddingTop: clamp(Math.round(panelHeight * 0.08), 28, 40),
      paddingBottom: clamp(Math.round(panelHeight * 0.07), 24, 34),
    });
    panelBackground.setLayout({
      width: panelWidth,
      height: panelHeight,
    });
    accentBar.setLayout({ width: panelWidth });
    root.flushLayout();
  }

  function syncFromWindowInfo() {
    const info = getWindowInfo();
    const nextLines = buildWindowInfoLines(info);
    for (let index = 0; index < infoLines.length; index += 1) {
      const line = infoLines[index];
      const text = nextLines[index];
      if (!line || !text) {
        continue;
      }
      setFixedLineText(line, monoTypeface, text, getLine);
    }
    updateLayout(info.width, info.height);
  }

  function handleKeyDown(event: { code: string; shiftKey: boolean; repeat: boolean }) {
    if (event.code === "Enter" && event.repeat) {
      return;
    }

    const info = getWindowInfo();
    const patch = nextWindowPatch(info, event.code, event.shiftKey);
    if (!patch) {
      return;
    }

    setWindowInfo(patch);
    syncFromWindowInfo();
  }

  syncFromWindowInfo();

  addWindowEventListener("resize", () => {
    syncFromWindowInfo();
  });
  addWindowEventListener("move", () => {
    syncFromWindowInfo();
  });
  addWindowEventListener("keydown", handleKeyDown);

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
