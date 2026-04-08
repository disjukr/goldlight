import { layoutParagraph } from './paragraph.ts';
import type { LayoutAvailableSize } from './types.ts';
import {
  clampLayoutSize,
  type ComputedLayoutBoxNode,
  type ComputedLayoutNode,
  type ComputedLayoutTextNode,
  type LayoutAlignItems,
  type LayoutAlignSelf,
  type LayoutAxis,
  type LayoutBoxNode,
  type LayoutItemStyle,
  type LayoutJustifyContent,
  type LayoutLength,
  type LayoutNode,
  type LayoutTextNode,
  normalizeLayoutInsets,
} from './tree.ts';

type AxisKeys = Readonly<{
  mainSize: 'width' | 'height';
  crossSize: 'width' | 'height';
  mainMin: 'minWidth' | 'minHeight';
  crossMin: 'minWidth' | 'minHeight';
  mainMax: 'maxWidth' | 'maxHeight';
  crossMax: 'maxWidth' | 'maxHeight';
  mainStart: 'x' | 'y';
  crossStart: 'x' | 'y';
  paddingMainStart: 'left' | 'top';
  paddingMainEnd: 'right' | 'bottom';
  paddingCrossStart: 'left' | 'top';
  paddingCrossEnd: 'right' | 'bottom';
}>;

type MeasuredChild = Readonly<{
  node: LayoutNode;
  style?: LayoutItemStyle;
  baseMainSize: number;
  targetMainSize: number;
  layout: ComputedLayoutNode;
}>;

const resolveLength = (
  length: LayoutLength | undefined,
  fallback: number,
): number => (length === undefined || length === 'auto' ? fallback : length);

const definiteAvailableValue = (
  value: LayoutAvailableSize['width'],
): number | undefined => value.kind === 'definite' ? value.value : undefined;

const getAxisKeys = (axis: LayoutAxis): AxisKeys =>
  axis === 'row'
    ? {
      mainSize: 'width',
      crossSize: 'height',
      mainMin: 'minWidth',
      crossMin: 'minHeight',
      mainMax: 'maxWidth',
      crossMax: 'maxHeight',
      mainStart: 'x',
      crossStart: 'y',
      paddingMainStart: 'left',
      paddingMainEnd: 'right',
      paddingCrossStart: 'top',
      paddingCrossEnd: 'bottom',
    }
    : {
      mainSize: 'height',
      crossSize: 'width',
      mainMin: 'minHeight',
      crossMin: 'minWidth',
      mainMax: 'maxWidth',
      crossMax: 'maxHeight',
      mainStart: 'y',
      crossStart: 'x',
      paddingMainStart: 'top',
      paddingMainEnd: 'bottom',
      paddingCrossStart: 'left',
      paddingCrossEnd: 'right',
    };

const getNodeStyle = (node: LayoutNode): LayoutItemStyle | undefined =>
  node.kind === 'text' ? node.style : node.style;

const toAvailableSpace = (
  value: number | typeof Number.POSITIVE_INFINITY,
  fallback: LayoutAvailableSize['width'],
): LayoutAvailableSize['width'] => Number.isFinite(value) ? { kind: 'definite', value } : fallback;

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
  const width = clampLayoutSize(
    resolveLength(widthMode, paragraphLayout.width),
    node.style?.minWidth,
    node.style?.maxWidth,
  );
  const height = clampLayoutSize(
    resolveLength(heightMode, paragraphLayout.height),
    node.style?.minHeight,
    node.style?.maxHeight,
  );

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

const measureNode = (
  node: LayoutNode,
  availableSize: LayoutAvailableSize,
): ComputedLayoutNode => computeLayoutNode(node, availableSize, 0, 0);

const translateLayoutNode = (
  layout: ComputedLayoutNode,
  deltaX: number,
  deltaY: number,
): ComputedLayoutNode =>
  layout.kind === 'text' ? { ...layout, x: layout.x + deltaX, y: layout.y + deltaY } : {
    ...layout,
    x: layout.x + deltaX,
    y: layout.y + deltaY,
    children: layout.children.map((child) => translateLayoutNode(child, deltaX, deltaY)),
  };

const withPosition = (
  layout: ComputedLayoutNode,
  x: number,
  y: number,
): ComputedLayoutNode => translateLayoutNode(layout, x - layout.x, y - layout.y);

