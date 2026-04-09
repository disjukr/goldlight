import {
  LayoutGroup3d,
  LayoutItem3d,
  Scene3d,
  Triangle3d,
  addWindowEventListener,
  createOrthographicCamera3d,
  requestAnimationFrame,
  setWindowScene,
} from "goldlight";

const scene = new Scene3d({
  clearColor: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
  camera: createOrthographicCamera3d({ width: 640, height: 480 }),
});

const layout = scene.add(new LayoutGroup3d().setLayout({
  display: "flex",
  width: 640,
  height: 480,
  padding: 24,
}));

const item = layout.add(new LayoutItem3d().setLayout({
  width: 400,
  height: 280,
}));

const triangle = item.setContent(new Triangle3d({
  positions: [
    [120, 320, 0],
    [520, 320, 0],
    [320, 120, 0],
  ],
  color: { r: 0.98, g: 0.73, b: 0.22, a: 1 },
})).getContent() as Triangle3d;

addWindowEventListener("resize", (event) => {
  scene.set({
    camera: createOrthographicCamera3d({
      width: event.width,
      height: event.height,
    }),
  });
});

setWindowScene(scene);

function tick(timestampMs: number) {
  const t = timestampMs / 1000;
  item.setLayout({
    x: 80 + Math.sin(t * 0.7) * 120,
    y: 48 + Math.cos(t * 0.9) * 72,
    width: 400 + Math.sin(t * 0.8) * 40,
    height: 280 + Math.cos(t * 0.6) * 32,
  });
  triangle.set({
    color: { r: 0.98, g: 0.73 + Math.sin(t) * 0.1, b: 0.22, a: 1 },
  });
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
