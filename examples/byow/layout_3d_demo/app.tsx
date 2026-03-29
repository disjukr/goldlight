/** @jsx React.createElement */
/** @jsxFrag React.Fragment */
/// <reference lib="deno.unstable" />
/// <reference lib="dom" />

import React from 'npm:react@19.2.0';
import {
  initializeWindow,
  useSetTimeMs,
  useTimeMs,
  useWindowMetrics,
} from '@disjukr/goldlight/desktop';
import { createRRectPath2d } from '@disjukr/goldlight/geometry';
import type { MeshPrimitive } from '@disjukr/goldlight/ir';
import { createQuaternionFromEulerDegrees } from '@disjukr/goldlight/math';
import { createTextHost } from '@disjukr/goldlight/text';
import {
  type G2lBoxRenderNode,
  type G2lRenderContext,
  type G2lRenderNode,
  type G2lRenderTreeReader,
  type G2lTextRenderNode,
  G3dDirectionalLight,
  G3dPerspectiveCamera,
} from '@disjukr/goldlight/react/reconciler';

const demoTextHost = createTextHost();

const backgroundColor: readonly [number, number, number, number] = [0.06, 0.07, 0.09, 1];
const defaultTextColor: readonly [number, number, number, number] = [0.93, 0.94, 0.97, 1];
const mutedTextColor: readonly [number, number, number, number] = [0.72, 0.76, 0.84, 1];
const accentTextColor: readonly [number, number, number, number] = [0.98, 0.81, 0.42, 1];
const latinFamilies = ['Calibri', 'Segoe UI', 'Arial'] as const;
const hangulFamilies = ['Malgun Gothic', 'Segoe UI', 'Arial Unicode MS'] as const;
const boardScale = 0.0038;
const panelDepth = 0.16;
const panelSurfaceOffset = 0.003;
const panelSurfaceInset = 0.018;
const panelCornerSegments = 28;
const layoutViewportPadding = 120;
const layoutMaxContentWidth = 1120;
const heroCardWidth = 780;
const layoutDesignViewportWidth = 1280;
const layoutDesignHeight = 760;

const panelMeshAttributes = [
  {
    semantic: 'POSITION' as const,
    itemSize: 3,
    values: [
      -0.5,
      0.5,
      0,
      -0.5,
      -0.5,
      0,
      0.5,
      -0.5,
      0,
      0.5,
      0.5,
      0,
    ],
  },
  {
    semantic: 'TEXCOORD_0' as const,
    itemSize: 2,
    values: [0, 0, 0, 1, 1, 1, 1, 0],
  },
];

const keyLightRotation = (() => {
  const rotation = createQuaternionFromEulerDegrees(-40, -28, 0);
  return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
})();

const fillLightRotation = (() => {
  const rotation = createQuaternionFromEulerDegrees(-12, 64, 0);
  return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
})();

const rimLightRotation = (() => {
  const rotation = createQuaternionFromEulerDegrees(32, 184, 0);
  return [rotation.x, rotation.y, rotation.z, rotation.w] as const;
})();

type CardId = 'hero' | 'flowing' | 'metrics';

type LayoutCard = Readonly<{
  id: CardId;
  textureId: string;
  bodyMeshId: string;
  surfaceMeshId: string;
  node: G2lBoxRenderNode;
  zOffset: number;
}>;

const createRoundedRectContour = (
  width: number,
  height: number,
  radius: number,
  segments: number,
): readonly (readonly [number, number])[] => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const clampedRadius = Math.min(radius, halfWidth, halfHeight);
  const cornerCount = Math.max(1, segments);
  const contour: [number, number][] = [];
  const corners = [
    {
      center: [halfWidth - clampedRadius, halfHeight - clampedRadius] as const,
      start: 0,
      end: Math.PI / 2,
    },
    {
      center: [-(halfWidth - clampedRadius), halfHeight - clampedRadius] as const,
      start: Math.PI / 2,
      end: Math.PI,
    },
    {
      center: [-(halfWidth - clampedRadius), -(halfHeight - clampedRadius)] as const,
      start: Math.PI,
      end: Math.PI * 1.5,
    },
    {
      center: [halfWidth - clampedRadius, -(halfHeight - clampedRadius)] as const,
      start: Math.PI * 1.5,
      end: Math.PI * 2,
    },
  ];

  corners.forEach((corner, cornerIndex) => {
    for (let index = 0; index <= cornerCount; index += 1) {
      if (cornerIndex > 0 && index === 0) {
        continue;
      }
      const t = index / cornerCount;
      const angle = corner.start + ((corner.end - corner.start) * t);
      contour.push([
        corner.center[0] + (Math.cos(angle) * clampedRadius),
        corner.center[1] + (Math.sin(angle) * clampedRadius),
      ]);
    }
  });
  contour.pop();
  return contour;
};

