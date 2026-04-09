import {
  Rect2d,
  Scene2d,
  cancelAnimationFrame,
  requestAnimationFrame,
  setWindowScene,
} from "goldlight";

function mount() {
  console.log("goldlight basic_window worker booted");

  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.08, g: 0.09, b: 0.12, a: 1 },
  }));
  const rect = scene.add(new Rect2d({
    x: 320,
    y: 240,
    width: 100,
    height: 100,
    color: { r: 0.25, g: 0.7, b: 0.98, a: 1 },
  }));

  let frameCount = 0;
  let frameHandle = 0;
  let disposed = false;
  const rectHalfSize = 50;

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }

    frameCount += 1;
    const x = 320 - rectHalfSize + Math.cos(timestampMs / 500) * 100;
    const y = 240 - rectHalfSize + Math.sin(timestampMs / 500) * 100;
    rect.set({ x, y });
    frameHandle = requestAnimationFrame(tick);
  }

  frameHandle = requestAnimationFrame(tick);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameHandle);
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
