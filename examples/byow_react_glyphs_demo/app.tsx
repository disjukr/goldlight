/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import { initializeWindow, useSetTimeMs, useTimeMs } from '@goldlight/desktop';
import {
  createPath2d,
  createTranslationMatrix2d,
  type Matrix2d,
  multiplyMatrix2d,
  type Path2d,
} from '@goldlight/geometry';
import { createTextHost } from '@goldlight/text';

const demoTextHost = createTextHost();

const backgroundColor = [0.09, 0.1, 0.13, 1] as const;
const panelColor = [0.15, 0.16, 0.2, 1] as const;
const gridLineColor = [0.29, 0.32, 0.4, 1] as const;
const labelColor = [0.77, 0.79, 0.85, 1] as const;

const hangulPangram = '다람쥐 헌 쳇바퀴에 타고파';
const rotatedSdfLabel = '회전된 SDF 텍스트';
const rotatedTransformedMaskLabel = '회전된 transformed-mask 텍스트';

const latinFamilies = ['Calibri', 'Segoe UI'] as const;
const hangulFamilies = ['Malgun Gothic', 'Segoe UI'] as const;

const createLinePath = (fromX: number, fromY: number, toX: number, toY: number): Path2d =>
  createPath2d(
    { kind: 'moveTo', to: [fromX, fromY] },
    { kind: 'lineTo', to: [toX, toY] },
  );

const createRotationMatrix2d = (radians: number): Matrix2d => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
};

const createCenteredTransform = (
  centerX: number,
  centerY: number,
  radians: number,
  translateX = 0,
  translateY = 0,
): Matrix2d =>
  multiplyMatrix2d(
    multiplyMatrix2d(
      createTranslationMatrix2d(centerX + translateX, centerY + translateY),
      createRotationMatrix2d(radians),
    ),
    createTranslationMatrix2d(-centerX, -centerY),
  );

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

const ModeCard = (
  props: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    accent: readonly [number, number, number, number];
    title: string;
    mode: 'a8' | 'transformed-mask' | 'sdf' | 'path';
  }>,
) => (
  <>
    <g2d-rect
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      color={panelColor}
    />
    <g2d-rect
      x={props.x}
      y={props.y}
      width={props.width}
      height={6}
      color={props.accent}
    />
    <g2d-path
      path={createLinePath(props.x + 20, props.y + 56, props.x + props.width - 20, props.y + 56)}
      style='stroke'
      strokeWidth={1}
      color={gridLineColor}
    />
    <g2d-path
      path={createLinePath(
        props.x + 20,
        props.y + 110,
        props.x + props.width - 20,
        props.y + 110,
      )}
      style='stroke'
      strokeWidth={1}
      color={gridLineColor}
    />
    <g2d-glyphs
      text={props.title}
      x={props.x + 22}
      y={props.y + 36}
      fontSize={26}
      fontFamily={latinFamilies}
      mode='path'
      color={[0.95, 0.96, 0.98, 1]}
    />
    <g2d-glyphs
      text='The quick brown fox'
      x={props.x + 20}
      y={props.y + 96}
      fontSize={24}
      fontFamily={latinFamilies}
      mode={props.mode}
      color={props.accent}
    />
    <g2d-glyphs
      text='jumps over the lazy dog'
      x={props.x + 20}
      y={props.y + 126}
      fontSize={24}
      fontFamily={latinFamilies}
      mode={props.mode}
      color={props.accent}
    />
    <g2d-glyphs
      text={hangulPangram}
      x={props.x + 20}
      y={props.y + 164}
      fontSize={26}
      fontFamily={hangulFamilies}
      mode={props.mode}
      color={props.accent}
    />
  </>
);

