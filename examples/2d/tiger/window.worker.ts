import {
  cancelAnimationFrame,
  createTextHost,
  Group2d,
  Path2d,
  Scene2d,
  Text2d,
  parseSvgPaths,
  requestAnimationFrame,
  setWindowScene,
} from "goldlight";
import { matchCandidateTypeface } from "../text_shared";
import tigerSvgSource from "./tiger.svg?raw";

function formatFpsLabel(fps: number) {
  return `${Math.round(fps)} fps`;
}

function createTextRunFactory(host: ReturnType<typeof createTextHost>, typeface: bigint) {
  const cache = new Map<string, ReturnType<typeof host.shapeText>>();
  return (text: string, size: number) => {
    const key = `${size}:${text}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const run = host.shapeText({ typeface, text, size });
    if (!run) {
      throw new Error(`tiger example could not shape text: ${text}`);
    }
    cache.set(key, run);
    return run;
  };
}

function mount() {
  const parsed = parseSvgPaths(tigerSvgSource);
  const host = createTextHost();
  const face = matchCandidateTypeface(host, ["Cascadia Mono", "Consolas", "Courier New", "Segoe UI", "Arial"]);
  if (!face) {
    throw new Error("tiger example could not resolve a HUD typeface");
  }
  const getRun = createTextRunFactory(host, face.typeface);

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 1, g: 1, b: 1, a: 1 },
  }));

  const tigerGroup = scene.add(new Group2d({
    cacheAsRaster: true,
  })) as Group2d;
  for (const path of parsed.paths) {
    tigerGroup.add(new Path2d(path));
  }

  const fpsText = scene.add(new Text2d({
    kind: "auto",
    host,
    x: 16,
    y: 20,
    run: getRun(formatFpsLabel(0), 16),
    color: { r: 0.08, g: 0.1, b: 0.14, a: 1 },
  })) as Text2d;

  const modeText = scene.add(new Text2d({
    kind: "auto",
    host,
    x: 16,
    y: 42,
    run: getRun("tiger group cacheAsRaster=true | resize window to inspect behavior", 14),
    color: { r: 0.34, g: 0.39, b: 0.47, a: 1 },
  })) as Text2d;

  let lastFrameTimestamp = 0;
  let smoothedDeltaMs = 1000 / 60;
  let displayedFpsLabel = formatFpsLabel(0);
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
          run: getRun(nextLabel, 16),
        });
      }
    }

    lastFrameTimestamp = timestampMs;
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
      void modeText;
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
