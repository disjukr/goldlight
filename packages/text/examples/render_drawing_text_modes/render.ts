import { exportPngRgba } from '@goldlight/exporters';
import { createOffscreenBinding, readOffscreenSnapshot } from '@goldlight/gpu';
import { createRect, createRectPath2d } from '@goldlight/geometry';
import {
  checkForFinishedDawnQueueWork,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawPath,
  requestDrawingContext,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  scaleDrawingRecorder,
  submitToDawnQueueManager,
  translateDrawingRecorder,
} from '@goldlight/drawing';
import {
  buildDirectMaskSubRun,
  buildSdfSubRun,
  createTextHost,
  recordDirectMaskSubRun,
  recordPathFallbackRun,
  recordSdfSubRun,
} from '@goldlight/text';

const outputWidth = 1280;
const outputHeight = 900;
const supersampleScale = 2;
const panelWidth = 360;
const panelHeight = 220;
const panelGap = 36;
const panelOriginX = 72;
const panelOriginY = 110;
const panelPaddingX = 28;

type ModeSummary = Readonly<{
  label: string;
  family: string;
  glyphCount: number;
}>;

type Recorder = ReturnType<Awaited<ReturnType<typeof requestDrawingContext>>['createRecorder']>;

const downsampleRgba = (
  bytes: Uint8Array,
  width: number,
  height: number,
  scale: number,
): Uint8Array => {
  const nextWidth = Math.floor(width / scale);
  const nextHeight = Math.floor(height / scale);
  const downsampled = new Uint8Array(nextWidth * nextHeight * 4);

  for (let y = 0; y < nextHeight; y += 1) {
    for (let x = 0; x < nextWidth; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sampleY = 0; sampleY < scale; sampleY += 1) {
        for (let sampleX = 0; sampleX < scale; sampleX += 1) {
          const sourceX = (x * scale) + sampleX;
          const sourceY = (y * scale) + sampleY;
          const sourceOffset = ((sourceY * width) + sourceX) * 4;
          sums[0] += bytes[sourceOffset]!;
          sums[1] += bytes[sourceOffset + 1]!;
          sums[2] += bytes[sourceOffset + 2]!;
          sums[3] += bytes[sourceOffset + 3]!;
        }
      }
      const targetOffset = ((y * nextWidth) + x) * 4;
      const sampleCount = scale * scale;
      downsampled[targetOffset] = Math.round(sums[0]! / sampleCount);
      downsampled[targetOffset + 1] = Math.round(sums[1]! / sampleCount);
      downsampled[targetOffset + 2] = Math.round(sums[2]! / sampleCount);
      downsampled[targetOffset + 3] = Math.round(sums[3]! / sampleCount);
    }
  }

  return downsampled;
};

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

const translateSupersampled = (
  recorder: Recorder,
  x: number,
  y: number,
): void => {
  translateDrawingRecorder(recorder, x * supersampleScale, y * supersampleScale);
};

const recordPanelFrame = (
  recorder: Recorder,
  x: number,
  y: number,
  accent: readonly [number, number, number, number],
) => {
  recordDrawPath(recorder, createRectPath2d(createRect(x, y, panelWidth, panelHeight)), {
    style: 'fill',
    color: [0.12, 0.13, 0.16, 1],
  });
  recordDrawPath(recorder, createRectPath2d(createRect(x, y, panelWidth, 8)), {
    style: 'fill',
    color: accent,
  });
  recordDrawPath(recorder, createRectPath2d(createRect(x + 28, y + 36, panelWidth - 56, 1.5)), {
    style: 'fill',
    color: [0.28, 0.31, 0.37, 1],
  });
  recordDrawPath(recorder, createRectPath2d(createRect(x + 28, y + 108, panelWidth - 56, 1.5)), {
    style: 'fill',
    color: [0.19, 0.21, 0.26, 1],
  });
};

const recordPathText = (
  host: ReturnType<typeof createTextHost>,
  recorder: Recorder,
  typeface: bigint,
  text: string,
  size: number,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
  language: string,
) => {
  const run = host.shapeText({
    typeface,
    text,
    size,
    language,
  });
  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, x, y);
  recordPathFallbackRun(host, recorder, run, { color });
  restoreDrawingRecorder(recorder);
  return run;
};

