import { Rect2d, Scene2d, requestAnimationFrame, setWindowScene } from "goldlight";

const scene = setWindowScene(new Scene2d({
  clearColor: { r: 0.06, g: 0.07, b: 0.1, a: 1 },
}));

const rectA = scene.add(new Rect2d({
  x: 40,
  y: 60,
  width: 140,
  height: 140,
  color: { r: 0.96, g: 0.47, b: 0.24, a: 1 },
}));

const rectB = scene.add(new Rect2d({
  x: 260,
  y: 220,
  width: 180,
  height: 90,
  color: { r: 0.18, g: 0.84, b: 0.58, a: 1 },
}));

function tick(timestampMs: number) {
  rectA.set({
    x: 80 + Math.sin(timestampMs / 550) * 120,
    y: 70 + Math.cos(timestampMs / 700) * 40,
  });

  rectB.set({
    width: 140 + Math.sin(timestampMs / 400) * 50,
  });

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
