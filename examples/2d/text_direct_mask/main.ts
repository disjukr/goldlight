import { createWindow } from "goldlight";
import windowWorkerEntrypoint from "./window.worker.ts?worker";

createWindow({
  title: "2d text direct mask",
  width: 1280,
  height: 760,
  workerEntrypoint: windowWorkerEntrypoint,
});
