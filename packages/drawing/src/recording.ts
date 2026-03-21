import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand, DrawingSubmission } from './types.ts';

export type DrawingRecording = Readonly<{
  backend: DrawingSubmission['backend'];
  recorderId: number;
  commandCount: number;
  commands: readonly DrawingCommand[];
}>;

const cloneCommand = (command: DrawingCommand): DrawingCommand => {
  switch (command.kind) {
    case 'clear':
      return {
        kind: 'clear',
        color: [...command.color] as [number, number, number, number],
      };
    case 'drawPath':
      return {
        kind: 'drawPath',
        path: {
          verbs: command.path.verbs.map((verb) => ({ ...verb })),
        },
        paint: { ...command.paint },
      };
    case 'drawShape':
      return {
        kind: 'drawShape',
        shape: structuredClone(command.shape),
        path: {
          verbs: command.path.verbs.map((verb) => ({ ...verb })),
        },
        paint: { ...command.paint },
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
