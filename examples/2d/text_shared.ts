import { Group2d, Path2d, type PathVerb2d, type ShapedRun, type TextHost } from "goldlight";

type Point2d = [number, number];

export function matchCandidateTypeface(
  host: TextHost,
  candidates: readonly string[],
) {
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
}

export function translatePathVerbs(verbs: PathVerb2d[], dx: number, dy: number): PathVerb2d[] {
  return verbs.map((verb) => {
    switch (verb.kind) {
      case "moveTo":
      case "lineTo":
        return { kind: verb.kind, to: [verb.to[0] + dx, verb.to[1] + dy] };
      case "quadTo":
        return {
          kind: "quadTo",
          control: [verb.control[0] + dx, verb.control[1] + dy],
          to: [verb.to[0] + dx, verb.to[1] + dy],
        };
      case "conicTo":
        return {
          kind: "conicTo",
          control: [verb.control[0] + dx, verb.control[1] + dy],
          to: [verb.to[0] + dx, verb.to[1] + dy],
          weight: verb.weight,
        };
      case "cubicTo":
        return {
          kind: "cubicTo",
          control1: [verb.control1[0] + dx, verb.control1[1] + dy],
          control2: [verb.control2[0] + dx, verb.control2[1] + dy],
          to: [verb.to[0] + dx, verb.to[1] + dy],
        };
      case "arcTo":
        return {
          kind: "arcTo",
          center: [verb.center[0] + dx, verb.center[1] + dy],
          radius: verb.radius,
          startAngle: verb.startAngle,
          endAngle: verb.endAngle,
          counterClockwise: verb.counterClockwise,
        };
      case "close":
        return { kind: "close" };
    }
  });
}

export function transformPathVerbs(
  verbs: PathVerb2d[],
  matrix: [number, number, number, number, number, number],
): PathVerb2d[] {
  const transformPoint = ([x, y]: Point2d): Point2d => [
    (matrix[0] * x) + (matrix[2] * y) + matrix[4],
    (matrix[1] * x) + (matrix[3] * y) + matrix[5],
  ];
  return verbs.map((verb) => {
    switch (verb.kind) {
      case "moveTo":
      case "lineTo":
        return { kind: verb.kind, to: transformPoint(verb.to) };
      case "quadTo":
        return {
          kind: "quadTo",
          control: transformPoint(verb.control),
          to: transformPoint(verb.to),
        };
      case "conicTo":
        return {
          kind: "conicTo",
          control: transformPoint(verb.control),
          to: transformPoint(verb.to),
          weight: verb.weight,
        };
      case "cubicTo":
        return {
          kind: "cubicTo",
          control1: transformPoint(verb.control1),
          control2: transformPoint(verb.control2),
          to: transformPoint(verb.to),
        };
      case "arcTo":
        return {
          kind: "arcTo",
          center: transformPoint(verb.center),
          radius: verb.radius,
          startAngle: verb.startAngle,
          endAngle: verb.endAngle,
          counterClockwise: verb.counterClockwise,
        };
      case "close":
        return { kind: "close" };
    }
  });
}

export function createPathTextGroup2d(
  host: TextHost,
  run: ShapedRun,
  init: NonNullable<ConstructorParameters<typeof Path2d>[0]>,
  offsetX = 0,
  offsetY = 0,
) {
  const group = new Group2d();
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const verbs = host.getGlyphPath(run.typeface, glyphID, run.size);
    if (!verbs || verbs.length === 0) {
      continue;
    }
    const x = run.positions[index * 2]! + run.offsets[index * 2]!;
    const y = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    group.add(new Path2d({
      ...init,
      verbs: translatePathVerbs(verbs, x + offsetX, y + offsetY),
    }));
  }
  return group;
}

function distanceBetween(left: Point2d, right: Point2d) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function samplePolylinePoint(points: Point2d[], distance: number) {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segmentLength = distanceBetween(from, to);
    if (segmentLength <= 1e-6) {
      continue;
    }
    if (remaining <= segmentLength) {
      const t = remaining / segmentLength;
      const point: Point2d = [
        from[0] + ((to[0] - from[0]) * t),
        from[1] + ((to[1] - from[1]) * t),
      ];
      const tangent: Point2d = [
        (to[0] - from[0]) / segmentLength,
        (to[1] - from[1]) / segmentLength,
      ];
      return { point, tangent };
    }
    remaining -= segmentLength;
  }
  const last = points[points.length - 1]!;
  const prev = points[Math.max(0, points.length - 2)] ?? last;
  const segmentLength = Math.max(distanceBetween(prev, last), 1);
  return {
    point: last,
    tangent: [(last[0] - prev[0]) / segmentLength, (last[1] - prev[1]) / segmentLength],
  };
}

function polylineLength(points: Point2d[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distanceBetween(points[index - 1]!, points[index]!);
  }
  return length;
}

export function createTextOnPolylineGroup2d(
  host: TextHost,
  run: ShapedRun,
  points: Point2d[],
  init: NonNullable<ConstructorParameters<typeof Path2d>[0]>,
  options: {
    align?: "start" | "center" | "end";
    normalOffset?: number;
  } = {},
) {
  const totalLength = polylineLength(points);
  const align = options.align ?? "start";
  const normalOffset = options.normalOffset ?? 0;
  let distance = 0;
  if (align === "center") {
    distance = Math.max(0, (totalLength - run.advanceX) / 2);
  } else if (align === "end") {
    distance = Math.max(0, totalLength - run.advanceX);
  }

  const group = new Group2d();
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index]!;
    const verbs = host.getGlyphPath(run.typeface, glyphID, run.size);
    if (!verbs || verbs.length === 0) {
      continue;
    }
    const glyphX = run.positions[index * 2]! + run.offsets[index * 2]!;
    const glyphY = run.positions[index * 2 + 1]! + run.offsets[index * 2 + 1]!;
    const placement = samplePolylinePoint(points, distance + glyphX);
    const angle = Math.atan2(placement.tangent[1], placement.tangent[0]);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const normal: Point2d = [-placement.tangent[1], placement.tangent[0]];
    const matrix: [number, number, number, number, number, number] = [
      cosine,
      sine,
      -sine,
      cosine,
      placement.point[0] + (normal[0] * normalOffset) - (glyphY * sine),
      placement.point[1] + (normal[1] * normalOffset) + (glyphY * cosine),
    ];
    group.add(new Path2d({
      ...init,
      verbs: transformPathVerbs(verbs, matrix),
    }));
  }
  return group;
}

export function sampleCubicBezier(
  start: Point2d,
  control1: Point2d,
  control2: Point2d,
  end: Point2d,
  segments: number,
): Point2d[] {
  const points: Point2d[] = [start];
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const mt = 1 - t;
    points.push([
      (mt ** 3 * start[0]) + (3 * mt * mt * t * control1[0]) + (3 * mt * t * t * control2[0]) + (t ** 3 * end[0]),
      (mt ** 3 * start[1]) + (3 * mt * mt * t * control1[1]) + (3 * mt * t * t * control2[1]) + (t ** 3 * end[1]),
    ]);
  }
  return points;
}
