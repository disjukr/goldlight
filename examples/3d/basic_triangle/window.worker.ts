import { Scene3d, Triangle3d, requestAnimationFrame, setWindowScene } from "goldlight";

const scene = new Scene3d({
  clearColor: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
  camera: {
    position: [0, 0, 3],
    target: [0, 0, 0],
  },
});

const triangle = scene.add(new Triangle3d({
  positions: [
    [-0.7, -0.6, 0],
    [0.7, -0.6, 0],
    [0, 0.7, 0],
  ],
  color: { r: 0.98, g: 0.73, b: 0.22, a: 1 },
}));

setWindowScene(scene);

function tick(timestampMs: number) {
  const t = timestampMs / 1000;
  triangle.set({
    positions: [
      [-0.7, -0.6 + Math.sin(t) * 0.15, 0],
      [0.7, -0.6 - Math.sin(t * 0.8) * 0.15, 0],
      [Math.sin(t * 0.7) * 0.25, 0.7, Math.cos(t * 0.9) * 0.4],
    ],
  });
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
