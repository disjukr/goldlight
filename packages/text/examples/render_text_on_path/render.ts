import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import { createPath2d, createRect, createRectPath2d } from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  submitToDawnQueueManager,
} from '@goldlight/drawing';
import { createTextHost, recordPathFallbackRunOnPath } from '@goldlight/text';

const outputWidth = 1280;
const outputHeight = 760;

type Summary = Readonly<{
  label: string;
  family: string;
  placementCount: number;
}>;

const matchCandidateTypeface = (
  host: ReturnType<typeof createTextHost>,
  candidates: readonly string[],
) => {
  for (const candidate of candidates) {
    const typeface = host.matchTypeface({ family: candidate });
    if (typeface !== null) {
      return { family: candidate, typeface };
    }
  }

  for (const family of host.listFamilies()) {
    const typeface = host.matchTypeface({ family });
    if (typeface !== null) {
      return { family, typeface };
    }
  }

  return null;
};

export const renderTextOnPathSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
    summaries: readonly Summary[];
  }>
> => {
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputWidth,
      height: outputHeight,
      format: 'rgba8unorm',
      msaaSampleCount: 4,
    },
  });
  const binding = createOffscreenBinding(drawingContext.backend);
  const recorder = drawingContext.createRecorder();
  const textHost = createTextHost();

  const latinMatch = matchCandidateTypeface(textHost, ['Calibri', 'Palatino Linotype', 'Cambria']);
  const hangulMatch = matchCandidateTypeface(textHost, [
    'Malgun Gothic',
    'Segoe UI',
    'Arial Unicode MS',
  ]);

  if (!latinMatch || !hangulMatch) {
    throw new Error('render_text_on_path could not resolve required fonts');
  }

  const latinPath = createPath2d(
    { kind: 'moveTo', to: [70, 250] },
    { kind: 'cubicTo', control1: [300, 30], control2: [940, 20], to: [1210, 260] },
  );
  const hangulPath = createPath2d(
    { kind: 'moveTo', to: [90, 585] },
    { kind: 'cubicTo', control1: [280, 440], control2: [970, 700], to: [1210, 555] },
  );

  const latinRun = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: 'The quick brown fox jumps over the lazy dog',
    size: 34,
    language: 'en',
  });
  const hangulRun = textHost.shapeText({
    typeface: hangulMatch.typeface,
    text: '다람쥐 헌 쳇바퀴에 타고파',
    size: 42,
    language: 'ko',
  });

  recordClear(recorder, [0.94, 0.93, 0.9, 1]);
  recordDrawPath(
    recorder,
    createRectPath2d(createRect(38, 38, outputWidth - 76, outputHeight - 76)),
    {
      style: 'fill',
      color: [0.08, 0.09, 0.11, 1],
    },
  );

  recordDrawPath(recorder, latinPath, {
    style: 'stroke',
    color: [0.94, 0.56, 0.24, 0.55],
    strokeWidth: 2,
  });
  recordDrawPath(recorder, hangulPath, {
    style: 'stroke',
    color: [0.24, 0.76, 0.64, 0.55],
    strokeWidth: 2,
  });

  recordPathFallbackRunOnPath(
    textHost,
    recorder,
    latinRun,
    latinPath,
    {
      style: 'fill',
      color: [0.98, 0.97, 0.94, 1],
    },
    {
      align: 'center',
      normalOffset: -20,
    },
  );
  recordPathFallbackRunOnPath(
    textHost,
    recorder,
    hangulRun,
    hangulPath,
    {
      style: 'fill',
      color: [0.9, 1, 0.96, 1],
    },
    {
      align: 'center',
      normalOffset: -20,
    },
  );

  const recording = finishDrawingRecorder(recorder);
  textHost.close();

  const commandBuffer = encodeDawnCommandBuffer(
    drawingContext.sharedContext,
    recording,
    binding,
  );
  submitToDawnQueueManager(drawingContext.sharedContext.queueManager, commandBuffer);
  await drawingContext.tick();
  await checkForFinishedDawnQueueWork(drawingContext.sharedContext.queueManager, 'yes');

  const snapshot = await readOffscreenSnapshot(
    {
      device: drawingContext.backend.device,
      queue: drawingContext.backend.queue,
    },
    binding,
  );

  return {
    png: exportPngRgba({
      width: snapshot.width,
      height: snapshot.height,
      bytes: snapshot.bytes,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
    summaries: [
      {
        label: 'Latin',
        family: latinMatch.family,
        placementCount: latinRun.glyphIDs.length,
      },
      {
        label: 'Hangul',
        family: hangulMatch.family,
        placementCount: hangulRun.glyphIDs.length,
      },
    ],
  };
};
