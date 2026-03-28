/// <reference lib="deno.unstable" />

import type { DesktopModuleContext } from '@disjukr/goldlight/desktop';
import {
  createDrawingContextFromGpuContext,
  encodeDawnCommandBuffer,
  finishDrawingRecorder,
  recordClear,
  recordDrawShape,
  restoreDrawingRecorder,
  saveDrawingRecorder,
  submitDawnCommandBuffer,
  translateDrawingRecorder,
} from '@disjukr/goldlight/drawing';
import { createRect } from '@disjukr/goldlight/geometry';
import {
  type ComputedLayoutNode,
  computeLayout,
  createBoxLayoutNode,
  createTextLayoutNode,
  type LayoutAvailableSize,
  layoutParagraph,
  prepareParagraph,
} from '@disjukr/goldlight/layout';
import {
  createSurfaceBinding,
  requestGpuContext,
  resizeSurfaceBindingTarget,
} from '@disjukr/goldlight/gpu';
import {
  buildDirectMaskSubRun,
  buildSdfSubRun,
  createTextHost,
  recordDirectMaskSubRun,
  recordSdfSubRun,
  type ShapedRun,
  type TextHost,
} from '@disjukr/goldlight/text';

const backgroundColor: readonly [number, number, number, number] = [0.08, 0.09, 0.11, 1];
const defaultTextColor: readonly [number, number, number, number] = [0.93, 0.94, 0.97, 1];
const mutedTextColor: readonly [number, number, number, number] = [0.72, 0.76, 0.84, 1];
const accentTextColor: readonly [number, number, number, number] = [0.98, 0.81, 0.42, 1];
const latinFamilies = ['Calibri', 'Segoe UI', 'Arial'] as const;
const hangulFamilies = ['Malgun Gothic', 'Segoe UI', 'Arial Unicode MS'] as const;
const layoutDemoTextMode: 'a8' | 'sdf' = 'a8';

const createBoxShape = (
  x: number,
  y: number,
  width: number,
  height: number,
  cornerRadius = 0,
) => {
  const rect = createRect(x, y, width, height);
  if (cornerRadius <= 0) {
    return { kind: 'rect' as const, rect };
  }
  return {
    kind: 'rrect' as const,
    rrect: {
      rect,
      topLeft: { x: cornerRadius, y: cornerRadius },
      topRight: { x: cornerRadius, y: cornerRadius },
      bottomRight: { x: cornerRadius, y: cornerRadius },
      bottomLeft: { x: cornerRadius, y: cornerRadius },
    },
  };
};

const makeRunSlice = (
  run: ShapedRun,
  glyphStart: number,
  glyphEnd: number,
): ShapedRun => {
  const count = Math.max(0, glyphEnd - glyphStart);
  const glyphIDs = run.glyphIDs.slice(glyphStart, glyphEnd);
  const offsets = run.offsets.slice(glyphStart * 2, glyphEnd * 2);
  const positions = new Float32Array((count + 1) * 2);
  const clusterIndices = new Uint32Array(count);
  const baseX = run.positions[glyphStart * 2] ?? 0;
  const baseY = run.positions[(glyphStart * 2) + 1] ?? 0;

  for (let index = 0; index <= count; index += 1) {
    const sourceGlyphIndex = glyphStart + index;
    positions[index * 2] = (run.positions[sourceGlyphIndex * 2] ?? baseX) - baseX;
    positions[(index * 2) + 1] = (run.positions[(sourceGlyphIndex * 2) + 1] ?? baseY) - baseY;
    if (index < count) {
      const cluster = run.clusterIndices[sourceGlyphIndex] ?? run.utf8RangeStart;
      clusterIndices[index] = cluster - run.utf8RangeStart;
    }
  }

  return {
    typeface: run.typeface,
    text: run.text,
    size: run.size,
    direction: run.direction,
    bidiLevel: run.bidiLevel,
    scriptTag: run.scriptTag,
    language: run.language,
    glyphIDs,
    positions,
    offsets,
    clusterIndices,
    advanceX: positions[count * 2] ?? 0,
    advanceY: positions[(count * 2) + 1] ?? 0,
    utf8RangeStart: 0,
    utf8RangeEnd: run.utf8RangeEnd - run.utf8RangeStart,
  };
};

