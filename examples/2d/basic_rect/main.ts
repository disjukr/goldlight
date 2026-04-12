import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d basic rect",
  width: 640,
  height: 480,
  showPolicy: "after-first-paint",
  workerEntrypoint: windowWorkerEntrypoint,
});
