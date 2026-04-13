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
  type WindowKeyLocation,
  type WindowKeyDownEvent,
  type WindowKeyUpEvent,
} from "goldlight";
import { matchCandidateTypeface } from "../../2d/text_shared";

type LayoutTextLine = {
  run: ShapedRun;
  width: number;
  height: number;
};

type KeySpec = {
  code: string;
  label: string;
  units: number;
  fontSize?: number;
};

type KeycapView = {
  background: Rect2d;
  label: Text2d;
};

type KeyboardEventPayload = WindowKeyDownEvent | WindowKeyUpEvent;

const BOARD_WIDTH = 1060;
const PANEL_GAP = 22;
const PANEL_PADDING_TOP = 26;
const PANEL_PADDING_RIGHT = 24;
const PANEL_PADDING_BOTTOM = 22;
const PANEL_PADDING_LEFT = 24;
const PANEL_CONTENT_GAP = 10;
const PANEL_TITLE_SIZE = 30;
const PANEL_SUBTITLE_SIZE = 15;
const PANEL_DETAIL_SIZE = 16;
const DETAIL_LINE_COUNT = 5;
const DETAIL_PANEL_HEIGHT =
  PANEL_PADDING_TOP +
  PANEL_PADDING_BOTTOM +
  Math.round(PANEL_TITLE_SIZE * 1.2) +
  Math.round(PANEL_SUBTITLE_SIZE * 1.2) +
  (DETAIL_LINE_COUNT * Math.round(PANEL_DETAIL_SIZE * 1.2)) +
  ((DETAIL_LINE_COUNT + 1) * PANEL_CONTENT_GAP) +
  8;
const KEYBOARD_PANEL_HEIGHT = 404;
const KEY_UNIT = 50;
const KEY_GAP = 10;
const KEY_HEIGHT = 58;
const ROW_GAP = 12;

const COLOR_BACKGROUND = { r: 0.05, g: 0.07, b: 0.1, a: 1 };
const COLOR_PANEL = { r: 0.11, g: 0.14, b: 0.19, a: 1 };
const COLOR_PANEL_SOFT = { r: 0.09, g: 0.12, b: 0.16, a: 1 };
const COLOR_ACCENT = { r: 0.95, g: 0.55, b: 0.25, a: 1 };
const COLOR_TEXT = { r: 0.96, g: 0.97, b: 0.92, a: 1 };
const COLOR_TEXT_DIM = { r: 0.71, g: 0.77, b: 0.86, a: 1 };
const COLOR_KEY_IDLE = { r: 0.16, g: 0.2, b: 0.26, a: 1 };
const COLOR_KEY_ACTIVE = { r: 0.95, g: 0.58, b: 0.28, a: 1 };
const COLOR_KEY_TEXT_ACTIVE = { r: 0.1, g: 0.08, b: 0.06, a: 1 };

