import type { Path2d } from '@disjukr/goldlight/geometry';
import { cloneDrawingClipStackSnapshot } from './clip_stack.ts';
import type { DawnCaps } from './caps.ts';
import type { DrawingRendererProvider } from './renderer_provider.ts';
import type { DawnSharedContext } from './shared_context.ts';
import type { DrawingCommand, DrawingSubmission } from './types.ts';

export type DrawingRecording = Readonly<{
  backend: DrawingSubmission['backend'];
  caps: Readonly<{
    dstReadStrategy: DawnCaps['dstReadStrategy'];
    supportsHardwareAdvancedBlending: boolean;
    supportsDualSourceBlending: boolean;
  }>;
  targetFormat: GPUTextureFormat;
  rendererProvider: DrawingRendererProvider;
  recorderId: number;
  commandCount: number;
  commands: readonly DrawingCommand[];
}>;

const cloneCommand = (command: DrawingCommand): DrawingCommand => {
  const clonePath = (path: Path2d | undefined): Path2d | undefined =>
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
        clipStack: cloneDrawingClipStackSnapshot(command.clipStack),
      };
    case 'drawShape':
      return {
        kind: 'drawShape',
        shape: structuredClone(command.shape),
        path: clonePath(command.path)!,
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipStack: cloneDrawingClipStackSnapshot(command.clipStack),
      };
    case 'drawDirectMaskText':
      return {
        kind: 'drawDirectMaskText',
        glyphs: command.glyphs.map((glyph) => ({
          ...glyph,
          mask: glyph.mask
            ? {
              ...glyph.mask,
              pixels: new Uint8Array(glyph.mask.pixels),
            }
            : null,
        })),
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipStack: cloneDrawingClipStackSnapshot(command.clipStack),
      };
    case 'drawTransformedMaskText':
      return {
        kind: 'drawTransformedMaskText',
        glyphs: command.glyphs.map((glyph) => ({
          ...glyph,
          mask: glyph.mask
            ? {
              ...glyph.mask,
              pixels: new Uint8Array(glyph.mask.pixels),
            }
            : null,
        })),
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipStack: cloneDrawingClipStackSnapshot(command.clipStack),
      };
    case 'drawSdfText':
      return {
        kind: 'drawSdfText',
        glyphs: command.glyphs.map((glyph) => ({
          ...glyph,
          mask: glyph.mask
            ? {
              ...glyph.mask,
              pixels: new Uint8Array(glyph.mask.pixels),
            }
            : null,
          sdf: glyph.sdf
            ? {
              ...glyph.sdf,
              pixels: new Uint8Array(glyph.sdf.pixels),
            }
            : null,
        })),
        paint: { ...command.paint },
        transform: [...command.transform] as typeof command.transform,
        clipStack: cloneDrawingClipStackSnapshot(command.clipStack),
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
    caps: {
      dstReadStrategy: sharedContext.caps.dstReadStrategy,
      supportsHardwareAdvancedBlending: sharedContext.caps.supportsHardwareAdvancedBlending,
      supportsDualSourceBlending: sharedContext.caps.supportsDualSourceBlending,
    },
    targetFormat: sharedContext.backend.target.format,
    rendererProvider: sharedContext.rendererProvider,
    recorderId,
    commandCount: clonedCommands.length,
    commands: Object.freeze(clonedCommands),
  };
};
