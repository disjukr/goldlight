import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

const hmrData = import.meta.hot?.data as { windowCreated?: boolean } | undefined;

if (!hmrData?.windowCreated) {
  createWindow({
    title: "2d strokes",
    width: 680,
    height: 940,
    workerEntrypoint: windowWorkerEntrypoint,
  });
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {});
  import.meta.hot.dispose((data) => {
    data.windowCreated = true;
  });
}