const createExtrudedRoundedRectMesh = (
  id: string,
  width: number,
  height: number,
  depth: number,
  radius: number,
  segments: number,
): MeshPrimitive => {
  const positions: number[] = [];
  const normals: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const contour = createRoundedRectContour(width, height, radius, segments);
  const halfDepth = depth / 2;

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
  ) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    texcoords.push(u, v);
    return (positions.length / 3) - 1;
  };

  const frontCenter = pushVertex(0, 0, halfDepth, 0, 0, 1, 0.5, 0.5);
  contour.forEach(([x, y]) => {
    pushVertex(x, y, halfDepth, 0, 0, 1, (x / width) + 0.5, 0.5 - (y / height));
  });
  for (let index = 0; index < contour.length; index += 1) {
    const current = frontCenter + 1 + index;
    const next = frontCenter + 1 + ((index + 1) % contour.length);
    indices.push(frontCenter, current, next);
  }

  const backCenter = pushVertex(0, 0, -halfDepth, 0, 0, -1, 0.5, 0.5);
  contour.forEach(([x, y]) => {
    pushVertex(x, y, -halfDepth, 0, 0, -1, (x / width) + 0.5, 0.5 - (y / height));
  });
  for (let index = 0; index < contour.length; index += 1) {
    const current = backCenter + 1 + index;
    const next = backCenter + 1 + ((index + 1) % contour.length);
    indices.push(backCenter, next, current);
  }

  let perimeterOffset = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const [x0, y0] = contour[index]!;
    const [x1, y1] = contour[(index + 1) % contour.length]!;
    const edgeX = x1 - x0;
    const edgeY = y1 - y0;
    const edgeLength = Math.hypot(edgeX, edgeY) || 1;
    const normalX = edgeY / edgeLength;
    const normalY = -edgeX / edgeLength;
    const u0 = perimeterOffset / ((width + height) * 2);
    perimeterOffset += edgeLength;
    const u1 = perimeterOffset / ((width + height) * 2);
    const a = pushVertex(x0, y0, halfDepth, normalX, normalY, 0, u0, 0);
    const b = pushVertex(x1, y1, halfDepth, normalX, normalY, 0, u1, 0);
    const c = pushVertex(x1, y1, -halfDepth, normalX, normalY, 0, u1, 1);
    const d = pushVertex(x0, y0, -halfDepth, normalX, normalY, 0, u0, 1);
    indices.push(a, d, b, b, d, c);
  }

  return {
    id,
    materialId: undefined,
    attributes: [
      { semantic: 'POSITION', itemSize: 3, values: positions },
      { semantic: 'NORMAL', itemSize: 3, values: normals },
      { semantic: 'TEXCOORD_0', itemSize: 2, values: texcoords },
    ],
    indices,
  };
};

const createCardBodyMesh = (card: LayoutCard) =>
  createExtrudedRoundedRectMesh(
    card.bodyMeshId,
    card.node.boxes.borderRect.width * boardScale,
    card.node.boxes.borderRect.height * boardScale,
    panelDepth,
    Math.max(0.0001, (card.node.style?.cornerRadius ?? 0) * boardScale),
    panelCornerSegments,
  );

const createBoxPath = (
  node: G2lBoxRenderNode,
  panelRoot: G2lBoxRenderNode,
) => {
  const rect = node.boxes.borderRect;
  const panelRect = panelRoot.boxes.borderRect;
  const radius = node.style?.cornerRadius ?? 0;
  return createRRectPath2d({
    rect: {
      origin: [rect.x - panelRect.x, rect.y - panelRect.y],
      size: {
        width: rect.width,
        height: rect.height,
      },
    },
    topLeft: { x: radius, y: radius },
    topRight: { x: radius, y: radius },
    bottomRight: { x: radius, y: radius },
    bottomLeft: { x: radius, y: radius },
  });
};

