import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d text glyph clusters",
  width: 1280,
  height: 720,
  workerEntrypoint: windowWorkerEntrypoint,
});
