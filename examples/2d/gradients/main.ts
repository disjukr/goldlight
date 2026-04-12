import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

const hmrData = import.meta.hot?.data as { windowCreated?: boolean } | undefined;

if (!hmrData?.windowCreated) {
  createWindow({
    title: "2d gradients",
    width: 960,
    height: 720,
    showPolicy: "after-first-paint",
    workerEntrypoint: windowWorkerEntrypoint,
  });
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {});
  import.meta.hot.dispose((data) => {
    data.windowCreated = true;
  });
}
