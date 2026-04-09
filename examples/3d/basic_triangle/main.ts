import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "3d basic triangle",
  width: 640,
  height: 480,
  workerEntrypoint: windowWorkerEntrypoint,
});