const AffineGroupDemo = () => {
  const timeMs = useTimeMs();
  const t = timeMs / 1000;

  return (
    <>
      <g2d-glyphs
        text='Affine group transform'
        x={56}
        y={352}
        fontSize={30}
        fontFamily={latinFamilies}
        mode='path'
        color={labelColor}
      />
      <g2d-group
        transform={createCenteredTransform(172, 468, -0.16 + (Math.sin(t * 0.95) * 0.18))}
      >
        <g2d-rect
          x={94}
          y={430}
          width={156}
          height={56}
          color={[0.18, 0.16, 0.12, 0.9]}
        />
        <g2d-glyphs
          text='Rotated A8 atlas'
          x={106}
          y={464}
          fontSize={28}
          fontFamily={latinFamilies}
          mode='a8'
          color={[0.96, 0.78, 0.36, 1]}
        />
      </g2d-group>
      <g2d-group
        transform={createCenteredTransform(490, 468, 0.08 + (Math.cos(t * 0.9) * 0.22))}
      >
        <g2d-rect
          x={392}
          y={430}
          width={232}
          height={56}
          color={[0.17, 0.12, 0.18, 0.92]}
        />
        <g2d-glyphs
          text={rotatedTransformedMaskLabel}
          x={404}
          y={464}
          fontSize={24}
          fontFamily={hangulFamilies}
          mode='transformed-mask'
          color={[0.9, 0.66, 0.96, 1]}
        />
      </g2d-group>
      <g2d-group
        transform={createCenteredTransform(780, 468, -0.11 + (Math.cos(t * 1.1) * 0.24))}
      >
        <g2d-rect
          x={664}
          y={430}
          width={196}
          height={56}
          color={[0.1, 0.18, 0.18, 0.92]}
        />
        <g2d-glyphs
          text={rotatedSdfLabel}
          x={678}
          y={464}
          fontSize={27}
          fontFamily={hangulFamilies}
          mode='sdf'
          color={[0.4, 0.9, 0.86, 1]}
        />
      </g2d-group>
      <g2d-group
        transform={createCenteredTransform(1140, 468, -0.09 + (Math.sin(t * 0.7) * 0.16), 0, -10)}
      >
        <g2d-path
          path={createLinePath(988, 484, 1292, 484)}
          style='stroke'
          strokeWidth={2}
          color={[0.42, 0.45, 0.58, 1]}
        />
        <g2d-glyphs
          text='Path fallback transform'
          x={1002}
          y={468}
          fontSize={29}
          fontFamily={latinFamilies}
          mode='path'
          color={[0.78, 0.84, 1, 1]}
        />
      </g2d-group>
    </>
  );
};

const DemoScene = () => {
  return (
    <g2d-scene
      id='byow-react-glyphs-demo'
      msaaSampleCount={1}
      clearColor={backgroundColor}
      textHost={demoTextHost}
    >
      <DemoFrameDriver />
      <ModeCard
        x={32}
        y={34}
        width={285}
        height={177}
        accent={[0.97, 0.47, 0.21, 1]}
        title='A8 atlas'
        mode='a8'
      />
      <ModeCard
        x={343}
        y={34}
        width={285}
        height={177}
        accent={[0.86, 0.47, 0.98, 1]}
        title='Transformed mask'
        mode='transformed-mask'
      />
      <ModeCard
        x={654}
        y={34}
        width={285}
        height={177}
        accent={[0.18, 0.82, 0.72, 1]}
        title='SDF'
        mode='sdf'
      />
      <ModeCard
        x={965}
        y={34}
        width={285}
        height={177}
        accent={[0.39, 0.57, 1, 1]}
        title='Path fallback'
        mode='path'
      />
      <g2d-path
        path={createLinePath(52, 280, 1238, 280)}
        style='stroke'
        strokeWidth={1}
        color={gridLineColor}
      />
      <AffineGroupDemo />
    </g2d-scene>
  );
};

export default initializeWindow(DemoScene, {
  initialRendererConfig: {
    msaaSampleCount: 1,
    postProcessPasses: [],
  },
});