const buildDemoTree = (
  host: TextHost,
  viewportWidth: number,
  timeMs: number,
) => {
  const oscillation = (Math.sin(timeMs / 900) + 1) * 0.5;
  const inspectorWidth = 340 + (oscillation * 220);
  const contentWidth = Math.min(1120, viewportWidth - 80);
  const flowingCardMaxWidth = Math.max(contentWidth - 280, 280);

  const title = createTextLayoutNode(
    prepareParagraph(host, 'Goldlight Layout Prototype', {
      fontSize: 34,
      fontFamily: latinFamilies,
      lineHeight: 40,
    }),
  );
  const subtitle = createTextLayoutNode(
    prepareParagraph(
      host,
      `Taffy-style outer boxes, Pretext-style paragraph preparation, and drawing-backed ${layoutDemoTextMode.toUpperCase()} text.`,
      {
        fontSize: 18,
        fontFamily: latinFamilies,
        lineHeight: 24,
      },
    ),
  );
  const paragraph = createTextLayoutNode(
    prepareParagraph(
      host,
      'This panel recomputes paragraph layout every frame against an animated width constraint so line wrapping is easy to inspect while the rest of the engine stays alive.',
      {
        fontSize: 19,
        fontFamily: latinFamilies,
        lineHeight: 28,
      },
    ),
  );
  const hangul = createTextLayoutNode(
    prepareParagraph(
      host,
      '\uB2E4\uB78C\uC950 \uD5CC \uCC47\uBC14\uD034\uC5D0 \uD0C0\uACE0\uD30C \uB77C\uC778\uC774 \uD3ED\uC5D0 \uB530\uB77C \uB2E4\uC2DC \uBC30\uCE58\uB429\uB2C8\uB2E4.',
      {
        fontSize: 22,
        fontFamily: hangulFamilies,
        lineHeight: 30,
      },
    ),
  );

  const badgeRow = createBoxLayoutNode(
    [
      createTextLayoutNode(
        prepareParagraph(host, 'logical-order lines', {
          fontSize: 15,
          fontFamily: latinFamilies,
          lineHeight: 18,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(host, 'run-based output', {
          fontSize: 15,
          fontFamily: latinFamilies,
          lineHeight: 18,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(host, 'bidi-safe structure', {
          fontSize: 15,
          fontFamily: latinFamilies,
          lineHeight: 18,
        }),
      ),
    ],
    {
      direction: 'row',
      gap: 16,
      padding: { left: 14, right: 14, top: 10, bottom: 10 },
      backgroundColor: [0.12, 0.15, 0.19, 1],
      borderColor: [0.21, 0.24, 0.29, 1],
      borderWidth: 1,
      cornerRadius: 12,
    },
  );

  const leftCard = createBoxLayoutNode(
    [title, subtitle, badgeRow],
    {
      width: contentWidth,
      padding: 24,
      gap: 16,
      backgroundColor: [0.12, 0.13, 0.17, 1],
      borderColor: [0.22, 0.25, 0.32, 1],
      borderWidth: 1,
      cornerRadius: 18,
    },
  );

  const flowingCard = createBoxLayoutNode(
    [
      createTextLayoutNode(
        prepareParagraph(host, `Animated paragraph width: ${Math.round(inspectorWidth)}px`, {
          fontSize: 18,
          fontFamily: latinFamilies,
          lineHeight: 24,
        }),
      ),
      paragraph,
      hangul,
    ],
    {
      width: inspectorWidth,
      minWidth: 280,
      maxWidth: flowingCardMaxWidth,
      flexBasis: inspectorWidth,
      flexGrow: 0,
      flexShrink: 1,
      padding: 20,
      gap: 14,
      backgroundColor: [0.15, 0.16, 0.2, 1],
      borderColor: [0.26, 0.31, 0.4, 1],
      borderWidth: 1,
      cornerRadius: 18,
    },
  );

  const metricsCard = createBoxLayoutNode(
    [
      createTextLayoutNode(
        prepareParagraph(host, 'Current Constraints', {
          fontSize: 18,
          fontFamily: latinFamilies,
          lineHeight: 24,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(
          host,
          `viewport=${Math.round(viewportWidth)}px\ncontent=${
            Math.round(contentWidth)
          }px\ninspector=${Math.round(inspectorWidth)}px`,
          {
            fontSize: 16,
            fontFamily: latinFamilies,
            lineHeight: 22,
          },
        ),
      ),
    ],
    {
      width: 260,
      minWidth: 260,
      maxWidth: 260,
      flexBasis: 260,
      flexGrow: 0,
      flexShrink: 0,
      padding: 18,
      gap: 12,
      backgroundColor: [0.11, 0.15, 0.18, 1],
      borderColor: [0.22, 0.44, 0.78, 1],
      borderWidth: 1,
      cornerRadius: 18,
    },
  );

  return createBoxLayoutNode(
    [
      leftCard,
      createBoxLayoutNode(
        [flowingCard, metricsCard],
        {
          direction: 'row',
          gap: 20,
          alignItems: 'start',
        },
      ),
    ],
    {
      width: contentWidth,
      padding: 0,
      gap: 20,
    },
  );
};

const recordLayoutTextRun = (
  host: TextHost,
  recorder: ReturnType<ReturnType<typeof createDrawingContextFromGpuContext>['createRecorder']>,
  run: ShapedRun,
  color: readonly [number, number, number, number],
  mode: 'a8' | 'sdf',
): void => {
  if (mode === 'sdf') {
    const subRun = buildSdfSubRun(host, run);
    recordSdfSubRun(recorder, subRun, {
      style: 'fill',
      color,
    });
    return;
  }

  const subRun = buildDirectMaskSubRun(host, run, recorder.state.transform);
  recordDirectMaskSubRun(recorder, subRun, {
    style: 'fill',
    color,
  });
};

const paintComputedLayout = (
  host: TextHost,
  recorder: ReturnType<ReturnType<typeof createDrawingContextFromGpuContext>['createRecorder']>,
  node: ComputedLayoutNode,
): void => {
  if (node.kind === 'box') {
    const style = node.node.style;
    const cornerRadius = style?.cornerRadius ?? 0;
    if (style?.backgroundColor) {
      recordDrawShape(
        recorder,
        createBoxShape(node.x, node.y, node.width, node.height, cornerRadius),
        {
          style: 'fill',
          color: style.backgroundColor,
        },
      );
    }
    if (style?.borderColor && (style.borderWidth ?? 0) > 0) {
      recordDrawShape(
        recorder,
        createBoxShape(node.x, node.y, node.width, node.height, cornerRadius),
        {
          style: 'stroke',
          strokeWidth: style.borderWidth,
          color: style.borderColor,
        },
      );
    }
    for (const child of node.children) {
      paintComputedLayout(host, recorder, child);
    }
    return;
  }

  const paragraph = layoutParagraph(
    node.node.prepared,
    node.width,
    node.node.prepared.style.lineHeight ?? node.node.prepared.style.fontSize,
  );
  const lineHeight = node.node.prepared.style.lineHeight ?? node.node.prepared.style.fontSize;
  const color = node.node.prepared.style.fontSize >= 28
    ? accentTextColor
    : node.node.prepared.style.fontSize >= 18
    ? defaultTextColor
    : mutedTextColor;

  for (let lineIndex = 0; lineIndex < paragraph.lines.length; lineIndex += 1) {
    const line = paragraph.lines[lineIndex]!;
    const baselineY = node.y + (lineIndex * lineHeight) + Math.abs(line.ascent);
    for (const run of line.runs) {
      if (run.glyphStart >= run.glyphEnd) {
        continue;
      }
      const slice = makeRunSlice(run.shapedRun, run.glyphStart, run.glyphEnd);
      saveDrawingRecorder(recorder);
      translateDrawingRecorder(recorder, node.x + run.x, baselineY);
      recordLayoutTextRun(host, recorder, slice, color, layoutDemoTextMode);
      restoreDrawingRecorder(recorder);
    }
  }
};

export default async ({ window }: DesktopModuleContext): Promise<() => void> => {
  const target = {
    kind: 'surface' as const,
    width: window.surfaceInfo.width,
    height: window.surfaceInfo.height,
    format: navigator.gpu.getPreferredCanvasFormat(),
    alphaMode: 'opaque' as const,
  };
  const gpuContext = await requestGpuContext({ target });
  gpuContext.device.addEventListener('uncapturederror', (event) => {
    const detail = event as GPUUncapturedErrorEvent;
    console.error('[layout-demo] GPU uncaptured error:', detail.error ?? event);
  });
  const binding = createSurfaceBinding(gpuContext, window.canvasContext);
  const drawingContext = createDrawingContextFromGpuContext(gpuContext, {
    resourceBudget: 16 * 1024 * 1024,
  });
  const textHost = createTextHost();

  window.runtime.addEventListener('resize', (event) => {
    const detail = (event as CustomEvent<{ width: number; height: number }>).detail;
    target.width = detail.width;
    target.height = detail.height;
    resizeSurfaceBindingTarget(binding, detail.width, detail.height);
  });

  const startTime = performance.now();
  let frameHandle = 0;
  const drawFrame = () => {
    const timeMs = performance.now() - startTime;
    const recorder = drawingContext.createRecorder();
    recordClear(recorder, backgroundColor);

    const root = buildDemoTree(textHost, window.surfaceInfo.width, timeMs);
    const layout = computeLayout(
      root,
      {
        width: { kind: 'definite', value: window.surfaceInfo.width - 80 },
        height: { kind: 'definite', value: window.surfaceInfo.height - 80 },
      } satisfies LayoutAvailableSize,
    );

    saveDrawingRecorder(recorder);
    translateDrawingRecorder(recorder, 40, 40);
    paintComputedLayout(textHost, recorder, layout);
    restoreDrawingRecorder(recorder);

    const recording = finishDrawingRecorder(recorder);
    const commandBuffer = encodeDawnCommandBuffer(drawingContext.sharedContext, recording, binding);
    submitDawnCommandBuffer(drawingContext.sharedContext, commandBuffer);
    window.present();
    void drawingContext.tick();
    frameHandle = requestAnimationFrame(drawFrame);
  };

  frameHandle = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(frameHandle);
    textHost.close();
  };
};
