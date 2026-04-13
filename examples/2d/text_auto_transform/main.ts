import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d auto text transforms",
  width: 1360,
  height: 960,
  showPolicy: "after-first-paint",
  workerEntrypoint: windowWorkerEntrypoint,
});
