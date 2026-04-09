import { Rect2d, Scene2d, requestAnimationFrame, setWindowScene } from "goldlight";

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
const rectHalfSize = 50;

function tick(timestampMs: number) {
  frameCount += 1;
  const x = 320 - rectHalfSize + Math.cos(timestampMs / 500) * 100;
  const y = 240 - rectHalfSize + Math.sin(timestampMs / 500) * 100;
  rect.set({ x, y });
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
