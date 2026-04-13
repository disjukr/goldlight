import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "goldlight keyboard input",
  width: 1280,
  height: 760,
  workerEntrypoint: windowWorkerEntrypoint,
});