const KEY_ROWS: readonly KeySpec[][] = [
  [
    { code: "Escape", label: "Esc", units: 1.2, fontSize: 15 },
    { code: "Digit1", label: "1", units: 1 },
    { code: "Digit2", label: "2", units: 1 },
    { code: "Digit3", label: "3", units: 1 },
    { code: "Digit4", label: "4", units: 1 },
    { code: "Digit5", label: "5", units: 1 },
    { code: "Digit6", label: "6", units: 1 },
    { code: "Digit7", label: "7", units: 1 },
    { code: "Digit8", label: "8", units: 1 },
    { code: "Digit9", label: "9", units: 1 },
    { code: "Digit0", label: "0", units: 1 },
    { code: "Minus", label: "-", units: 1 },
    { code: "Equal", label: "=", units: 1 },
    { code: "Backspace", label: "Backspace", units: 2.1, fontSize: 13 },
  ],
  [
    { code: "Tab", label: "Tab", units: 1.6, fontSize: 15 },
    { code: "KeyQ", label: "Q", units: 1 },
    { code: "KeyW", label: "W", units: 1 },
    { code: "KeyE", label: "E", units: 1 },
    { code: "KeyR", label: "R", units: 1 },
    { code: "KeyT", label: "T", units: 1 },
    { code: "KeyY", label: "Y", units: 1 },
    { code: "KeyU", label: "U", units: 1 },
    { code: "KeyI", label: "I", units: 1 },
    { code: "KeyO", label: "O", units: 1 },
    { code: "KeyP", label: "P", units: 1 },
    { code: "BracketLeft", label: "[", units: 1 },
    { code: "BracketRight", label: "]", units: 1 },
    { code: "Backslash", label: "\\", units: 1.7 },
  ],
  [
    { code: "CapsLock", label: "Caps", units: 1.9, fontSize: 15 },
    { code: "KeyA", label: "A", units: 1 },
    { code: "KeyS", label: "S", units: 1 },
    { code: "KeyD", label: "D", units: 1 },
    { code: "KeyF", label: "F", units: 1 },
    { code: "KeyG", label: "G", units: 1 },
    { code: "KeyH", label: "H", units: 1 },
    { code: "KeyJ", label: "J", units: 1 },
    { code: "KeyK", label: "K", units: 1 },
    { code: "KeyL", label: "L", units: 1 },
    { code: "Semicolon", label: ";", units: 1 },
    { code: "Quote", label: "'", units: 1 },
    { code: "Enter", label: "Enter", units: 2.2, fontSize: 15 },
  ],
  [
    { code: "ShiftLeft", label: "Shift", units: 2.4, fontSize: 15 },
    { code: "KeyZ", label: "Z", units: 1 },
    { code: "KeyX", label: "X", units: 1 },
    { code: "KeyC", label: "C", units: 1 },
    { code: "KeyV", label: "V", units: 1 },
    { code: "KeyB", label: "B", units: 1 },
    { code: "KeyN", label: "N", units: 1 },
    { code: "KeyM", label: "M", units: 1 },
    { code: "Comma", label: ",", units: 1 },
    { code: "Period", label: ".", units: 1 },
    { code: "Slash", label: "/", units: 1 },
    { code: "ShiftRight", label: "Shift", units: 2.8, fontSize: 15 },
  ],
  [
    { code: "ControlLeft", label: "Ctrl", units: 1.5, fontSize: 15 },
    { code: "MetaLeft", label: "Meta", units: 1.5, fontSize: 15 },
    { code: "AltLeft", label: "Alt", units: 1.5, fontSize: 15 },
    { code: "Space", label: "Space", units: 6.4, fontSize: 15 },
    { code: "AltRight", label: "Alt", units: 1.5, fontSize: 15 },
    { code: "MetaRight", label: "Meta", units: 1.5, fontSize: 15 },
    { code: "ArrowLeft", label: "Left", units: 1.2, fontSize: 14 },
    { code: "ArrowDown", label: "Down", units: 1.2, fontSize: 14 },
    { code: "ArrowUp", label: "Up", units: 1.2, fontSize: 14 },
    { code: "ArrowRight", label: "Right", units: 1.2, fontSize: 14 },
  ],
];

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
    throw new Error(`input example could not shape text: ${text}`);
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

function createTextNode(
  item: LayoutItem2d,
  host: TextHost,
  typeface: TypefaceHandle,
  getLine: ReturnType<typeof createLayoutTextLineFactory>,
  text: string,
  size: number,
  color: { r: number; g: number; b: number; a: number },
) {
  return item.setContent(new Text2d({
    kind: "auto",
    host,
    run: getLine(typeface, text, size).run,
    color,
  })).getContent() as Text2d;
}

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatKeyboardValue(value: string) {
  return JSON.stringify(value);
}

function formatKeyLocation(location: WindowKeyLocation) {
  switch (location) {
    case 1:
      return "left";
    case 2:
      return "right";
    case 3:
      return "numpad";
    default:
      return "standard";
  }
}

function formatFpsLabel(fps: number) {
  return `${Math.round(fps)} fps`;
}

function createKeycap(
  row: LayoutGroup2d,
  host: TextHost,
  typeface: TypefaceHandle,
  getLine: ReturnType<typeof createLayoutTextLineFactory>,
  spec: KeySpec,
) {
  const width = Math.round(spec.units * KEY_UNIT);
  const item = row.add(new LayoutItem2d().setLayout({
    width,
    height: KEY_HEIGHT,
  }));

  const frame = new LayoutGroup2d().setLayout({
    width,
    height: KEY_HEIGHT,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  });
  item.setContent(frame);

  const backgroundItem = frame.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width,
    height: KEY_HEIGHT,
  }));
  const background = backgroundItem.setContent(new Rect2d({
    color: COLOR_KEY_IDLE,
  })).getContent() as Rect2d;

  const labelItem = frame.add(new LayoutItem2d());
  const label = createTextNode(
    labelItem,
    host,
    typeface,
    getLine,
    spec.label,
    spec.fontSize ?? 17,
    COLOR_TEXT,
  );

  return { background, label } satisfies KeycapView;
}