const getPreparedTextColor = (fontSize: number): readonly [number, number, number, number] => {
  if (fontSize >= 28) {
    return accentTextColor;
  }
  if (fontSize >= 18) {
    return defaultTextColor;
  }
  return mutedTextColor;
};

const asBoxNode = (node: G2lRenderNode | undefined): G2lBoxRenderNode => {
  if (!node || node.kind !== 'box') {
    throw new Error('Expected layout box node');
  }
  return node;
};

const isPureHardBreakClusterText = (text: string): boolean =>
  text.replaceAll('\r', '').replaceAll('\n', '').length === 0;

const extractLineText = (
  node: G2lTextRenderNode,
  run: G2lTextRenderNode['paragraph']['layout']['lines'][number]['runs'][number],
): string => {
  const preparedRun = node.paragraph.prepared.runs[run.logicalStart.runIndex];
  if (!preparedRun) {
    return '';
  }
  let text = '';
  for (
    let clusterIndex = run.logicalStart.clusterIndex;
    clusterIndex < run.logicalEnd.clusterIndex;
    clusterIndex += 1
  ) {
    const cluster = preparedRun.clusters[clusterIndex];
    if (!cluster) {
      continue;
    }
    if (isPureHardBreakClusterText(cluster.text)) {
      continue;
    }
    text += cluster.text.replaceAll('\r', '').replaceAll('\n', '');
  }
  return text;
};

const renderLayoutNode2d = (
  node: G2lRenderNode,
  panelRoot: G2lBoxRenderNode,
  tree: G2lRenderTreeReader,
  keyPrefix: string,
  skipOwnChrome: boolean,
): React.ReactNode[] => {
  if (node.kind === 'box') {
    const style = node.style;
    const path = createBoxPath(node, panelRoot);
    const output: React.ReactNode[] = [];
    if (!skipOwnChrome && style?.backgroundColor) {
      output.push(
        <g2d-path
          key={`${keyPrefix}-fill`}
          path={path}
          style='fill'
          color={style.backgroundColor}
        />,
      );
    }
    if (!skipOwnChrome && style?.borderColor && (style.borderWidth ?? 0) > 0) {
      output.push(
        <g2d-path
          key={`${keyPrefix}-border`}
          path={path}
          style='stroke'
          strokeWidth={style.borderWidth}
          color={style.borderColor}
        />,
      );
    }
    for (const [index, child] of tree.getChildren(node.id).entries()) {
      output.push(...renderLayoutNode2d(child, panelRoot, tree, `${keyPrefix}-${index}`, false));
    }
    return output;
  }

  if (node.kind !== 'text') {
    return [];
  }
  const style = node.style;
  const lineHeight = style?.lineHeight ?? style?.fontSize ?? 16;
  const color = getPreparedTextColor(style?.fontSize ?? 16);
  const contentRect = node.boxes.contentRect;
  const panelRect = panelRoot.boxes.borderRect;
  return node.paragraph.layout.lines.flatMap((line, lineIndex) => {
    const baselineY = (contentRect.y - panelRect.y) + (lineIndex * lineHeight) +
      Math.abs(line.ascent);
    return line.runs.map((run, runIndex) => {
      if (run.glyphStart >= run.glyphEnd) {
        return null;
      }
      const text = extractLineText(node, run);
      if (text.length === 0) {
        return null;
      }
      return (
        <g2d-glyphs
          key={`${keyPrefix}-line-${lineIndex}-run-${runIndex}`}
          x={(contentRect.x - panelRect.x) + run.x}
          y={baselineY}
          text={text}
          mode='sdf'
          color={color}
          fontSize={style?.fontSize ?? 16}
          fontFamily={style?.fontFamily}
          direction={style?.direction}
          language={style?.language}
          scriptTag={style?.scriptTag}
          textHost={demoTextHost}
        />
      );
    });
  });
};

