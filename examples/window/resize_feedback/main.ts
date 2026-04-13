import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "goldlight resize feedback",
  width: 960,
  height: 640,
  resizable: true,
  workerEntrypoint: windowWorkerEntrypoint,
});
