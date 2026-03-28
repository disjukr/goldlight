import type { ParagraphPrepareOptions, ParagraphTextStyle, PreparedParagraph } from './types.ts';

export type LayoutAxis = 'row' | 'column';
export type LayoutLength = number | 'auto';

export type LayoutInsets = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export type LayoutInsetsInput =
  | number
  | Readonly<Partial<LayoutInsets>>
  | undefined;

export type LayoutBoxStyle = Readonly<{
  width?: LayoutLength;
  height?: LayoutLength;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  padding?: LayoutInsetsInput;
  gap?: number;
  direction?: LayoutAxis;
  backgroundColor?: readonly [number, number, number, number];
  borderColor?: readonly [number, number, number, number];
  borderWidth?: number;
  cornerRadius?: number;
}>;

export type LayoutTextNode = Readonly<{
  kind: 'text';
  prepared: PreparedParagraph;
  style?: Readonly<{
    width?: LayoutLength;
    height?: LayoutLength;
  }>;
}>;

export type LayoutBoxNode = Readonly<{
  kind: 'box';
  style?: LayoutBoxStyle;
  children: readonly LayoutNode[];
}>;

export type LayoutNode = LayoutTextNode | LayoutBoxNode;

export type ComputedLayoutTextNode = Readonly<{
  kind: 'text';
  x: number;
  y: number;
  width: number;
  height: number;
  node: LayoutTextNode;
  children: readonly [];
}>;

export type ComputedLayoutBoxNode = Readonly<{
  kind: 'box';
  x: number;
  y: number;
  width: number;
  height: number;
  node: LayoutBoxNode;
  children: readonly ComputedLayoutNode[];
}>;

export type ComputedLayoutNode =
  | ComputedLayoutTextNode
  | ComputedLayoutBoxNode;

export const normalizeLayoutInsets = (
  input: LayoutInsetsInput,
): LayoutInsets => {
  if (typeof input === 'number') {
    return { top: input, right: input, bottom: input, left: input };
  }
  return {
    top: input?.top ?? 0,
    right: input?.right ?? 0,
    bottom: input?.bottom ?? 0,
    left: input?.left ?? 0,
  };
};

export const clampLayoutSize = (
  value: number,
  minValue?: number,
  maxValue?: number,
): number => {
  let clamped = value;
  if (minValue !== undefined) {
    clamped = Math.max(clamped, minValue);
  }
  if (maxValue !== undefined) {
    clamped = Math.min(clamped, maxValue);
  }
  return clamped;
};

export const createTextLayoutNode = (
  prepared: PreparedParagraph,
  style?: LayoutTextNode['style'],
): LayoutTextNode => ({
  kind: 'text',
  prepared,
  style,
});

export const createBoxLayoutNode = (
  children: readonly LayoutNode[],
  style?: LayoutBoxStyle,
): LayoutBoxNode => ({
  kind: 'box',
  style,
  children,
});

export type LayoutTextPrepareInput = Readonly<{
  text: string;
  style: ParagraphTextStyle;
  options?: ParagraphPrepareOptions;
}>;
