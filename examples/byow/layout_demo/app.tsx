/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { createRect, createRRectPath2d } from '@disjukr/goldlight/geometry';
import type { ParagraphLineRun, ParagraphTextStyle } from '@disjukr/goldlight/layout';
import { createTextHost } from '@disjukr/goldlight/text';
import {
  type G2lBoxRenderNode,
  type G2lRenderContext,
  type G2lTextRenderNode,
} from '@disjukr/goldlight/react/reconciler';
import {
  initializeWindow,
  useSetTimeMs,
  useTimeMs,
  useWindowMetrics,
} from '@disjukr/goldlight/desktop';

const demoTextHost = createTextHost();

const backgroundColor: readonly [number, number, number, number] = [0.08, 0.09, 0.11, 1];
const defaultTextColor: readonly [number, number, number, number] = [0.93, 0.94, 0.97, 1];
const mutedTextColor: readonly [number, number, number, number] = [0.72, 0.76, 0.84, 1];
const accentTextColor: readonly [number, number, number, number] = [0.98, 0.81, 0.42, 1];
const latinFamilies = ['Calibri', 'Segoe UI', 'Arial'] as const;
const hangulFamilies = ['Malgun Gothic', 'Segoe UI', 'Arial Unicode MS'] as const;
const layoutDemoTextMode: 'a8' | 'sdf' = 'a8';

const createRoundedBoxPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  cornerRadius: number,
) => {
  if (cornerRadius <= 0) {
    return createRRectPath2d({
      rect: createRect(x, y, width, height),
      topLeft: { x: 0, y: 0 },
      topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 },
      bottomLeft: { x: 0, y: 0 },
    });
  }
  return createRRectPath2d({
    rect: createRect(x, y, width, height),
    topLeft: { x: cornerRadius, y: cornerRadius },
    topRight: { x: cornerRadius, y: cornerRadius },
    bottomRight: { x: cornerRadius, y: cornerRadius },
    bottomLeft: { x: cornerRadius, y: cornerRadius },
  });
};

const getTextRunSlice = (
  node: G2lTextRenderNode,
  run: ParagraphLineRun,
): string => {
  const preparedRun = node.paragraph.prepared.runs[run.logicalStart.runIndex];
  if (!preparedRun) {
    return '';
  }
  const text = preparedRun.clusters
    .slice(run.logicalStart.clusterIndex, run.logicalEnd.clusterIndex)
    .map((cluster) => cluster.text)
    .join('');
  return text.replaceAll('\r', '').replaceAll('\n', '');
};

const getTextColor = (style?: ParagraphTextStyle): readonly [number, number, number, number] => {
  const fontSize = style?.fontSize ?? 16;
  if (fontSize >= 28) {
    return accentTextColor;
  }
  if (fontSize >= 18) {
    return defaultTextColor;
  }
  return mutedTextColor;
};

const renderBoxNode = (context: G2lRenderContext): React.ReactNode => {
  if (context.node.kind !== 'box') {
    throw new Error('renderBoxNode expects a box node');
  }
  const node = context.node as G2lBoxRenderNode;
  const style = node.style;
  if (!style?.backgroundColor && !(style?.borderColor && (style.borderWidth ?? 0) > 0)) {
    return null;
  }
  const rect = node.boxes.borderRect;
  const path = createRoundedBoxPath(
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    style?.cornerRadius ?? 0,
  );
  return (
    <>
      {style?.backgroundColor
        ? (
          <g2d-path
            path={path}
            style='fill'
            color={style.backgroundColor}
          />
        )
        : null}
      {style?.borderColor && (style.borderWidth ?? 0) > 0
        ? (
          <g2d-path
            path={path}
            style='stroke'
            strokeWidth={style.borderWidth}
            color={style.borderColor}
          />
        )
        : null}
    </>
  );
};

const renderTextNode = (context: G2lRenderContext): React.ReactNode => {
  if (context.node.kind !== 'text') {
    throw new Error('renderTextNode expects a text node');
  }
  const node = context.node as G2lTextRenderNode;
  const contentRect = node.boxes.contentRect;
  const textStyle = node.style;
  const lineHeight = textStyle?.lineHeight ?? textStyle?.fontSize ?? 16;
  const color = getTextColor(textStyle);
  return (
    <>
      {node.paragraph.layout.lines.flatMap((line, lineIndex) =>
        line.runs.map((run, runIndex) => {
          const text = getTextRunSlice(node, run);
          if (text.length === 0) {
            return null;
          }
          const baselineY = contentRect.y + (lineIndex * lineHeight) + Math.abs(line.ascent);
          return (
            <g2d-glyphs
              key={`${node.id}:${lineIndex}:${runIndex}`}
              text={text}
              x={contentRect.x + run.x}
              y={baselineY}
              fontSize={textStyle?.fontSize ?? 16}
              fontFamily={textStyle?.fontFamily}
              direction={run.direction === 'neutral' ? undefined : run.direction}
              language={textStyle?.language}
              scriptTag={textStyle?.scriptTag}
              mode={layoutDemoTextMode}
              textHost={demoTextHost}
              color={color}
            />
          );
        })
      )}
    </>
  );
};

