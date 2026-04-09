import { requestAnimationFrame } from "goldlight";

console.log("goldlight basic_window worker booted");

let frameCount = 0;

function tick() {
  frameCount += 1;
  if (frameCount <= 3 || frameCount % 60 === 0) {
    console.log("animation frame", frameCount);
  }
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