const childMainSize = (layout: ComputedLayoutNode, axis: LayoutAxis): number =>
  axis === 'row' ? layout.width : layout.height;

const childCrossSize = (layout: ComputedLayoutNode, axis: LayoutAxis): number =>
  axis === 'row' ? layout.height : layout.width;

const clampMainSize = (
  value: number,
  style: LayoutItemStyle | undefined,
  axisKeys: AxisKeys,
): number => clampLayoutSize(value, style?.[axisKeys.mainMin], style?.[axisKeys.mainMax]);

const clampCrossSize = (
  value: number,
  style: LayoutItemStyle | undefined,
  axisKeys: AxisKeys,
): number => clampLayoutSize(value, style?.[axisKeys.crossMin], style?.[axisKeys.crossMax]);

const measureFlexBasis = (
  node: LayoutNode,
  axis: LayoutAxis,
  axisKeys: AxisKeys,
  innerCrossAvailable: number,
  availableSize: LayoutAvailableSize,
): number => {
  const style = getNodeStyle(node);
  const flexBasis = style?.flexBasis;
  if (typeof flexBasis === 'number') {
    return clampMainSize(flexBasis, style, axisKeys);
  }

  const explicitMain = style?.[axisKeys.mainSize];
  if (typeof explicitMain === 'number') {
    return clampMainSize(explicitMain, style, axisKeys);
  }

  const measurement = measureNode(node, {
    width: axis === 'row'
      ? { kind: 'max-content' }
      : toAvailableSpace(innerCrossAvailable, availableSize.width),
    height: axis === 'row'
      ? toAvailableSpace(innerCrossAvailable, availableSize.height)
      : { kind: 'max-content' },
  });
  return clampMainSize(childMainSize(measurement, axis), style, axisKeys);
};

const measureFlexChild = (
  node: LayoutNode,
  axis: LayoutAxis,
  axisKeys: AxisKeys,
  mainSize: number,
  innerCrossAvailable: number,
  availableSize: LayoutAvailableSize,
  forceStretch: boolean,
): ComputedLayoutNode => {
  const style = getNodeStyle(node);
  const explicitCross = style?.[axisKeys.crossSize];
  const crossSpace = forceStretch
    ? innerCrossAvailable
    : typeof explicitCross === 'number'
    ? explicitCross
    : innerCrossAvailable;

  const forcedNode = node.kind === 'box'
    ? {
      ...node,
      style: {
        ...node.style,
        width: axis === 'row'
          ? mainSize
          : forceStretch && Number.isFinite(innerCrossAvailable)
          ? innerCrossAvailable
          : node.style?.width,
        height: axis === 'row'
          ? forceStretch && Number.isFinite(innerCrossAvailable)
            ? innerCrossAvailable
            : node.style?.height
          : mainSize,
      },
    }
    : node;

  const measured = measureNode(forcedNode, {
    width: axis === 'row'
      ? { kind: 'definite', value: mainSize }
      : toAvailableSpace(crossSpace, availableSize.width),
    height: axis === 'row'
      ? toAvailableSpace(crossSpace, availableSize.height)
      : { kind: 'definite', value: mainSize },
  });

  const measuredMain = clampMainSize(mainSize, style, axisKeys);
  const measuredCross = clampCrossSize(
    forceStretch && Number.isFinite(innerCrossAvailable)
      ? innerCrossAvailable
      : childCrossSize(measured, axis),
    style,
    axisKeys,
  );

  if (axis === 'row') {
    return withPosition(
      layoutParagraphNodeSize(measured, measuredMain, measuredCross),
      0,
      0,
    );
  }
  return withPosition(
    layoutParagraphNodeSize(measured, measuredCross, measuredMain),
    0,
    0,
  );
};

const layoutParagraphNodeSize = (
  layout: ComputedLayoutNode,
  width: number,
  height: number,
): ComputedLayoutNode =>
  layout.kind === 'text' ? { ...layout, width, height } : { ...layout, width, height };

