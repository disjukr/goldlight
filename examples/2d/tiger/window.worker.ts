import { Path2d, Scene2d, parseSvgPaths, setWindowScene } from "goldlight";
import tigerSvgSource from "./tiger.svg?raw";

function mount() {
  const parsed = parseSvgPaths(tigerSvgSource);
  const scene = setWindowScene(new Scene2d({
    clearColor: { r: 1, g: 1, b: 1, a: 1 },
  }));

  for (const path of parsed.paths) {
    scene.add(new Path2d(path));
  }

  return {
    dispose() {},
  };
}

const app = mount();

if (import.meta.hot) {
  import.meta.hot.accept(() => {});
  import.meta.hot.dispose(() => {
    app.dispose();
  });
}