function mount() {
  const initialWindowInfo = getWindowInfo();
  const host = createTextHost();

  const face = matchCandidateTypeface(host, ["Segoe UI", "Calibri", "Arial", "Helvetica"]);
  if (!face) {
    throw new Error("input example could not resolve a UI typeface");
  }

  const monoFace = matchCandidateTypeface(
    host,
    ["Cascadia Mono", "Consolas", "Courier New", face.family],
  );

  const uiTypeface = face.typeface;
  const monoTypeface = monoFace?.typeface ?? uiTypeface;
  const hudTypeface = monoTypeface;
  const getLine = createLayoutTextLineFactory(host);

  const scene = setWindowScene(new Scene2d({
    clearColor: COLOR_BACKGROUND,
  }));

  const root = scene.add(new LayoutGroup2d().setLayout({
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: PANEL_GAP,
    padding: 24,
  }));

  const backdropItem = root.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: initialWindowInfo.width,
    height: initialWindowInfo.height,
  }));
  backdropItem.setContent(new Rect2d({
    color: COLOR_BACKGROUND,
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

  const detailPanelItem = root.add(new LayoutItem2d().setLayout({
    width: BOARD_WIDTH,
    height: DETAIL_PANEL_HEIGHT,
  }));
  const detailPanel = new LayoutGroup2d().setLayout({
    width: BOARD_WIDTH,
    height: DETAIL_PANEL_HEIGHT,
    display: "flex",
    flexDirection: "column",
    gap: PANEL_CONTENT_GAP,
    paddingTop: PANEL_PADDING_TOP,
    paddingRight: PANEL_PADDING_RIGHT,
    paddingBottom: PANEL_PADDING_BOTTOM,
    paddingLeft: PANEL_PADDING_LEFT,
  });
  detailPanelItem.setContent(detailPanel);

  const detailBackgroundItem = detailPanel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: BOARD_WIDTH,
    height: DETAIL_PANEL_HEIGHT,
  }));
  detailBackgroundItem.setContent(new Rect2d({
    color: COLOR_PANEL,
  }));

  const detailAccentItem = detailPanel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: BOARD_WIDTH,
    height: 8,
  }));
  detailAccentItem.setContent(new Rect2d({
    color: COLOR_ACCENT,
  }));

  const titleItem = detailPanel.add(new LayoutItem2d());
  createTextNode(
    titleItem,
    host,
    uiTypeface,
    getLine,
    "Keyboard Input Inspector",
    PANEL_TITLE_SIZE,
    COLOR_TEXT,
  );

  const subtitleItem = detailPanel.add(new LayoutItem2d());
  createTextNode(
    subtitleItem,
    host,
    monoTypeface,
    getLine,
    "Highlights follow physical event.code values. Hold multiple keys to inspect rollover.",
    PANEL_SUBTITLE_SIZE,
    COLOR_TEXT_DIM,
  );

  const detailLineItems = Array.from({ length: 5 }, () => detailPanel.add(new LayoutItem2d()));
  const detailTexts = detailLineItems.map((item, index) => createTextNode(
    item,
    host,
    monoTypeface,
    getLine,
    index === 0 ? "window: loading" : "",
    PANEL_DETAIL_SIZE,
    index === 0 ? COLOR_TEXT : COLOR_TEXT_DIM,
  ));
  const detailValues = new Array(detailTexts.length).fill("");

  const keyboardPanelItem = root.add(new LayoutItem2d().setLayout({
    width: BOARD_WIDTH,
    height: KEYBOARD_PANEL_HEIGHT,
  }));
  const keyboardPanel = new LayoutGroup2d().setLayout({
    width: BOARD_WIDTH,
    height: KEYBOARD_PANEL_HEIGHT,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: ROW_GAP,
    paddingTop: 20,
    paddingRight: 18,
    paddingBottom: 20,
    paddingLeft: 18,
  });
  keyboardPanelItem.setContent(keyboardPanel);

  const keyboardBackgroundItem = keyboardPanel.add(new LayoutItem2d().setLayout({
    position: "absolute",
    x: 0,
    y: 0,
    width: BOARD_WIDTH,
    height: KEYBOARD_PANEL_HEIGHT,
  }));
  keyboardBackgroundItem.setContent(new Rect2d({
    color: COLOR_PANEL_SOFT,
  }));

  const keycaps = new Map<string, KeycapView>();

  for (const rowSpec of KEY_ROWS) {
    const row = keyboardPanel.add(new LayoutGroup2d().setLayout({
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      gap: KEY_GAP,
    }));
    for (const spec of rowSpec) {
      keycaps.set(spec.code, createKeycap(row, host, monoTypeface, getLine, spec));
    }
  }

  let lastKeyboardEvent: KeyboardEventPayload | null = null;
  const pressedCodes = new Set<string>();
  let lastFrameTimestamp = 0;
  let smoothedDeltaMs = 1000 / 60;
  let displayedFpsLabel = formatFpsLabel(0);
  let frameHandle = 0;
  let disposed = false;

  function setDetailLine(index: number, text: string) {
    if (detailValues[index] === text) {
      return;
    }
    detailValues[index] = text;
    detailTexts[index]!.set({
      run: getLine(monoTypeface, text, PANEL_DETAIL_SIZE).run,
    });
  }

  function updateLayoutFromWindow() {
    const windowInfo = getWindowInfo();
    root.setLayout({
      width: windowInfo.width,
      height: windowInfo.height,
    });
    backdropItem.setLayout({
      width: windowInfo.width,
      height: windowInfo.height,
    });
    hudOverlay.setLayout({
      width: windowInfo.width,
      height: windowInfo.height,
    });
    root.flushLayout();
  }

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }
    if (lastFrameTimestamp > 0) {
      const deltaMs = Math.max(1, timestampMs - lastFrameTimestamp);
      smoothedDeltaMs = (smoothedDeltaMs * 0.85) + (deltaMs * 0.15);
      const nextLabel = formatFpsLabel(1000 / smoothedDeltaMs);
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

  function updateInspector(mappedCode: boolean) {
    const windowInfo = getWindowInfo();
    const pressedSummary = clampText(
      [...pressedCodes].join(", ") || "none",
      104,
    );

    setDetailLine(
      0,
      `window: ${windowInfo.title} | ${windowInfo.width} x ${windowInfo.height} | resizable=${windowInfo.resizable}`,
    );

    if (!lastKeyboardEvent) {
      setDetailLine(1, "last event: (none yet)");
      setDetailLine(2, "location: standard (0) | repeat: false");
      setDetailLine(3, "modifiers: shift=false ctrl=false alt=false meta=false");
      setDetailLine(4, `pressed (0): ${pressedSummary}`);
      return;
    }

    setDetailLine(
      1,
      `last event: ${lastKeyboardEvent.type} | code: ${lastKeyboardEvent.code} | key: ${formatKeyboardValue(lastKeyboardEvent.key)}`,
    );
    setDetailLine(
      2,
      `location: ${formatKeyLocation(lastKeyboardEvent.location)} (${lastKeyboardEvent.location}) | repeat: ${lastKeyboardEvent.repeat}`,
    );
    setDetailLine(
      3,
      `modifiers: shift=${lastKeyboardEvent.shiftKey} ctrl=${lastKeyboardEvent.ctrlKey} alt=${lastKeyboardEvent.altKey} meta=${lastKeyboardEvent.metaKey} | mapped=${mappedCode}`,
    );
    setDetailLine(4, `pressed (${pressedCodes.size}): ${pressedSummary}`);
  }

  function setKeycapPressed(code: string, pressed: boolean) {
    const keycap = keycaps.get(code);
    if (!keycap) {
      return false;
    }
    keycap.background.set({
      color: pressed ? COLOR_KEY_ACTIVE : COLOR_KEY_IDLE,
    });
    keycap.label.set({
      color: pressed ? COLOR_KEY_TEXT_ACTIVE : COLOR_TEXT,
    });
    return true;
  }

  function handleKeyboardEvent(event: KeyboardEventPayload) {
    lastKeyboardEvent = event;
    if (event.type === "keydown") {
      pressedCodes.add(event.code);
    } else {
      pressedCodes.delete(event.code);
    }
    const mappedCode = setKeycapPressed(event.code, event.type === "keydown");
    updateInspector(mappedCode);
  }

  updateLayoutFromWindow();
  updateInspector(false);
  frameHandle = requestAnimationFrame(tick);

  addWindowEventListener("resize", () => {
    updateLayoutFromWindow();
    updateInspector(lastKeyboardEvent !== null && keycaps.has(lastKeyboardEvent.code));
  });
  addWindowEventListener("keydown", handleKeyboardEvent);
  addWindowEventListener("keyup", handleKeyboardEvent);

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