const DemoFrameDriver = () => {
  const setTimeMs = useSetTimeMs();

  React.useEffect(() => {
    let previousNowMs = performance.now();
    let accumulatedTimeMs = 0;
    let handle = 0;

    const tick = (nowMs: number) => {
      const deltaTimeMs = Math.max(0, nowMs - previousNowMs);
      previousNowMs = nowMs;
      accumulatedTimeMs += Math.min(deltaTimeMs, 33.333);
      setTimeMs(accumulatedTimeMs);
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [setTimeMs]);

  return null;
};

const LayoutDemoScene = () => {
  const timeMs = useTimeMs();
  const windowMetrics = useWindowMetrics();
  const oscillation = (Math.sin(timeMs / 900) + 1) * 0.5;
  const inspectorWidth = 340 + (oscillation * 220);
  const viewportWidth = windowMetrics.logicalWidth;
  const viewportHeight = windowMetrics.logicalHeight;
  const contentWidth = Math.min(1120, viewportWidth - 80);
  const flowingCardMaxWidth = Math.max(contentWidth - 280, 280);

  return (
    <g2d-scene
      id='byow-layout-demo'
      clearColor={backgroundColor}
      textHost={demoTextHost}
    >
      <DemoFrameDriver />
      <g2l-root
        id='layout-demo-root'
        x={40}
        y={40}
        width={contentWidth}
        height={Math.max(0, viewportHeight - 80)}
        textHost={demoTextHost}
      >
        <g2l-box
          id='layout-demo-stack'
          style={{
            width: contentWidth,
            padding: 0,
            gap: 20,
          }}
          render={renderBoxNode}
        >
          <g2l-box
            id='layout-demo-hero'
            style={{
              width: contentWidth,
              padding: 24,
              gap: 16,
              backgroundColor: [0.12, 0.13, 0.17, 1],
              borderColor: [0.22, 0.25, 0.32, 1],
              borderWidth: 1,
              cornerRadius: 18,
            }}
            render={renderBoxNode}
          >
            <g2l-text
              id='layout-demo-title'
              text='Goldlight Layout Prototype'
              style={{
                fontSize: 34,
                fontFamily: latinFamilies,
                lineHeight: 40,
              }}
              render={renderTextNode}
            />
            <g2l-text
              id='layout-demo-subtitle'
              text={`Taffy-style outer boxes, Pretext-style paragraph preparation, and drawing-backed ${layoutDemoTextMode.toUpperCase()} text.`}
              style={{
                fontSize: 18,
                fontFamily: latinFamilies,
                lineHeight: 24,
              }}
              render={renderTextNode}
            />
            <g2l-box
              id='layout-demo-badges'
              style={{
                direction: 'row',
                gap: 16,
                padding: { left: 14, right: 14, top: 10, bottom: 10 },
                backgroundColor: [0.12, 0.15, 0.19, 1],
                borderColor: [0.21, 0.24, 0.29, 1],
                borderWidth: 1,
                cornerRadius: 12,
              }}
              render={renderBoxNode}
            >
              <g2l-text
                id='layout-demo-badge-lines'
                text='logical-order lines'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
                render={renderTextNode}
              />
              <g2l-text
                id='layout-demo-badge-runs'
                text='run-based output'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
                render={renderTextNode}
              />
              <g2l-text
                id='layout-demo-badge-bidi'
                text='bidi-safe structure'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
                render={renderTextNode}
              />
            </g2l-box>
          </g2l-box>
          <g2l-box
            id='layout-demo-lower-row'
            style={{
              direction: 'row',
              gap: 20,
              alignItems: 'start',
            }}
            render={renderBoxNode}
          >
            <g2l-box
              id='layout-demo-flowing-card'
              style={{
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
              }}
              render={renderBoxNode}
            >
              <g2l-text
                id='layout-demo-flowing-title'
                text={`Animated paragraph width: ${Math.round(inspectorWidth)}px`}
                style={{
                  fontSize: 18,
                  fontFamily: latinFamilies,
                  lineHeight: 24,
                }}
                render={renderTextNode}
              />
              <g2l-text
                id='layout-demo-flowing-paragraph'
                text='This panel recomputes paragraph layout every frame against an animated width constraint so line wrapping is easy to inspect while the rest of the engine stays alive.'
                style={{
                  fontSize: 19,
                  fontFamily: latinFamilies,
                  lineHeight: 28,
                }}
                render={renderTextNode}
              />
              <g2l-text
                id='layout-demo-flowing-hangul'
                text='다람쥐 헌 쳇바퀴에 타고파 라인이 폭에 따라 다시 배치됩니다.'
                style={{
                  fontSize: 22,
                  fontFamily: hangulFamilies,
                  lineHeight: 30,
                }}
                render={renderTextNode}
              />
            </g2l-box>
            <g2l-box
              id='layout-demo-metrics-card'
              style={{
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
              }}
              render={renderBoxNode}
            >
              <g2l-text
                id='layout-demo-metrics-title'
                text='Current Constraints'
                style={{
                  fontSize: 18,
                  fontFamily: latinFamilies,
                  lineHeight: 24,
                }}
                render={renderTextNode}
              />
              <g2l-text
                id='layout-demo-metrics-body'
                text={`viewport=${Math.round(viewportWidth)}px\ncontent=${
                  Math.round(contentWidth)
                }px\ninspector=${Math.round(inspectorWidth)}px`}
                style={{
                  fontSize: 16,
                  fontFamily: latinFamilies,
                  lineHeight: 22,
                }}
                render={renderTextNode}
              />
            </g2l-box>
          </g2l-box>
        </g2l-box>
      </g2l-root>
    </g2d-scene>
  );
};

export default initializeWindow(LayoutDemoScene, {
  initialRendererConfig: {
    msaaSampleCount: 1,
    postProcessPasses: [],
  },
});