const extractCards = (tree: G2lRenderTreeReader): readonly LayoutCard[] => {
  const hero = asBoxNode(tree.getNode('layout-hero-card'));
  const flowing = asBoxNode(tree.getNode('layout-flowing-card'));
  const metrics = asBoxNode(tree.getNode('layout-metrics-card'));
  return [
    {
      id: 'hero',
      textureId: 'layout-hero-texture',
      bodyMeshId: 'layout-hero-body-mesh',
      surfaceMeshId: 'layout-hero-surface-mesh',
      node: hero,
      zOffset: 0,
    },
    {
      id: 'flowing',
      textureId: 'layout-flowing-texture',
      bodyMeshId: 'layout-flowing-body-mesh',
      surfaceMeshId: 'layout-flowing-surface-mesh',
      node: flowing,
      zOffset: 0.06,
    },
    {
      id: 'metrics',
      textureId: 'layout-metrics-texture',
      bodyMeshId: 'layout-metrics-body-mesh',
      surfaceMeshId: 'layout-metrics-surface-mesh',
      node: metrics,
      zOffset: 0.12,
    },
  ];
};

const FrameDriver = () => {
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

const renderLayoutBoard = (
  context: G2lRenderContext,
  scaleFactor: number,
  boardRotation: readonly [number, number, number, number],
): React.ReactNode => {
  if (context.node.kind !== 'root') {
    throw new Error('layout board render expects the g2l root node');
  }
  const rootNode = context.node;
  const cards = extractCards(context.tree);
  const boardWidth = rootNode.boxes.borderRect.width;
  const boardHeight = rootNode.boxes.borderRect.height;

  return (
    <>
      {cards.map((card) => (
        <g3d-mesh
          key={`body-mesh-${card.id}`}
          {...createCardBodyMesh(card)}
          materialId={card.id === 'hero'
            ? 'layout-hero-body-material'
            : card.id === 'flowing'
            ? 'layout-flowing-body-material'
            : 'layout-metrics-body-material'}
        />
      ))}
      <g3d-material
        id='layout-hero-body-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.18, y: 0.19, z: 0.24, w: 1 },
          emissive: { x: 0.01, y: 0.01, z: 0.02, w: 1 },
          metallicRoughness: { x: 0.04, y: 0.72, z: 1, w: 1 },
        }}
      />
      <g3d-material
        id='layout-flowing-body-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.2, y: 0.21, z: 0.26, w: 1 },
          emissive: { x: 0.01, y: 0.01, z: 0.02, w: 1 },
          metallicRoughness: { x: 0.04, y: 0.74, z: 1, w: 1 },
        }}
      />
      <g3d-material
        id='layout-metrics-body-material'
        kind='lit'
        textures={[]}
        parameters={{
          color: { x: 0.14, y: 0.18, z: 0.22, w: 1 },
          emissive: { x: 0.01, y: 0.02, z: 0.02, w: 1 },
          metallicRoughness: { x: 0.04, y: 0.7, z: 1, w: 1 },
        }}
      />
      <g3d-material
        id='layout-hero-surface-material'
        kind='unlit'
        shaderId='built-in:unlit-textured-premul'
        alphaMode='blend'
        depthWrite={false}
        doubleSided
        textures={[{
          id: 'layout-hero-texture',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear',
        }]}
        parameters={{ color: { x: 1, y: 1, z: 1, w: 1 } }}
      />
      <g3d-material
        id='layout-flowing-surface-material'
        kind='unlit'
        shaderId='built-in:unlit-textured-premul'
        alphaMode='blend'
        depthWrite={false}
        doubleSided
        textures={[{
          id: 'layout-flowing-texture',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear',
        }]}
        parameters={{ color: { x: 1, y: 1, z: 1, w: 1 } }}
      />
      <g3d-material
        id='layout-metrics-surface-material'
        kind='unlit'
        shaderId='built-in:unlit-textured-premul'
        alphaMode='blend'
        depthWrite={false}
        doubleSided
        textures={[{
          id: 'layout-metrics-texture',
          semantic: 'baseColor',
          colorSpace: 'srgb',
          sampler: 'linear',
        }]}
        parameters={{ color: { x: 1, y: 1, z: 1, w: 1 } }}
      />
      <g3d-mesh
        id='layout-hero-surface-mesh'
        attributes={panelMeshAttributes}
        indices={[0, 1, 2, 0, 2, 3]}
        materialId='layout-hero-surface-material'
      />
      <g3d-mesh
        id='layout-flowing-surface-mesh'
        attributes={panelMeshAttributes}
        indices={[0, 1, 2, 0, 2, 3]}
        materialId='layout-flowing-surface-material'
      />
      <g3d-mesh
        id='layout-metrics-surface-mesh'
        attributes={panelMeshAttributes}
        indices={[0, 1, 2, 0, 2, 3]}
        materialId='layout-metrics-surface-material'
      />
      <g3d-node
        id='layout-board-root'
        position={[0, -0.05, 0]}
        rotation={boardRotation}
      >
        {cards.map((card) => {
          const rect = card.node.boxes.borderRect;
          const centerX = ((rect.x + (rect.width / 2)) - (boardWidth / 2)) * boardScale;
          const centerY = ((boardHeight / 2) - (rect.y + (rect.height / 2))) * boardScale;
          const width = rect.width * boardScale;
          const height = rect.height * boardScale;
          const surfaceWidth = Math.max(0.001, width - (panelSurfaceInset * 2));
          const surfaceHeight = Math.max(0.001, height - (panelSurfaceInset * 2));
          return (
            <g3d-node
              key={card.id}
              id={`layout-card-${card.id}`}
              position={[centerX, centerY, card.zOffset]}
            >
              <g3d-node id={`layout-card-${card.id}-body`} meshId={card.bodyMeshId} />
              <g3d-node
                id={`layout-card-${card.id}-surface`}
                meshId={card.surfaceMeshId}
                position={[0, 0, (panelDepth / 2) + panelSurfaceOffset]}
                scale={[surfaceWidth, surfaceHeight, 1]}
              />
            </g3d-node>
          );
        })}
      </g3d-node>
      {cards.map((card) => {
        const viewportWidth = Math.max(1, Math.ceil(card.node.boxes.borderRect.width));
        const viewportHeight = Math.max(1, Math.ceil(card.node.boxes.borderRect.height));
        const textureWidth = Math.max(1, Math.round(viewportWidth * scaleFactor));
        const textureHeight = Math.max(1, Math.round(viewportHeight * scaleFactor));
        return (
          <g2d-scene
            key={`scene-${card.id}`}
            id={`layout-card-surface-${card.id}`}
            outputTextureId={card.textureId}
            textHost={demoTextHost}
            clearColor={[0, 0, 0, 0]}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            textureWidth={textureWidth}
            textureHeight={textureHeight}
          >
            {renderLayoutNode2d(card.node, card.node, context.tree, `panel-${card.id}`, true)}
          </g2d-scene>
        );
      })}
    </>
  );
};

