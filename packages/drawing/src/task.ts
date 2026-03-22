import type { DrawingPreparedRecording } from './draw_pass.ts';
import {
  createDrawingRenderPassTask,
  type DrawingRenderPassTask,
} from './render_pass_task.ts';

export type DrawingTask = DrawingRenderPassTask;

export type DrawingTaskList = Readonly<{
  tasks: readonly DrawingTask[];
}>;

export const createDrawingTaskList = (
  prepared: DrawingPreparedRecording,
): DrawingTaskList => ({
  tasks: Object.freeze(prepared.passes.map((pass) => createDrawingRenderPassTask(pass))),
});
