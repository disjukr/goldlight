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
import {
  type ComputedLayoutNode,
  computeLayout,
  createBoxLayoutNode,
  createTextLayoutNode,
  layoutParagraph,
  prepareParagraph,
} from '@disjukr/goldlight/layout';
import { createRRectPath2d } from '@disjukr/goldlight/geometry';
import type { MeshPrimitive } from '@disjukr/goldlight/ir';
import { createQuaternionFromEulerDegrees } from '@disjukr/goldlight/math';
import { createTextHost } from '@disjukr/goldlight/text';
import { G3dDirectionalLight, G3dPerspectiveCamera } from '@disjukr/goldlight/react/reconciler';

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
  node: ComputedLayoutNode & { kind: 'box' };
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
    card.node.width * boardScale,
    card.node.height * boardScale,
    panelDepth,
    Math.max(0.0001, (card.node.node.style?.cornerRadius ?? 0) * boardScale),
    panelCornerSegments,
  );

const isPureHardBreakClusterText = (text: string): boolean =>
  text.replaceAll('\r', '').replaceAll('\n', '').length === 0;

const createBoxPath = (
  node: ComputedLayoutNode & { kind: 'box' },
  originX: number,
  originY: number,
) => {
  const radius = node.node.style?.cornerRadius ?? 0;
  return createRRectPath2d({
    rect: {
      origin: [node.x - originX, node.y - originY],
      size: {
        width: node.width,
        height: node.height,
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

const extractLineText = (
  node: ComputedLayoutNode & { kind: 'text' },
  run: NonNullable<ReturnType<typeof layoutParagraph>['lines'][number]>['runs'][number],
): string => {
  const preparedRun = node.node.prepared.runs[run.logicalStart.runIndex];
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

const renderComputedNode = (
  node: ComputedLayoutNode,
  panelRoot: ComputedLayoutNode & { kind: 'box' },
  keyPrefix: string,
  skipOwnChrome: boolean,
): React.ReactNode[] => {
  if (node.kind === 'box') {
    const style = node.node.style;
    const path = createBoxPath(node, panelRoot.x, panelRoot.y);
    const nodes: React.ReactNode[] = [];
    if (!skipOwnChrome && style?.backgroundColor) {
      nodes.push(
        <g2d-path
          key={`${keyPrefix}-fill`}
          path={path}
          style='fill'
          color={style.backgroundColor}
        />,
      );
    }
    if (!skipOwnChrome && style?.borderColor && (style.borderWidth ?? 0) > 0) {
      nodes.push(
        <g2d-path
          key={`${keyPrefix}-border`}
          path={path}
          style='stroke'
          strokeWidth={style.borderWidth}
          color={style.borderColor}
        />,
      );
    }
    node.children.forEach((child, index) => {
      nodes.push(
        ...renderComputedNode(child, panelRoot, `${keyPrefix}-${index}`, false),
      );
    });
    return nodes;
  }

  const prepared = node.node.prepared;
  const style = prepared.style;
  const lineHeight = style.lineHeight ?? style.fontSize;
  const paragraph = layoutParagraph(prepared, node.width, lineHeight);
  const color = getPreparedTextColor(style.fontSize);
  const nodes: React.ReactNode[] = [];

  paragraph.lines.forEach((line, lineIndex) => {
    const baselineY = (node.y - panelRoot.y) + (lineIndex * lineHeight) + Math.abs(line.ascent);
    line.runs.forEach((run, runIndex) => {
      if (run.glyphStart >= run.glyphEnd) {
        return;
      }
      const lineText = extractLineText(node, run);
      if (lineText.length === 0) {
        return;
      }
      nodes.push(
        <g2d-glyphs
          key={`${keyPrefix}-line-${lineIndex}-run-${runIndex}`}
          x={(node.x - panelRoot.x) + run.x}
          y={baselineY}
          text={lineText}
          mode='sdf'
          color={color}
          fontSize={style.fontSize}
          fontFamily={style.fontFamily}
          direction={style.direction}
          language={style.language}
          scriptTag={style.scriptTag}
        />,
      );
    });
  });

  return nodes;
};

const buildDemoTree = (
  viewportWidth: number,
  timeMs: number,
) => {
  const oscillation = (Math.sin(timeMs / 900) + 1) * 0.5;
  const inspectorWidth = 340 + (oscillation * 220);
  const contentWidth = Math.min(layoutMaxContentWidth, viewportWidth - layoutViewportPadding);
  const flowingCardMaxWidth = Math.max(contentWidth - 280, 280);

  const title = createTextLayoutNode(
    prepareParagraph(demoTextHost, 'Goldlight Layout in 3D', {
      fontSize: 34,
      fontFamily: latinFamilies,
      lineHeight: 40,
    }),
  );
  const subtitle = createTextLayoutNode(
    prepareParagraph(
      demoTextHost,
      'Taffy-style card layout feeding nested g2d-scene textures on rounded 3D panels.',
      {
        fontSize: 18,
        fontFamily: latinFamilies,
        lineHeight: 24,
      },
    ),
  );
  const paragraph = createTextLayoutNode(
    prepareParagraph(
      demoTextHost,
      'This panel recomputes paragraph layout every frame against an animated width constraint and then remaps the result onto a tilted 3D card.',
      {
        fontSize: 19,
        fontFamily: latinFamilies,
        lineHeight: 28,
      },
    ),
  );
  const hangul = createTextLayoutNode(
    prepareParagraph(
      demoTextHost,
      '다람쥐 한 챗바퀴에 타고파 라인이 폭에 따라 다시 배치됩니다.',
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
        prepareParagraph(demoTextHost, 'layout drives texture size', {
          fontSize: 15,
          fontFamily: latinFamilies,
          lineHeight: 18,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(demoTextHost, 'text stays 2d', {
          fontSize: 15,
          fontFamily: latinFamilies,
          lineHeight: 18,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(demoTextHost, 'panel stays 3d', {
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

  const heroCard = createBoxLayoutNode(
    [title, subtitle, badgeRow],
    {
      width: Math.min(contentWidth, heroCardWidth),
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
        prepareParagraph(
          demoTextHost,
          `Animated paragraph width: ${Math.round(inspectorWidth)}px`,
          {
            fontSize: 18,
            fontFamily: latinFamilies,
            lineHeight: 24,
          },
        ),
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
        prepareParagraph(demoTextHost, 'Current Constraints', {
          fontSize: 18,
          fontFamily: latinFamilies,
          lineHeight: 24,
        }),
      ),
      createTextLayoutNode(
        prepareParagraph(
          demoTextHost,
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
      heroCard,
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

const asBoxNode = (node: ComputedLayoutNode | undefined): ComputedLayoutNode & { kind: 'box' } => {
  if (!node || node.kind !== 'box') {
    throw new Error('Expected computed layout box node');
  }
  return node;
};

const extractCards = (layout: ComputedLayoutNode & { kind: 'box' }): readonly LayoutCard[] => {
  const hero = asBoxNode(layout.children[0]);
  const lowerRow = asBoxNode(layout.children[1]);
  const flowing = asBoxNode(lowerRow.children[0]);
  const metrics = asBoxNode(lowerRow.children[1]);
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

const LayoutCardSurfaceScene = (
  { card }: { card: LayoutCard },
) => {
  const { scaleFactor } = useWindowMetrics();
  const viewportWidth = Math.max(1, Math.ceil(card.node.width));
  const viewportHeight = Math.max(1, Math.ceil(card.node.height));
  const textureWidth = Math.max(1, Math.round(viewportWidth * scaleFactor));
  const textureHeight = Math.max(1, Math.round(viewportHeight * scaleFactor));

  return (
    <g2d-scene
      id={`layout-card-surface-${card.id}`}
      outputTextureId={card.textureId}
      textHost={demoTextHost}
      clearColor={[0, 0, 0, 0]}
      viewportWidth={viewportWidth}
      viewportHeight={viewportHeight}
      textureWidth={textureWidth}
      textureHeight={textureHeight}
    >
      {renderComputedNode(card.node, card.node, `panel-${card.id}`, true)}
    </g2d-scene>
  );
};

const LayoutCardNode = (
  { card, boardWidth, boardHeight }: {
    card: LayoutCard;
    boardWidth: number;
    boardHeight: number;
  },
) => {
  const centerX = ((card.node.x + (card.node.width / 2)) - (boardWidth / 2)) * boardScale;
  const centerY = ((boardHeight / 2) - (card.node.y + (card.node.height / 2))) * boardScale;
  const width = card.node.width * boardScale;
  const height = card.node.height * boardScale;
  const surfaceWidth = Math.max(0.001, width - (panelSurfaceInset * 2));
  const surfaceHeight = Math.max(0.001, height - (panelSurfaceInset * 2));

  return (
    <g3d-node
      id={`layout-card-${card.id}`}
      position={[centerX, centerY, card.zOffset]}
    >
      <g3d-node
        id={`layout-card-${card.id}-body`}
        meshId={card.bodyMeshId}
      />
      <g3d-node
        id={`layout-card-${card.id}-surface`}
        meshId={card.surfaceMeshId}
        position={[0, 0, (panelDepth / 2) + panelSurfaceOffset]}
        scale={[surfaceWidth, surfaceHeight, 1]}
      />
    </g3d-node>
  );
};

const Layout3dScene = () => {
  const timeMs = useTimeMs();
  const contentWidth = Math.min(
    layoutMaxContentWidth,
    layoutDesignViewportWidth - layoutViewportPadding,
  );
  const root = buildDemoTree(layoutDesignViewportWidth, timeMs);
  const layout = asBoxNode(computeLayout(root, {
    width: { kind: 'definite', value: contentWidth },
    height: { kind: 'definite', value: layoutDesignHeight },
  }));
  const cards = extractCards(layout);
  const timeSeconds = timeMs / 1000;
  const boardRotation = createQuaternionFromEulerDegrees(
    -16 + (Math.sin(timeSeconds * 0.42) * 2.8),
    -24 + (Math.cos(timeSeconds * 0.33) * 4.5),
    Math.sin(timeSeconds * 0.51) * 1.4,
  );

  return (
    <g3d-scene
      id='byow-layout-3d-demo'
      activeCameraId='camera-main'
      clearColor={backgroundColor}
    >
      <FrameDriver />
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
        id='layout-board-material'
        kind='unlit'
        textures={[]}
        parameters={{
          color: { x: 0.1, y: 0.11, z: 0.13, w: 1 },
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
      <g3d-node
        id='layout-board-root'
        position={[0, -0.05, 0]}
        rotation={[boardRotation.x, boardRotation.y, boardRotation.z, boardRotation.w]}
      >
        {cards.map((card) => (
          <LayoutCardNode
            key={card.id}
            card={card}
            boardWidth={layout.width}
            boardHeight={layout.height}
          />
        ))}
      </g3d-node>
      {cards.map((card) => <LayoutCardSurfaceScene key={`scene-${card.id}`} card={card} />)}
    </g3d-scene>
  );
};

export default initializeWindow(Layout3dScene);