const justifyOffset = (
  justifyContent: LayoutJustifyContent,
  freeSpace: number,
  childCount: number,
): Readonly<{ offset: number; gapOffset: number }> => {
  if (childCount <= 0) {
    return { offset: 0, gapOffset: 0 };
  }
  switch (justifyContent) {
    case 'end':
      return { offset: freeSpace, gapOffset: 0 };
    case 'center':
      return { offset: freeSpace / 2, gapOffset: 0 };
    case 'space-between':
      return childCount > 1
        ? { offset: 0, gapOffset: freeSpace / (childCount - 1) }
        : { offset: 0, gapOffset: 0 };
    case 'space-around':
      return {
        offset: freeSpace / (childCount * 2),
        gapOffset: freeSpace / childCount,
      };
    case 'space-evenly':
      return {
        offset: freeSpace / (childCount + 1),
        gapOffset: freeSpace / (childCount + 1),
      };
    case 'start':
    default:
      return { offset: 0, gapOffset: 0 };
  }
};

const resolveAlignSelf = (
  alignSelf: LayoutAlignSelf | undefined,
  alignItems: LayoutAlignItems,
): LayoutAlignItems => alignSelf === undefined || alignSelf === 'auto' ? alignItems : alignSelf;

const crossOffsetForAlignment = (
  align: LayoutAlignItems,
  freeSpace: number,
): number => {
  switch (align) {
    case 'end':
      return freeSpace;
    case 'center':
      return freeSpace / 2;
    case 'start':
    case 'stretch':
    default:
      return 0;
  }
};

