import type { Path2D } from '@rieul3d/geometry';
import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand, DrawingSubmission } from './types.ts';

export type DrawingRecording = Readonly<{
  backend: DrawingSubmission['backend'];
  recorderId: number;
  commandCount: number;
  commands: readonly DrawingCommand[];
}>;

const cloneCommand = (command: DrawingCommand): DrawingCommand => {
  const clonePath = (path: Path2D | undefined): Path2D | undefined =>
    path
      ? {
        verbs: path.verbs.map((verb) => ({ ...verb })),
        fillRule: path.fillRule,
      }
      : undefined;
  switch (command.kind) {
    case 'clear':
      return {
        kind: 'clear',
        color: [...command.color] as [number, number, number, number],
      };
    case 'drawPath':
      return {
        kind: 'drawPath',
        path: clonePath(command.path)!,
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipRect: command.clipRect
          ? {
            origin: [...command.clipRect.origin] as typeof command.clipRect.origin,
            size: { ...command.clipRect.size },
          }
          : undefined,
        clipPath: clonePath(command.clipPath),
      };
    case 'drawShape':
      return {
        kind: 'drawShape',
        shape: structuredClone(command.shape),
        path: clonePath(command.path)!,
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipRect: command.clipRect
          ? {
            origin: [...command.clipRect.origin] as typeof command.clipRect.origin,
            size: { ...command.clipRect.size },
          }
          : undefined,
        clipPath: clonePath(command.clipPath),
      };
  }
};

export const createDrawingRecording = (
  sharedContext: DawnSharedContext,
  recorderId: number,
  commands: readonly DrawingCommand[],
): DrawingRecording => {
  const clonedCommands = commands.map((command) => cloneCommand(command));

  return {
    backend: sharedContext.backend.kind,
    recorderId,
    commandCount: clonedCommands.length,
    commands: Object.freeze(clonedCommands),
  };
};
