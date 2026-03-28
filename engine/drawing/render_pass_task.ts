import type { DrawingDrawPass, DrawingPreparedRecording } from './draw_pass.ts';

export type DrawingLoadOp = 'load' | 'clear';

export type DrawingRenderPassTask = Readonly<{
  kind: 'renderPass';
  recorderId: number;
  target: Readonly<{
    kind: 'offscreen';
  }>;
  loadOp: DrawingLoadOp;
  clearColor: readonly [number, number, number, number];
  requiresMSAA: boolean;
  drawPasses: readonly DrawingDrawPass[];
}>;

export const createDrawingRenderPassTask = (
  pass: DrawingPreparedRecording['passes'][number],
): DrawingRenderPassTask => ({
  kind: 'renderPass',
  recorderId: pass.recorderId,
  target: { kind: 'offscreen' },
  loadOp: pass.loadOp,
  clearColor: pass.clearColor,
  requiresMSAA: pass.requiresMSAA,
  drawPasses: Object.freeze([pass]),
});
