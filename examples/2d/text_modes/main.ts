import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d text modes",
  width: 1280,
  height: 960,
  workerEntrypoint: windowWorkerEntrypoint,
});
