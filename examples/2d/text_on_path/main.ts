import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d text on path",
  width: 1280,
  height: 760,
  workerEntrypoint: windowWorkerEntrypoint,
});