export const renderDrawingTextModesSnapshot = async (): Promise<
  Readonly<{
    png: Uint8Array;
    passCount: number;
    unsupportedCommandCount: number;
    summaries: readonly ModeSummary[];
  }>
> => {
  const drawingContext = await requestDrawingContext({
    target: {
      kind: 'offscreen',
      width: outputWidth * supersampleScale,
      height: outputHeight * supersampleScale,
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
    throw new Error('render_drawing_text_modes could not resolve required fonts');
  }

  const directRun = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: 'A8 atlas fi fl',
    size: 34,
    language: 'en',
  });
  const sdfRun = textHost.shapeText({
    typeface: hangulMatch.typeface,
    text: 'SDF text',
    size: 42,
    language: 'en',
  });
  const fallbackRun = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: 'Bezier',
    size: 82,
    language: 'en',
  });

  const directSubRun = buildDirectMaskSubRun(textHost, directRun);
  const sdfSubRun = buildSdfSubRun(textHost, sdfRun, { inset: 10, radius: 10 });

  saveDrawingRecorder(recorder);
  scaleDrawingRecorder(recorder, supersampleScale, supersampleScale);
  recordClear(recorder, [0.94, 0.93, 0.9, 1]);
  recordDrawPath(
    recorder,
    createRectPath2d(createRect(42, 42, outputWidth - 84, outputHeight - 84)),
    {
      style: 'fill',
      color: [0.07, 0.08, 0.1, 1],
    },
  );

  const directX = panelOriginX;
  const sdfX = panelOriginX + panelWidth + panelGap;
  const fallbackX = panelOriginX + ((panelWidth + panelGap) * 2);

  recordPanelFrame(recorder, directX, panelOriginY, [0.9, 0.42, 0.2, 1]);
  recordPanelFrame(recorder, sdfX, panelOriginY, [0.16, 0.68, 0.58, 1]);
  recordPanelFrame(recorder, fallbackX, panelOriginY, [0.35, 0.54, 0.94, 1]);

  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, directX + panelPaddingX, panelOriginY + 150);
  recordDirectMaskSubRun(recorder, directSubRun, {
    color: [0.96, 0.95, 0.9, 1],
  });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, sdfX + panelPaddingX, panelOriginY + 150);
  recordSdfSubRun(recorder, sdfSubRun, {
    color: [0.96, 0.95, 0.9, 1],
  });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, fallbackX + panelPaddingX, panelOriginY + 178);
  recordPathFallbackRun(textHost, recorder, fallbackRun, {
    color: [0.96, 0.95, 0.9, 1],
  });
  restoreDrawingRecorder(recorder);

  recordDrawPath(recorder, createRectPath2d(createRect(96, 420, outputWidth - 192, 2)), {
    style: 'fill',
    color: [0.22, 0.24, 0.29, 1],
  });

  const comparisonEnglishLine1 = 'The quick brown fox';
  const comparisonEnglishLine2 = 'jumps over the lazy dog';
  const comparisonKorean = '다람쥐 헌 쳇바퀴에 타고파';
  const comparisonTop = 500;
  const comparisonColumnXs = [110, 470, 830] as const;
  const comparisonLabelColor = [0.88, 0.89, 0.92, 1] as const;
  const comparisonColors = [
    [0.98, 0.76, 0.36, 1],
    [0.38, 0.82, 0.74, 1],
    [0.72, 0.8, 0.98, 1],
  ] as const;

  const a8EnglishRun1 = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: comparisonEnglishLine1,
    size: 26,
    language: 'en',
  });
  const a8EnglishRun2 = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: comparisonEnglishLine2,
    size: 26,
    language: 'en',
  });
  const a8KoreanRun = textHost.shapeText({
    typeface: hangulMatch.typeface,
    text: comparisonKorean,
    size: 28,
    language: 'ko',
  });
  const a8EnglishSubRun1 = buildDirectMaskSubRun(textHost, a8EnglishRun1);
  const a8EnglishSubRun2 = buildDirectMaskSubRun(textHost, a8EnglishRun2);
  const a8KoreanSubRun = buildDirectMaskSubRun(textHost, a8KoreanRun);

  const sdfEnglishRun1 = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: comparisonEnglishLine1,
    size: 26,
    language: 'en',
  });
  const sdfEnglishRun2 = textHost.shapeText({
    typeface: latinMatch.typeface,
    text: comparisonEnglishLine2,
    size: 26,
    language: 'en',
  });
  const sdfKoreanRun = textHost.shapeText({
    typeface: hangulMatch.typeface,
    text: comparisonKorean,
    size: 28,
    language: 'ko',
  });
  const sdfEnglishSubRun1 = buildSdfSubRun(textHost, sdfEnglishRun1, { inset: 8, radius: 8 });
  const sdfEnglishSubRun2 = buildSdfSubRun(textHost, sdfEnglishRun2, { inset: 8, radius: 8 });
  const sdfKoreanSubRun = buildSdfSubRun(textHost, sdfKoreanRun, { inset: 8, radius: 8 });

  recordPathText(
    textHost,
    recorder,
    latinMatch.typeface,
    'A8 atlas',
    24,
    comparisonColumnXs[0],
    comparisonTop,
    comparisonLabelColor,
    'en',
  );
  recordPathText(
    textHost,
    recorder,
    hangulMatch.typeface,
    'SDF',
    24,
    comparisonColumnXs[1],
    comparisonTop,
    comparisonLabelColor,
    'en',
  );
  recordPathText(
    textHost,
    recorder,
    latinMatch.typeface,
    'Path fallback',
    24,
    comparisonColumnXs[2],
    comparisonTop,
    comparisonLabelColor,
    'en',
  );

  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[0], comparisonTop + 52);
  recordDirectMaskSubRun(recorder, a8EnglishSubRun1, { color: comparisonColors[0] });
  restoreDrawingRecorder(recorder);
  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[0], comparisonTop + 88);
  recordDirectMaskSubRun(recorder, a8EnglishSubRun2, { color: comparisonColors[0] });
  restoreDrawingRecorder(recorder);
  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[0], comparisonTop + 142);
  recordDirectMaskSubRun(recorder, a8KoreanSubRun, { color: comparisonColors[0] });
  restoreDrawingRecorder(recorder);

  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[1], comparisonTop + 52);
  recordSdfSubRun(recorder, sdfEnglishSubRun1, { color: comparisonColors[1] });
  restoreDrawingRecorder(recorder);
  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[1], comparisonTop + 88);
  recordSdfSubRun(recorder, sdfEnglishSubRun2, { color: comparisonColors[1] });
  restoreDrawingRecorder(recorder);
  saveDrawingRecorder(recorder);
  translateSupersampled(recorder, comparisonColumnXs[1], comparisonTop + 142);
  recordSdfSubRun(recorder, sdfKoreanSubRun, { color: comparisonColors[1] });
  restoreDrawingRecorder(recorder);

  recordPathText(
    textHost,
    recorder,
    latinMatch.typeface,
    comparisonEnglishLine1,
    26,
    comparisonColumnXs[2],
    comparisonTop + 52,
    comparisonColors[2],
    'en',
  );
  recordPathText(
    textHost,
    recorder,
    latinMatch.typeface,
    comparisonEnglishLine2,
    26,
    comparisonColumnXs[2],
    comparisonTop + 88,
    comparisonColors[2],
    'en',
  );
  recordPathText(
    textHost,
    recorder,
    hangulMatch.typeface,
    comparisonKorean,
    28,
    comparisonColumnXs[2],
    comparisonTop + 142,
    comparisonColors[2],
    'ko',
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
  const downsampled = downsampleRgba(
    snapshot.bytes,
    snapshot.width,
    snapshot.height,
    supersampleScale,
  );

  return {
    png: exportPngRgba({
      width: outputWidth,
      height: outputHeight,
      bytes: downsampled,
    }),
    passCount: commandBuffer.passCount,
    unsupportedCommandCount: commandBuffer.unsupportedCommands.length,
    summaries: [
      { label: 'A8 atlas', family: latinMatch.family, glyphCount: directRun.glyphIDs.length },
      { label: 'SDF', family: hangulMatch.family, glyphCount: sdfRun.glyphIDs.length },
      {
        label: 'Path fallback',
        family: latinMatch.family,
        glyphCount: fallbackRun.glyphIDs.length,
      },
    ],
  };
};
