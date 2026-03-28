import { layoutParagraph } from './paragraph.ts';
import type { LayoutAvailableSize } from './types.ts';
import {
  clampLayoutSize,
  type ComputedLayoutBoxNode,
  type ComputedLayoutNode,
  type ComputedLayoutTextNode,
  type LayoutAxis,
  type LayoutBoxNode,
  type LayoutLength,
  type LayoutNode,
  type LayoutTextNode,
  normalizeLayoutInsets,
} from './tree.ts';

const infinityForAvailableSpace = (value: LayoutAvailableSize['width']): number =>
  value.kind === 'definite' ? value.value : Number.POSITIVE_INFINITY;

const resolveLength = (
  length: LayoutLength | undefined,
  fallback: number,
): number => (length === undefined || length === 'auto' ? fallback : length);

const measureTextNode = (
  node: LayoutTextNode,
  availableSize: LayoutAvailableSize,
  x: number,
  y: number,
): ComputedLayoutTextNode => {
  const widthMode = node.style?.width;
  const heightMode = node.style?.height;

  let paragraphWidth: number;
  if (typeof widthMode === 'number') {
    paragraphWidth = widthMode;
  } else if (availableSize.width.kind === 'definite') {
    paragraphWidth = availableSize.width.value;
  } else if (availableSize.width.kind === 'min-content') {
    paragraphWidth = node.prepared.minContentWidth;
  } else {
    paragraphWidth = node.prepared.maxContentWidth;
  }

  const paragraphLayout = layoutParagraph(node.prepared, paragraphWidth);
  const width = resolveLength(widthMode, paragraphLayout.width);
  const height = resolveLength(heightMode, paragraphLayout.height);

  return {
    kind: 'text',
    x,
    y,
    width,
    height,
    node,
    children: [],
  };
};

const computeColumnBoxNode = (
  node: LayoutBoxNode,
  availableSize: LayoutAvailableSize,
  x: number,
  y: number,
): ComputedLayoutBoxNode => {
  const style = node.style;
  const padding = normalizeLayoutInsets(style?.padding);
  const gap = style?.gap ?? 0;

  const outerWidthHint = style?.width;
  const innerAvailableWidth = typeof outerWidthHint === 'number'
    ? Math.max(outerWidthHint - padding.left - padding.right, 0)
    : availableSize.width.kind === 'definite'
    ? Math.max(availableSize.width.value - padding.left - padding.right, 0)
    : infinityForAvailableSpace(availableSize.width);

  const children: ComputedLayoutNode[] = [];
  let cursorY = y + padding.top;
  let maxChildWidth = 0;

  for (const child of node.children) {
    const childLayout = computeLayoutNode(
      child,
      {
        width: Number.isFinite(innerAvailableWidth)
          ? { kind: 'definite', value: innerAvailableWidth }
          : availableSize.width,
        height: availableSize.height,
      },
      x + padding.left,
      cursorY,
    );
    children.push(childLayout);
    cursorY += childLayout.height + gap;
    maxChildWidth = Math.max(maxChildWidth, childLayout.width);
  }

  if (children.length > 0) {
    cursorY -= gap;
  }

  const contentHeight = Math.max(cursorY - y - padding.top, 0);
  const autoWidth = maxChildWidth + padding.left + padding.right;
  const autoHeight = contentHeight + padding.top + padding.bottom;
  const width = clampLayoutSize(
    resolveLength(style?.width, autoWidth),
    style?.minWidth,
    style?.maxWidth,
  );
  const height = clampLayoutSize(
    resolveLength(style?.height, autoHeight),
    style?.minHeight,
    style?.maxHeight,
  );

  return {
    kind: 'box',
    x,
    y,
    width,
    height,
    node,
    children,
  };
};

const computeRowBoxNode = (
  node: LayoutBoxNode,
  availableSize: LayoutAvailableSize,
  x: number,
  y: number,
): ComputedLayoutBoxNode => {
  const style = node.style;
  const padding = normalizeLayoutInsets(style?.padding);
  const gap = style?.gap ?? 0;
  const children: ComputedLayoutNode[] = [];
  let cursorX = x + padding.left;
  let maxChildHeight = 0;

  for (const child of node.children) {
    const childLayout = computeLayoutNode(
      child,
      {
        width: { kind: 'max-content' },
        height: availableSize.height,
      },
      cursorX,
      y + padding.top,
    );
    children.push(childLayout);
    cursorX += childLayout.width + gap;
    maxChildHeight = Math.max(maxChildHeight, childLayout.height);
  }

  if (children.length > 0) {
    cursorX -= gap;
  }

  const contentWidth = Math.max(cursorX - x - padding.left, 0);
  const autoWidth = contentWidth + padding.left + padding.right;
  const autoHeight = maxChildHeight + padding.top + padding.bottom;
  const width = clampLayoutSize(
    resolveLength(style?.width, autoWidth),
    style?.minWidth,
    style?.maxWidth,
  );
  const height = clampLayoutSize(
    resolveLength(style?.height, autoHeight),
    style?.minHeight,
    style?.maxHeight,
  );

  return {
    kind: 'box',
    x,
    y,
    width,
    height,
    node,
    children,
  };
};

const computeBoxNode = (
  node: LayoutBoxNode,
  availableSize: LayoutAvailableSize,
  x: number,
  y: number,
): ComputedLayoutBoxNode => {
  const axis: LayoutAxis = node.style?.direction ?? 'column';
  return axis === 'row'
    ? computeRowBoxNode(node, availableSize, x, y)
    : computeColumnBoxNode(node, availableSize, x, y);
};

export const computeLayoutNode = (
  node: LayoutNode,
  availableSize: LayoutAvailableSize,
  x = 0,
  y = 0,
): ComputedLayoutNode =>
  node.kind === 'text'
    ? measureTextNode(node, availableSize, x, y)
    : computeBoxNode(node, availableSize, x, y);

export const computeLayout = (
  root: LayoutNode,
  availableSize: LayoutAvailableSize,
): ComputedLayoutNode => computeLayoutNode(root, availableSize);
