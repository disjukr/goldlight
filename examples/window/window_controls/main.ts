import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "goldlight window controls",
  width: 980,
  height: 720,
  resizable: true,
  initialClearColor: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
  workerEntrypoint: windowWorkerEntrypoint,
});
