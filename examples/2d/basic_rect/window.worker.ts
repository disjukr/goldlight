import {
  LayoutGroup2d,
  LayoutItem2d,
  Rect2d,
  Scene2d,
  cancelAnimationFrame,
  requestAnimationFrame,
  setWindowScene,
} from "goldlight";

function mount() {
  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 0.06, g: 0.07, b: 0.1, a: 1 },
  }));

  const layout = scene.add(new LayoutGroup2d().setLayout({
    display: "flex",
    width: 520,
    height: 220,
    gap: 24,
    padding: 24,
  }));

  const itemA = layout.add(new LayoutItem2d().setLayout({
    width: 140,
    height: 140,
  }));

  itemA.setContent(new Rect2d({
    color: { r: 0.96, g: 0.47, b: 0.24, a: 1 },
  }));

  const itemB = layout.add(new LayoutItem2d().setLayout({
    width: 180,
    height: 90,
  }));

  itemB.setContent(new Rect2d({
    color: { r: 0.18, g: 0.84, b: 0.58, a: 1 },
  }));

  let frameHandle = 0;
  let disposed = false;

  function tick(timestampMs: number) {
    if (disposed) {
      return;
    }

    itemA.setLayout({
      width: 120 + (Math.sin(timestampMs / 550) * 40 + 40),
      height: 120 + (Math.cos(timestampMs / 700) * 20 + 20),
    });

    itemB.setLayout({
      width: 140 + Math.sin(timestampMs / 400) * 50,
      height: 80 + Math.cos(timestampMs / 500) * 20,
    });

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
