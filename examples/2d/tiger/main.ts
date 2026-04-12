import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d tiger",
  width: 900,
  height: 900,
  showPolicy: "after-first-paint",
  workerEntrypoint: windowWorkerEntrypoint,
});