const computeFlexBoxNode = (
  node: LayoutBoxNode,
  availableSize: LayoutAvailableSize,
  x: number,
  y: number,
): ComputedLayoutBoxNode => {
  const style = node.style;
  const axis: LayoutAxis = style?.direction ?? 'column';
  const axisKeys = getAxisKeys(axis);
  const padding = normalizeLayoutInsets(style?.padding);
  const gap = style?.gap ?? 0;
  const justifyContent = style?.justifyContent ?? 'start';
  const alignItems = style?.alignItems ?? 'stretch';

  const containerMainHint = style?.[axisKeys.mainSize];
  const containerCrossHint = style?.[axisKeys.crossSize];

  const innerMainAvailable = typeof containerMainHint === 'number'
    ? Math.max(
      containerMainHint - padding[axisKeys.paddingMainStart] - padding[axisKeys.paddingMainEnd],
      0,
    )
    : definiteAvailableValue(availableSize[axisKeys.mainSize]) !== undefined
    ? Math.max(
      definiteAvailableValue(availableSize[axisKeys.mainSize])! -
        padding[axisKeys.paddingMainStart] -
        padding[axisKeys.paddingMainEnd],
      0,
    )
    : Number.POSITIVE_INFINITY;
  const innerCrossAvailable = typeof containerCrossHint === 'number'
    ? Math.max(
      containerCrossHint - padding[axisKeys.paddingCrossStart] - padding[axisKeys.paddingCrossEnd],
      0,
    )
    : definiteAvailableValue(availableSize[axisKeys.crossSize]) !== undefined
    ? Math.max(
      definiteAvailableValue(availableSize[axisKeys.crossSize])! -
        padding[axisKeys.paddingCrossStart] -
        padding[axisKeys.paddingCrossEnd],
      0,
    )
    : Number.POSITIVE_INFINITY;

  const measuredChildren: MeasuredChild[] = node.children.map((child) => {
    const childStyle = getNodeStyle(child);
    const baseMainSize = measureFlexBasis(
      child,
      axis,
      axisKeys,
      innerCrossAvailable,
      availableSize,
    );
    return {
      node: child,
      style: childStyle,
      baseMainSize,
      targetMainSize: baseMainSize,
      layout: measureNode(child, {
        width: axis === 'row'
          ? { kind: 'definite', value: baseMainSize }
          : toAvailableSpace(innerCrossAvailable, availableSize.width),
        height: axis === 'row'
          ? toAvailableSpace(innerCrossAvailable, availableSize.height)
          : { kind: 'definite', value: baseMainSize },
      }),
    };
  });

  const totalGap = Math.max(node.children.length - 1, 0) * gap;
  const baseChildrenMain = measuredChildren.reduce((sum, child) => sum + child.baseMainSize, 0);
  const baseContentMain = baseChildrenMain + totalGap;

  const definiteInnerMain = Number.isFinite(innerMainAvailable) ? innerMainAvailable : undefined;
  const targetContentMain = definiteInnerMain ?? baseContentMain;
  const freeSpace = targetContentMain - baseContentMain;

  const totalGrow = freeSpace > 0
    ? measuredChildren.reduce((sum, child) => sum + Math.max(child.style?.flexGrow ?? 0, 0), 0)
    : 0;
  const totalShrinkWeight = freeSpace < 0
    ? measuredChildren.reduce(
      (sum, child) =>
        sum +
        Math.max(child.style?.flexShrink ?? 1, 0) * child.baseMainSize,
      0,
    )
    : 0;

  const flexedChildren = measuredChildren.map((child) => {
    let targetMainSize = child.baseMainSize;
    if (freeSpace > 0 && totalGrow > 0) {
      targetMainSize += freeSpace * ((child.style?.flexGrow ?? 0) / totalGrow);
    } else if (freeSpace < 0 && totalShrinkWeight > 0) {
      const shrinkWeight = Math.max(child.style?.flexShrink ?? 1, 0) * child.baseMainSize;
      targetMainSize += freeSpace * (shrinkWeight / totalShrinkWeight);
    }
    targetMainSize = clampMainSize(targetMainSize, child.style, axisKeys);

    const align = resolveAlignSelf(child.style?.alignSelf, alignItems);
    const stretched = align === 'stretch' &&
        child.style?.[axisKeys.crossSize] !== undefined &&
        child.style?.[axisKeys.crossSize] !== 'auto'
      ? false
      : align === 'stretch' && Number.isFinite(innerCrossAvailable);

    return {
      ...child,
      targetMainSize,
      layout: measureFlexChild(
        child.node,
        axis,
        axisKeys,
        targetMainSize,
        innerCrossAvailable,
        availableSize,
        stretched,
      ),
    };
  });

  const measuredContentMain = flexedChildren.reduce(
    (sum, child) => sum + childMainSize(child.layout, axis),
    0,
  ) + totalGap;
  const contentCross = flexedChildren.reduce(
    (max, child) => Math.max(max, childCrossSize(child.layout, axis)),
    0,
  );

  const autoMain = measuredContentMain + padding[axisKeys.paddingMainStart] +
    padding[axisKeys.paddingMainEnd];
  const autoCross = contentCross + padding[axisKeys.paddingCrossStart] +
    padding[axisKeys.paddingCrossEnd];

  const containerMain = clampLayoutSize(
    resolveLength(style?.[axisKeys.mainSize], autoMain),
    style?.[axisKeys.mainMin],
    style?.[axisKeys.mainMax],
  );
  const containerCross = clampLayoutSize(
    resolveLength(style?.[axisKeys.crossSize], autoCross),
    style?.[axisKeys.crossMin],
    style?.[axisKeys.crossMax],
  );

  const innerMain = Math.max(
    containerMain - padding[axisKeys.paddingMainStart] - padding[axisKeys.paddingMainEnd],
    0,
  );
  const innerCross = Math.max(
    containerCross - padding[axisKeys.paddingCrossStart] - padding[axisKeys.paddingCrossEnd],
    0,
  );

  const remainingMainSpace = Math.max(innerMain - measuredContentMain, 0);
  const { offset: mainOffset, gapOffset } = justifyOffset(
    justifyContent,
    remainingMainSpace,
    flexedChildren.length,
  );

  let cursorMain = mainOffset;
  const children: ComputedLayoutNode[] = [];
  for (const child of flexedChildren) {
    const align = resolveAlignSelf(child.style?.alignSelf, alignItems);
    const crossSize = childCrossSize(child.layout, axis);
    const crossFreeSpace = Math.max(innerCross - crossSize, 0);
    const crossOffset = crossOffsetForAlignment(align, crossFreeSpace);
    const mainPosition = (axis === 'row' ? x : y) + padding[axisKeys.paddingMainStart] +
      cursorMain;
    const crossPosition = (axis === 'row' ? y : x) + padding[axisKeys.paddingCrossStart] +
      crossOffset;
    const positioned = axis === 'row'
      ? withPosition(child.layout, mainPosition, crossPosition)
      : withPosition(child.layout, crossPosition, mainPosition);
    children.push(positioned);
    cursorMain += childMainSize(child.layout, axis) + gap + gapOffset;
  }

  const width = axis === 'row' ? containerMain : containerCross;
  const height = axis === 'row' ? containerCross : containerMain;

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
): ComputedLayoutBoxNode => computeFlexBoxNode(node, availableSize, x, y);

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