const Layout3dScene = () => {
  const timeMs = useTimeMs();
  const { scaleFactor } = useWindowMetrics();
  const contentWidth = Math.min(
    layoutMaxContentWidth,
    layoutDesignViewportWidth - layoutViewportPadding,
  );
  const inspectorWidth = 340 + (((Math.sin(timeMs / 900) + 1) * 0.5) * 220);
  const flowingCardMaxWidth = Math.max(contentWidth - 280, 280);
  const timeSeconds = timeMs / 1000;
  const boardRotationQuaternion = createQuaternionFromEulerDegrees(
    -16 + (Math.sin(timeSeconds * 0.42) * 2.8),
    -24 + (Math.cos(timeSeconds * 0.33) * 4.5),
    Math.sin(timeSeconds * 0.51) * 1.4,
  );
  const boardRotation = [
    boardRotationQuaternion.x,
    boardRotationQuaternion.y,
    boardRotationQuaternion.z,
    boardRotationQuaternion.w,
  ] as const;

  return (
    <g3d-scene
      id='byow-layout-3d-demo'
      activeCameraId='camera-main'
      clearColor={backgroundColor}
    >
      <FrameDriver />
      <G3dPerspectiveCamera
        id='camera-main'
        position={[-0.2, 0.09, 2.04]}
        znear={0.05}
        zfar={32}
        yfov={Math.PI / 3}
      />
      <G3dDirectionalLight
        id='key-light'
        color={{ x: 1, y: 0.97, z: 0.92 }}
        intensity={3.9}
        nodeId='key-light-node'
        rotation={keyLightRotation}
      />
      <G3dDirectionalLight
        id='fill-light'
        color={{ x: 0.6, y: 0.74, z: 1 }}
        intensity={1.8}
        nodeId='fill-light-node'
        rotation={fillLightRotation}
      />
      <G3dDirectionalLight
        id='rim-light'
        color={{ x: 0.4, y: 0.52, z: 0.8 }}
        intensity={0.8}
        nodeId='rim-light-node'
        rotation={rimLightRotation}
      />
      <g2l-root
        id='layout-3d-root'
        width={contentWidth}
        height={layoutDesignHeight}
        textHost={demoTextHost}
        render={(context) => renderLayoutBoard(context, scaleFactor, boardRotation)}
      >
        <g2l-box
          id='layout-stack'
          style={{
            width: contentWidth,
            padding: 0,
            gap: 20,
          }}
        >
          <g2l-box
            id='layout-hero-card'
            style={{
              width: Math.min(contentWidth, heroCardWidth),
              padding: 24,
              gap: 16,
              backgroundColor: [0.12, 0.13, 0.17, 1],
              borderColor: [0.22, 0.25, 0.32, 1],
              borderWidth: 1,
              cornerRadius: 18,
            }}
          >
            <g2l-text
              id='layout-title'
              text='Goldlight Layout in 3D'
              style={{
                fontSize: 34,
                fontFamily: latinFamilies,
                lineHeight: 40,
              }}
            />
            <g2l-text
              id='layout-subtitle'
              text='Taffy-style card layout feeding nested g2d-scene textures on rounded 3D panels.'
              style={{
                fontSize: 18,
                fontFamily: latinFamilies,
                lineHeight: 24,
              }}
            />
            <g2l-box
              id='layout-badges'
              style={{
                direction: 'row',
                gap: 16,
                padding: { left: 14, right: 14, top: 10, bottom: 10 },
                backgroundColor: [0.12, 0.15, 0.19, 1],
                borderColor: [0.21, 0.24, 0.29, 1],
                borderWidth: 1,
                cornerRadius: 12,
              }}
            >
              <g2l-text
                id='layout-badge-size'
                text='layout drives texture size'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
              />
              <g2l-text
                id='layout-badge-text'
                text='text stays 2d'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
              />
              <g2l-text
                id='layout-badge-panel'
                text='panel stays 3d'
                style={{
                  fontSize: 15,
                  fontFamily: latinFamilies,
                  lineHeight: 18,
                }}
              />
            </g2l-box>
          </g2l-box>
          <g2l-box
            id='layout-lower-row'
            style={{
              direction: 'row',
              gap: 20,
              alignItems: 'start',
            }}
          >
            <g2l-box
              id='layout-flowing-card'
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
            >
              <g2l-text
                id='layout-flowing-title'
                text={`Animated paragraph width: ${Math.round(inspectorWidth)}px`}
                style={{
                  fontSize: 18,
                  fontFamily: latinFamilies,
                  lineHeight: 24,
                }}
              />
              <g2l-text
                id='layout-flowing-body'
                text='This panel recomputes paragraph layout every frame against an animated width constraint and then remaps the result onto a tilted 3D card.'
                style={{
                  fontSize: 19,
                  fontFamily: latinFamilies,
                  lineHeight: 28,
                }}
              />
              <g2l-text
                id='layout-flowing-hangul'
                text='다람쥐 헌 쳇바퀴에 타고파 라인이 폭에 따라 다시 배치됩니다.'
                style={{
                  fontSize: 22,
                  fontFamily: hangulFamilies,
                  lineHeight: 30,
                }}
              />
            </g2l-box>
            <g2l-box
              id='layout-metrics-card'
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
            >
              <g2l-text
                id='layout-metrics-title'
                text='Current Constraints'
                style={{
                  fontSize: 18,
                  fontFamily: latinFamilies,
                  lineHeight: 24,
                }}
              />
              <g2l-text
                id='layout-metrics-body'
                text={`viewport=${Math.round(layoutDesignViewportWidth)}px\ncontent=${
                  Math.round(contentWidth)
                }px\ninspector=${Math.round(inspectorWidth)}px`}
                style={{
                  fontSize: 16,
                  fontFamily: latinFamilies,
                  lineHeight: 22,
                }}
              />
            </g2l-box>
          </g2l-box>
        </g2l-box>
      </g2l-root>
    </g3d-scene>
  );
};

export default initializeWindow(Layout3dScene);
