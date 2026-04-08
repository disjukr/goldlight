import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "goldlight basic window",
  width: 640,
  height: 480,
  workerEntrypoint: windowWorkerEntrypoint,
});
