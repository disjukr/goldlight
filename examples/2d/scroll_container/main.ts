import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d scroll container",
  width: 1280,
  height: 820,
  resizable: true,
  showPolicy: "after-first-paint",
  workerEntrypoint: windowWorkerEntrypoint,
});
