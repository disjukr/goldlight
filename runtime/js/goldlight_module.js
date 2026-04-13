function normalizeWindowInit(init = {}) {
  const {
    title = "untitled",
    width = 640,
    height = 480,
    initialClearColor = { r: 1, g: 1, b: 1, a: 1 },
    showPolicy = "after-initial-clear",
    workerEntrypoint = undefined,
  } = init;

  if (
    showPolicy !== "immediate" &&
    showPolicy !== "after-initial-clear" &&
    showPolicy !== "after-first-paint"
  ) {
    throw new TypeError(`unsupported window show policy: ${showPolicy}`);
  }

  return {
    title,
    width,
    height,
    initialClearColor: normalizeColor(initialClearColor),
    showPolicy,
    workerEntrypoint,
  };
}

function normalizeColor(color = {}) {
  const { r = 0, g = 0, b = 0, a = 1 } = color;
  return { r, g, b, a };
}

function cloneGradientStop(stop) {
  return {
    offset: stop.offset,
    color: cloneColor(stop.color),
  };
}

function normalizeGradientStops(stops) {
  const source = Array.isArray(stops) ? stops : [];
  if (source.length < 2 || source.length > 8) {
    throw new TypeError("gradient shader stops must contain between 2 and 8 entries");
  }
  return source.map((stop) => ({
    offset: Number(stop?.offset ?? 0),
    color: normalizeColor(stop?.color),
  }));
}

function clonePathShader(shader) {
  if (!shader) {
    return undefined;
  }

  switch (shader.kind) {
    case "linear-gradient":
      return {
        kind: "linear-gradient",
        start: [...shader.start],
        end: [...shader.end],
        stops: shader.stops.map(cloneGradientStop),
        tileMode: shader.tileMode,
      };
    case "radial-gradient":
      return {
        kind: "radial-gradient",
        center: [...shader.center],
        radius: shader.radius,
        stops: shader.stops.map(cloneGradientStop),
        tileMode: shader.tileMode,
      };
    case "two-point-conical-gradient":
      return {
        kind: "two-point-conical-gradient",
        startCenter: [...shader.startCenter],
        startRadius: shader.startRadius,
        endCenter: [...shader.endCenter],
        endRadius: shader.endRadius,
        stops: shader.stops.map(cloneGradientStop),
        tileMode: shader.tileMode,
      };
    case "sweep-gradient":
      return {
        kind: "sweep-gradient",
        center: [...shader.center],
        startAngle: shader.startAngle,
        endAngle: shader.endAngle,
        stops: shader.stops.map(cloneGradientStop),
        tileMode: shader.tileMode,
      };
    default:
      throw new TypeError(`Unsupported path shader kind: ${shader.kind}`);
  }
}

function normalizePathShader(shader) {
  if (!shader) {
    return undefined;
  }

  const tileMode = shader.tileMode ?? "clamp";
  const stops = normalizeGradientStops(shader.stops);

  switch (shader.kind) {
    case "linear-gradient":
      return {
        kind: "linear-gradient",
        start: [...shader.start],
        end: [...shader.end],
        stops,
        tileMode,
      };
    case "radial-gradient":
      return {
        kind: "radial-gradient",
        center: [...shader.center],
        radius: Number(shader.radius ?? 0),
        stops,
        tileMode,
      };
    case "two-point-conical-gradient":
      return {
        kind: "two-point-conical-gradient",
        startCenter: [...shader.startCenter],
        startRadius: Number(shader.startRadius ?? 0),
        endCenter: [...shader.endCenter],
        endRadius: Number(shader.endRadius ?? 0),
        stops,
        tileMode,
      };
    case "sweep-gradient": {
      const startAngle = Number(shader.startAngle ?? 0);
      return {
        kind: "sweep-gradient",
        center: [...shader.center],
        startAngle,
        endAngle: Number(shader.endAngle ?? (startAngle + (Math.PI * 2))),
        stops,
        tileMode,
      };
    }
    default:
      throw new TypeError(`Unsupported path shader kind: ${shader?.kind}`);
  }
}

function normalizeCameraInit(init = {}) {
  return {
    viewProjectionMatrix: init.viewProjectionMatrix
      ? [...init.viewProjectionMatrix]
      : [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
  };
}

function cloneColor(color) {
  return { ...color };
}

function cloneCamera(camera = {}) {
  return {
    viewProjectionMatrix: [...camera.viewProjectionMatrix],
  };
}

function normalizeVec3(value, fallback) {
  return value ? [...value] : [...fallback];
}

function subtractVec3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotVec3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizeVec3Length(value) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

function multiplyMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function createLookAtMatrix({ position, target, up }) {
  const eye = normalizeVec3(position, [0, 0, 1]);
  const center = normalizeVec3(target, [0, 0, 0]);
  const upVector = normalizeVec3(up, [0, 1, 0]);

  const forward = normalizeVec3Length(subtractVec3(center, eye));
  const side = normalizeVec3Length(crossVec3(forward, upVector));
  const realUp = crossVec3(side, forward);

  return [
    side[0], realUp[0], -forward[0], 0,
    side[1], realUp[1], -forward[1], 0,
    side[2], realUp[2], -forward[2], 0,
    -dotVec3(side, eye), -dotVec3(realUp, eye), dotVec3(forward, eye), 1,
  ];
}

function createOrthographicProjectionMatrix({
  left = 0,
  right,
  top = 0,
  bottom,
  near = -1000,
  far = 1000,
}) {
  if (right === undefined || bottom === undefined) {
    throw new TypeError("createOrthographicCamera3d requires right/bottom or width/height");
  }
  const width = right - left;
  const height = bottom - top;
  const depth = far - near;
  return [
    2 / width, 0, 0, 0,
    0, -2 / height, 0, 0,
    0, 0, -1 / depth, 0,
    -(right + left) / width, (bottom + top) / height, -near / depth, 1,
  ];
}

function createPerspectiveProjectionMatrix({
  width,
  height,
  fovYDegrees = 50,
  near = 0.1,
  far = 100,
}) {
  const aspect = width / height;
  const f = 1 / Math.tan((fovYDegrees * Math.PI) / 360);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far / (near - far), -1,
    0, 0, (near * far) / (near - far), 0,
  ];
}

export function createOrthographicCamera3d(init = {}) {
  const width = init.width ?? ((init.right ?? 640) - (init.left ?? 0));
  const height = init.height ?? ((init.bottom ?? 480) - (init.top ?? 0));
  const left = init.left ?? 0;
  const top = init.top ?? 0;
  const right = init.right ?? (left + width);
  const bottom = init.bottom ?? (top + height);
  const projection = createOrthographicProjectionMatrix({
    left,
    right,
    top,
    bottom,
    near: init.near ?? -1000,
    far: init.far ?? 1000,
  });
  const view = createLookAtMatrix({
    position: init.position ?? [0, 0, 1],
    target: init.target ?? [0, 0, 0],
    up: init.up ?? [0, 1, 0],
  });
  return {
    viewProjectionMatrix: multiplyMat4(projection, view),
  };
}

export function createPerspectiveCamera3d(init = {}) {
  if (init.width === undefined || init.height === undefined) {
    throw new TypeError("createPerspectiveCamera3d requires width and height");
  }
  const projection = createPerspectiveProjectionMatrix({
    width: init.width,
    height: init.height,
    fovYDegrees: init.fovYDegrees ?? 50,
    near: init.near ?? 0.1,
    far: init.far ?? 100,
  });
  const view = createLookAtMatrix({
    position: init.position ?? [0, 0, 3],
    target: init.target ?? [0, 0, 0],
    up: init.up ?? [0, 1, 0],
  });
  return {
    viewProjectionMatrix: multiplyMat4(projection, view),
  };
}

function cloneRectState(state) {
  return {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    color: cloneColor(state.color),
  };
}

function cloneTransform2d(transform) {
  return [...transform];
}

function multiplyAffineTransforms(left, right) {
  return [
    (left[0] * right[0]) + (left[2] * right[1]),
    (left[1] * right[0]) + (left[3] * right[1]),
    (left[0] * right[2]) + (left[2] * right[3]),
    (left[1] * right[2]) + (left[3] * right[3]),
    (left[0] * right[4]) + (left[2] * right[5]) + left[4],
    (left[1] * right[4]) + (left[3] * right[5]) + left[5],
  ];
}

function normalizeTransform2d(transform) {
  if (transform === undefined) {
    return [1, 0, 0, 1, 0, 0];
  }

  if (!Array.isArray(transform) || transform.length !== 6) {
    throw new TypeError("2d transform must be a 6-element affine matrix");
  }

  return transform.map((value) => Number(value));
}

function normalizeGroupInit(init = {}) {
  const transform = normalizeTransform2d(init.transform);
  return { transform };
}

function cloneGroupState(state) {
  return {
    transform: cloneTransform2d(state.transform),
  };
}

function clonePathVerb(verb) {
  switch (verb.kind) {
    case "moveTo":
    case "lineTo":
      return { kind: verb.kind, to: [...verb.to] };
    case "quadTo":
      return { kind: "quadTo", control: [...verb.control], to: [...verb.to] };
    case "conicTo":
      return { kind: "conicTo", control: [...verb.control], to: [...verb.to], weight: verb.weight };
    case "cubicTo":
      return {
        kind: "cubicTo",
        control1: [...verb.control1],
        control2: [...verb.control2],
        to: [...verb.to],
      };
    case "arcTo":
      return {
        kind: "arcTo",
        center: [...verb.center],
        radius: verb.radius,
        startAngle: verb.startAngle,
        endAngle: verb.endAngle,
        counterClockwise: verb.counterClockwise,
      };
    case "close":
      return { kind: "close" };
    default:
      throw new TypeError(`Unsupported path verb kind: ${verb.kind}`);
  }
}

function clonePathState(state) {
  return {
    x: state.x,
    y: state.y,
    verbs: state.verbs.map(clonePathVerb),
    fillRule: state.fillRule,
    style: state.style,
    color: cloneColor(state.color),
    shader: clonePathShader(state.shader),
    strokeWidth: state.strokeWidth,
    strokeJoin: state.strokeJoin,
    strokeCap: state.strokeCap,
    dashArray: [...state.dashArray],
    dashOffset: state.dashOffset,
  };
}

function cloneTriangleState(state) {
  return {
    positions: state.positions.map((position) => [...position]),
    color: cloneColor(state.color),
  };
}

function normalizeRectInit(init = {}) {
  return {
    x: init.x ?? 0,
    y: init.y ?? 0,
    width: init.width ?? 100,
    height: init.height ?? 100,
    color: init.color
      ? normalizeColor(init.color)
      : { r: 1, g: 1, b: 1, a: 1 },
  };
}

function normalizePathVerb(verb) {
  switch (verb?.kind) {
    case "moveTo":
    case "lineTo":
      return { kind: verb.kind, to: [...verb.to] };
    case "quadTo":
      return { kind: "quadTo", control: [...verb.control], to: [...verb.to] };
    case "conicTo":
      return { kind: "conicTo", control: [...verb.control], to: [...verb.to], weight: verb.weight ?? 1 };
    case "cubicTo":
      return {
        kind: "cubicTo",
        control1: [...verb.control1],
        control2: [...verb.control2],
        to: [...verb.to],
      };
    case "arcTo":
      return {
        kind: "arcTo",
        center: [...verb.center],
        radius: verb.radius ?? 0,
        startAngle: verb.startAngle ?? 0,
        endAngle: verb.endAngle ?? 0,
        counterClockwise: verb.counterClockwise ?? false,
      };
    case "close":
      return { kind: "close" };
    default:
      throw new TypeError(`Unsupported path verb kind: ${verb?.kind}`);
  }
}

function normalizePathInit(init = {}) {
  return {
    x: init.x ?? 0,
    y: init.y ?? 0,
    verbs: (init.verbs ?? []).map(normalizePathVerb),
    fillRule: init.fillRule ?? "nonzero",
    style: init.style ?? "fill",
    color: init.color
      ? normalizeColor(init.color)
      : { r: 1, g: 1, b: 1, a: 1 },
    shader: normalizePathShader(init.shader),
    strokeWidth: init.strokeWidth ?? 1,
    strokeJoin: init.strokeJoin ?? "miter",
    strokeCap: init.strokeCap ?? "butt",
    dashArray: (init.dashArray ?? []).map((value) => Number(value)),
    dashOffset: init.dashOffset ?? 0,
  };
}

const identityTextMatrix2d = [1, 0, 0, 1, 0, 0];

function normalizeGlyphMask(mask) {
  if (!mask) {
    return null;
  }
  return {
    cacheKey: String(mask.cacheKey ?? ""),
    width: Number(mask.width ?? 0),
    height: Number(mask.height ?? 0),
    stride: Number(mask.stride ?? 0),
    format: String(mask.format ?? "a8"),
    offsetX: Number(mask.offsetX ?? 0),
    offsetY: Number(mask.offsetY ?? 0),
    pixels: Array.from(mask.pixels ?? []),
  };
}

function cloneGlyphMask(mask) {
  if (!mask) {
    return null;
  }
  return {
    cacheKey: mask.cacheKey,
    width: mask.width,
    height: mask.height,
    stride: mask.stride,
    format: mask.format,
    offsetX: mask.offsetX,
    offsetY: mask.offsetY,
    pixels: Uint8Array.from(mask.pixels),
  };
}

function normalizeDirectMaskGlyph(glyph) {
  return {
    glyphId: Number(glyph?.glyphId ?? 0),
    x: Number(glyph?.x ?? 0),
    y: Number(glyph?.y ?? 0),
    mask: normalizeGlyphMask(glyph?.mask),
  };
}

function normalizeTransformedMaskGlyph(glyph) {
  return {
    glyphId: Number(glyph?.glyphId ?? 0),
    x: Number(glyph?.x ?? 0),
    y: Number(glyph?.y ?? 0),
    mask: normalizeGlyphMask(glyph?.mask),
    strikeToSourceScale: Number(glyph?.strikeToSourceScale ?? 1),
  };
}

function normalizeSdfGlyph(glyph) {
  return {
    glyphId: Number(glyph?.glyphId ?? 0),
    x: Number(glyph?.x ?? 0),
    y: Number(glyph?.y ?? 0),
    mask: normalizeGlyphMask(glyph?.mask),
    sdf: normalizeGlyphMask(glyph?.sdf),
    sdfInset: Number(glyph?.sdfInset ?? 2),
    sdfRadius: Number(glyph?.sdfRadius ?? 4),
    strikeToSourceScale: Number(glyph?.strikeToSourceScale ?? 1),
  };
}

function normalizePathTextGlyph(glyph) {
  return {
    glyphId: Number(glyph?.glyphId ?? 0),
    x: Number(glyph?.x ?? 0),
    y: Number(glyph?.y ?? 0),
    verbs: (glyph?.verbs ?? []).map(normalizePathVerb),
  };
}

function cloneDirectMaskGlyph(glyph) {
  return {
    glyphId: glyph.glyphId,
    x: glyph.x,
    y: glyph.y,
    mask: cloneGlyphMask(glyph.mask),
  };
}

function cloneTransformedMaskGlyph(glyph) {
  return {
    glyphId: glyph.glyphId,
    x: glyph.x,
    y: glyph.y,
    mask: cloneGlyphMask(glyph.mask),
    strikeToSourceScale: glyph.strikeToSourceScale,
  };
}

function cloneSdfGlyph(glyph) {
  return {
    glyphId: glyph.glyphId,
    x: glyph.x,
    y: glyph.y,
    mask: cloneGlyphMask(glyph.mask),
    sdf: cloneGlyphMask(glyph.sdf),
    sdfInset: glyph.sdfInset,
    sdfRadius: glyph.sdfRadius,
    strikeToSourceScale: glyph.strikeToSourceScale,
  };
}

function clonePathTextGlyph(glyph) {
  return {
    glyphId: glyph.glyphId,
    x: glyph.x,
    y: glyph.y,
    verbs: glyph.verbs.map(clonePathVerb),
  };
}

function normalizeCompositeTextRun(run) {
  const normalized = normalizeTextInit(run);
  if (normalized.kind === "auto") {
    throw new TypeError("composite text cannot contain auto runs");
  }
  return normalized;
}

function normalizeShapedRun(run) {
  if (!run) {
    throw new TypeError("auto text requires a shaped run");
  }
  return {
    typeface: run.typeface,
    text: String(run.text ?? ""),
    size: Number(run.size ?? 0),
    direction: run.direction ?? "ltr",
    bidiLevel: Number(run.bidiLevel ?? 0),
    scriptTag: run.scriptTag ?? "",
    language: run.language ?? "",
    glyphIDs: Uint32Array.from(run.glyphIDs ?? []),
    positions: Float32Array.from(run.positions ?? []),
    offsets: Float32Array.from(run.offsets ?? []),
    clusterIndices: Uint32Array.from(run.clusterIndices ?? []),
    advanceX: Number(run.advanceX ?? 0),
    advanceY: Number(run.advanceY ?? 0),
    utf8RangeStart: Number(run.utf8RangeStart ?? 0),
    utf8RangeEnd: Number(run.utf8RangeEnd ?? 0),
  };
}

function cloneShapedRun(run) {
  return normalizeShapedRun(run);
}

function normalizeAutoTextHost(host) {
  if (!host || typeof host.getGlyphMask !== "function" || typeof host.getGlyphPath !== "function") {
    throw new TypeError("auto text requires a valid text host");
  }
  return host;
}

function normalizeTextInit(init = {}) {
  const x = Number(init.x ?? 0);
  const y = Number(init.y ?? 0);
  const color = init.color ? normalizeColor(init.color) : { r: 1, g: 1, b: 1, a: 1 };
  const transform = normalizeTransform2d(init.transform ?? identityTextMatrix2d);
  switch (init.kind) {
    case "direct-mask":
      return {
        kind: "direct-mask",
        x,
        y,
        color,
        glyphs: (init.glyphs ?? []).map(normalizeDirectMaskGlyph),
        transform,
      };
    case "transformed-mask":
      return {
        kind: "transformed-mask",
        x,
        y,
        color,
        glyphs: (init.glyphs ?? []).map(normalizeTransformedMaskGlyph),
        transform,
      };
    case "sdf":
      return {
        kind: "sdf",
        x,
        y,
        color,
        glyphs: (init.glyphs ?? []).map(normalizeSdfGlyph),
        transform,
      };
    case "path":
      return {
        kind: "path",
        x,
        y,
        color,
        glyphs: (init.glyphs ?? []).map(normalizePathTextGlyph),
        transform,
      };
    case "composite":
      return {
        kind: "composite",
        runs: (init.runs ?? []).map(normalizeCompositeTextRun),
      };
    case "auto":
      return {
        kind: "auto",
        x,
        y,
        color,
        host: normalizeAutoTextHost(init.host),
        run: normalizeShapedRun(init.run),
        useSdfForSmallText: init.useSdfForSmallText ?? true,
      };
    default:
      throw new TypeError(`Unsupported text kind: ${init?.kind}`);
  }
}

function cloneTextState(state) {
  switch (state.kind) {
    case "direct-mask":
      return {
        kind: state.kind,
        x: state.x,
        y: state.y,
        color: cloneColor(state.color),
        glyphs: state.glyphs.map(cloneDirectMaskGlyph),
        transform: cloneTransform2d(state.transform ?? identityTextMatrix2d),
      };
    case "transformed-mask":
      return {
        kind: state.kind,
        x: state.x,
        y: state.y,
        color: cloneColor(state.color),
        glyphs: state.glyphs.map(cloneTransformedMaskGlyph),
        transform: cloneTransform2d(state.transform ?? identityTextMatrix2d),
      };
    case "sdf":
      return {
        kind: state.kind,
        x: state.x,
        y: state.y,
        color: cloneColor(state.color),
        glyphs: state.glyphs.map(cloneSdfGlyph),
        transform: cloneTransform2d(state.transform ?? identityTextMatrix2d),
      };
    case "path":
      return {
        kind: state.kind,
        x: state.x,
        y: state.y,
        color: cloneColor(state.color),
        glyphs: state.glyphs.map(clonePathTextGlyph),
        transform: cloneTransform2d(state.transform ?? identityTextMatrix2d),
      };
    case "composite":
      return {
        kind: state.kind,
        runs: state.runs.map(cloneTextState),
      };
    case "auto":
      return {
        kind: state.kind,
        x: state.x,
        y: state.y,
        color: cloneColor(state.color),
        host: state.host,
        run: cloneShapedRun(state.run),
        useSdfForSmallText: state.useSdfForSmallText,
      };
    default:
      throw new TypeError(`Unsupported text kind: ${state.kind}`);
  }
}

function createAutoTextCache() {
  return {
    host: null,
    run: null,
    x: NaN,
    y: NaN,
    translatedRun: null,
    directMaskSubRun: null,
    directMaskTransformKey: "",
    transformedMaskSubRun: null,
    transformedMaskScale: NaN,
    sdfSubRuns: new Map(),
    pathGlyphEntries: null,
  };
}

function normalizeTypefaceHandle(typeface) {
  if (typeof typeface === "bigint") {
    return typeface.toString();
  }
  if (typeof typeface === "string") {
    return typeface;
  }
  throw new TypeError("text host expects a bigint or string typeface handle");
}

function makeShapedRun(typeface, input, run) {
  if (!run) {
    return null;
  }
  return {
    typeface,
    text: input.text,
    size: Number(run.size ?? input.size),
    direction: run.direction ?? "ltr",
    bidiLevel: Number(run.bidiLevel ?? 0),
    scriptTag: run.scriptTag ?? "",
    language: run.language ?? "",
    glyphIDs: Uint32Array.from(run.glyphIds ?? []),
    positions: Float32Array.from(run.positions ?? []),
    offsets: Float32Array.from(run.offsets ?? []),
    clusterIndices: Uint32Array.from(run.clusterIndices ?? []),
    advanceX: Number(run.advanceX ?? 0),
    advanceY: Number(run.advanceY ?? 0),
    utf8RangeStart: Number(run.utf8RangeStart ?? 0),
    utf8RangeEnd: Number(run.utf8RangeEnd ?? 0),
  };
}

export function createTextHost() {
  return {
    listFamilies() {
      return Deno.core.ops.op_goldlight_text_list_families();
    },
    matchTypeface(query = {}) {
      const family = query.family;
      if (typeof family !== "string" || family.length === 0) {
        return null;
      }
      const handle = Deno.core.ops.op_goldlight_text_match_typeface(family);
      return handle ? BigInt(handle) : null;
    },
    getFontMetrics(typeface, size) {
      return Deno.core.ops.op_goldlight_text_get_font_metrics(normalizeTypefaceHandle(typeface), Number(size));
    },
    shapeText(input) {
      const normalized = {
        typeface: normalizeTypefaceHandle(input.typeface),
        text: String(input.text ?? ""),
        size: Number(input.size ?? 16),
        direction: input.direction ?? "ltr",
        language: input.language ?? undefined,
        scriptTag: input.scriptTag ?? undefined,
      };
      return makeShapedRun(input.typeface, normalized, Deno.core.ops.op_goldlight_text_shape_text(normalized));
    },
    getGlyphPath(typeface, glyphID, size) {
      return Deno.core.ops.op_goldlight_text_get_glyph_path(
        normalizeTypefaceHandle(typeface),
        Number(glyphID),
        Number(size),
      );
    },
    getGlyphMask(typeface, glyphID, size, subpixelOffset = undefined) {
      const mask = Deno.core.ops.op_goldlight_text_get_glyph_mask(
        normalizeTypefaceHandle(typeface),
        Number(glyphID),
        Number(size),
        subpixelOffset
          ? { x: Number(subpixelOffset.x ?? 0), y: Number(subpixelOffset.y ?? 0) }
          : undefined,
      );
      return cloneGlyphMask(mask);
    },
    getGlyphSdf(typeface, glyphID, size, inset = 2, radius = 4) {
      const mask = Deno.core.ops.op_goldlight_text_get_glyph_sdf(
        normalizeTypefaceHandle(typeface),
        Number(glyphID),
        Number(size),
        Number(inset),
        Number(radius),
      );
      return cloneGlyphMask(mask);
    },
    close() {},
  };
}

export function parseSvgPaths(source) {
  const normalizedSource = String(source ?? "");
  const parsed = Deno.core.ops.op_goldlight_svg_parse(normalizedSource);
  return {
    size: {
      width: Number(parsed.size?.width ?? 0),
      height: Number(parsed.size?.height ?? 0),
    },
    paths: (parsed.paths ?? []).map(clonePathState),
  };
}

export class TextShaper {
  constructor(host) {
    this._host = host;
  }

  shapeText(input) {
    return this._host.shapeText(input);
  }
}

export function buildGlyphClusters(run) {
  const clusters = [];
  const glyphCount = run.glyphIDs.length;
  if (glyphCount === 0) {
    return clusters;
  }
  if (run.direction === "ltr") {
    let glyphStart = 0;
    let clusterStart = run.clusterIndices[0];
    for (let glyphIndex = 1; glyphIndex <= glyphCount; glyphIndex += 1) {
      const nextCluster = run.clusterIndices[glyphIndex];
      if (nextCluster <= clusterStart) {
        continue;
      }
      clusters.push({
        textStart: clusterStart,
        textEnd: nextCluster,
        glyphStart,
        glyphEnd: glyphIndex,
        advanceX: run.positions[glyphIndex * 2] - run.positions[glyphStart * 2],
        advanceY: run.positions[glyphIndex * 2 + 1] - run.positions[glyphStart * 2 + 1],
      });
      glyphStart = glyphIndex;
      clusterStart = nextCluster;
    }
    return clusters;
  }
  let glyphEnd = glyphCount;
  let clusterStart = run.utf8RangeStart;
  for (let glyphStart = glyphCount - 1; glyphStart >= 0; glyphStart -= 1) {
    const nextCluster = glyphStart === 0 ? run.utf8RangeEnd : run.clusterIndices[glyphStart - 1];
    if (nextCluster <= clusterStart) {
      continue;
    }
    clusters.push({
      textStart: clusterStart,
      textEnd: nextCluster,
      glyphStart,
      glyphEnd,
      advanceX: run.positions[glyphEnd * 2] - run.positions[glyphStart * 2],
      advanceY: run.positions[glyphEnd * 2 + 1] - run.positions[glyphStart * 2 + 1],
    });
    glyphEnd = glyphStart;
    clusterStart = nextCluster;
  }
  return clusters;
}

function transformPoint2d(point, matrix) {
  return [
    (matrix[0] * point[0]) + (matrix[2] * point[1]) + matrix[4],
    (matrix[1] * point[0]) + (matrix[3] * point[1]) + matrix[5],
  ];
}

function invertAffineTransform(transform) {
  const [m00, m10, m01, m11, tx, ty] = transform;
  const determinant = (m00 * m11) - (m01 * m10);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) {
    return null;
  }
  const invDeterminant = 1 / determinant;
  const i00 = m11 * invDeterminant;
  const i10 = -m10 * invDeterminant;
  const i01 = -m01 * invDeterminant;
  const i11 = m00 * invDeterminant;
  return [
    i00,
    i10,
    i01,
    i11,
    -((i00 * tx) + (i01 * ty)),
    -((i10 * tx) + (i11 * ty)),
  ];
}

const directMaskSubpixelRound = 1 / 8;

function quantizeDirectMaskSubpixelPhase(mapped) {
  return Math.floor((((mapped + directMaskSubpixelRound) - Math.floor(mapped + directMaskSubpixelRound)) * 4) + 1e-6) & 0x3;
}

function getTransformedMaskStrikeScale(transform) {
  const scaleX = Math.hypot(transform[0], transform[1]);
  const scaleY = Math.hypot(transform[2], transform[3]);
  const maxScale = Math.max(scaleX, scaleY, 1);
  const axisAlignmentX = scaleX > 0
    ? Math.max(Math.abs(transform[0]), Math.abs(transform[1])) / scaleX
    : 1;
  const axisAlignmentY = scaleY > 0
    ? Math.max(Math.abs(transform[2]), Math.abs(transform[3])) / scaleY
    : 1;
  const axisAlignment = Math.min(axisAlignmentX, axisAlignmentY);
  if (!Number.isFinite(axisAlignment) || axisAlignment <= 0) {
    return Math.min(4, Math.ceil(maxScale));
  }
  const transformedScale = axisAlignment < 0.97
    ? Math.ceil(maxScale / axisAlignment)
    : Math.ceil(maxScale);
  return Math.min(4, Math.max(1, transformedScale));
}

export function buildDirectMaskSubRun(host, run, transform = identityTextMatrix2d) {
  const inverse = invertAffineTransform(transform);
  const glyphs = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index];
    const x = run.positions[index * 2] + run.offsets[index * 2];
    const y = run.positions[index * 2 + 1] + run.offsets[index * 2 + 1];
    const mapped = transformPoint2d([x, y], transform);
    const phaseX = quantizeDirectMaskSubpixelPhase(mapped[0]) / 4;
    const phaseY = quantizeDirectMaskSubpixelPhase(mapped[1]) / 4;
    const snappedDeviceOrigin = [
      Math.floor(mapped[0] + directMaskSubpixelRound),
      Math.floor(mapped[1] + directMaskSubpixelRound),
    ];
    const snappedLocalOrigin = inverse ? transformPoint2d(snappedDeviceOrigin, inverse) : [x, y];
    const mask = host.getGlyphMask(run.typeface, glyphID, run.size, { x: phaseX, y: phaseY });
    glyphs.push({
      glyphId: glyphID,
      x: mask ? snappedLocalOrigin[0] + mask.offsetX : snappedLocalOrigin[0],
      y: mask ? snappedLocalOrigin[1] + mask.offsetY : snappedLocalOrigin[1],
      mask,
    });
  }
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
  };
}

export function buildTransformedMaskSubRun(host, run, strikeScale) {
  const effectiveStrikeScale = Number.isFinite(strikeScale) && strikeScale > 1 ? strikeScale : 1;
  const strikeSize = run.size * effectiveStrikeScale;
  const strikeToSourceScale = run.size / strikeSize;
  const glyphs = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index];
    const x = run.positions[index * 2] + run.offsets[index * 2];
    const y = run.positions[index * 2 + 1] + run.offsets[index * 2 + 1];
    const mask = host.getGlyphMask(run.typeface, glyphID, strikeSize);
    glyphs.push({
      glyphId: glyphID,
      x: mask ? x + (mask.offsetX * strikeToSourceScale) : x,
      y: mask ? y + (mask.offsetY * strikeToSourceScale) : y,
      mask,
      strikeToSourceScale,
    });
  }
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
    strikeScale: effectiveStrikeScale,
  };
}

export function buildSdfSubRun(host, run, strikeSize = run.size) {
  const sdfInset = 2;
  const sdfRadius = 4;
  const effectiveStrikeSize = Number.isFinite(strikeSize) && strikeSize > 0
    ? strikeSize
    : run.size;
  const strikeToSourceScale = run.size / effectiveStrikeSize;
  const glyphs = [];
  let complete = true;
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index];
    const x = run.positions[index * 2] + run.offsets[index * 2];
    const y = run.positions[index * 2 + 1] + run.offsets[index * 2 + 1];
    const mask = host.getGlyphMask(run.typeface, glyphID, effectiveStrikeSize);
    const sdf = host.getGlyphSdf(run.typeface, glyphID, effectiveStrikeSize, sdfInset, sdfRadius);
    if (!sdf) {
      complete = false;
    }
    glyphs.push({
      glyphId: glyphID,
      x,
      y,
      mask,
      sdf,
      sdfInset,
      sdfRadius,
      strikeToSourceScale,
    });
  }
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
    sdfInset,
    sdfRadius,
    strikeSize: effectiveStrikeSize,
    complete,
  };
}

function buildPathGlyphEntries(host, run) {
  const glyphs = [];
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    const glyphID = run.glyphIDs[index];
    const x = run.positions[index * 2] + run.offsets[index * 2];
    const y = run.positions[index * 2 + 1] + run.offsets[index * 2 + 1];
    const verbs = host.getGlyphPath(run.typeface, glyphID, run.size);
    glyphs.push(verbs
      ? {
        glyphId: glyphID,
        x,
        y,
        verbs,
      }
      : null);
  }
  return glyphs;
}

export function buildPathSubRun(host, run) {
  const glyphs = buildPathGlyphEntries(host, run).filter((glyph) => glyph !== null);
  return {
    typeface: run.typeface,
    size: run.size,
    glyphs,
  };
}

const graphiteDirectAtlasLimit = 256;
const graphiteMinDistanceFieldFontSize = 18;
const graphiteSmallDistanceFieldFontLimit = 32;
const graphiteMediumDistanceFieldFontLimit = 72;
const graphiteLargeDistanceFieldFontLimit = 162;
const graphiteGlyphsAsPathsFontSize = 324;
const graphiteAutoTextEpsilon = 1e-4;

function translateGlyphRun(run, x, y) {
  const positions = new Float32Array(run.positions.length);
  for (let index = 0; index < run.glyphIDs.length; index += 1) {
    positions[index * 2] = run.positions[index * 2] + x;
    positions[index * 2 + 1] = run.positions[index * 2 + 1] + y;
  }
  positions[run.glyphIDs.length * 2] = run.positions[run.glyphIDs.length * 2] + x;
  positions[run.glyphIDs.length * 2 + 1] = run.positions[run.glyphIDs.length * 2 + 1] + y;
  return {
    ...run,
    positions,
  };
}

function serializeMatrix2d(matrix) {
  return matrix.map((value) => Number(value).toFixed(6)).join(",");
}

function approximateTransformedTextSize(size, transform) {
  const scaleX = Math.hypot(transform[0], transform[1]);
  const scaleY = Math.hypot(transform[2], transform[3]);
  return Number(size) * Math.max(scaleX, scaleY);
}

function canUseDirectMaskMode(transform) {
  const scaleX = Math.hypot(transform[0], transform[1]);
  const scaleY = Math.hypot(transform[2], transform[3]);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return false;
  }
  // Direct masks are only worth using when the parent transform stays in the
  // translate/uniform-scale bucket; rotated or anisotropic text should reuse
  // transformed bitmap masks instead of rebuilding direct masks per matrix.
  const axisAligned = Math.abs(transform[1]) <= graphiteAutoTextEpsilon &&
    Math.abs(transform[2]) <= graphiteAutoTextEpsilon;
  if (!axisAligned) {
    return false;
  }
  const uniformScaleTolerance = graphiteAutoTextEpsilon * Math.max(1, scaleX, scaleY);
  return Math.abs(scaleX - scaleY) <= uniformScaleTolerance;
}

function usesDistanceFieldText(approximateDeviceTextSize, useSdfForSmallText) {
  if (!Number.isFinite(approximateDeviceTextSize) || approximateDeviceTextSize <= 0) {
    return false;
  }
  const minSize = useSdfForSmallText
    ? graphiteMinDistanceFieldFontSize
    : graphiteLargeDistanceFieldFontLimit;
  return approximateDeviceTextSize >= minSize &&
    approximateDeviceTextSize <= graphiteGlyphsAsPathsFontSize;
}

function resolveGraphiteSdfSelection(run, transform, useSdfForSmallText) {
  const approximateDeviceTextSize = approximateTransformedTextSize(run.size, transform);
  if (!usesDistanceFieldText(approximateDeviceTextSize, useSdfForSmallText)) {
    return null;
  }
  if (approximateDeviceTextSize <= graphiteSmallDistanceFieldFontLimit) {
    return {
      approximateDeviceTextSize,
      strikeSize: graphiteSmallDistanceFieldFontLimit,
      strikeToSourceScale: run.size / graphiteSmallDistanceFieldFontLimit,
      matrixScaleFloor: (useSdfForSmallText
        ? graphiteMinDistanceFieldFontSize
        : graphiteLargeDistanceFieldFontLimit) / run.size,
      matrixScaleCeil: graphiteSmallDistanceFieldFontLimit / run.size,
      cacheKey: `32:${run.size}`,
    };
  }
  if (approximateDeviceTextSize <= graphiteMediumDistanceFieldFontLimit) {
    return {
      approximateDeviceTextSize,
      strikeSize: graphiteMediumDistanceFieldFontLimit,
      strikeToSourceScale: run.size / graphiteMediumDistanceFieldFontLimit,
      matrixScaleFloor: graphiteSmallDistanceFieldFontLimit / run.size,
      matrixScaleCeil: graphiteMediumDistanceFieldFontLimit / run.size,
      cacheKey: `72:${run.size}`,
    };
  }
  return {
    approximateDeviceTextSize,
    strikeSize: graphiteLargeDistanceFieldFontLimit,
    strikeToSourceScale: run.size / graphiteLargeDistanceFieldFontLimit,
    matrixScaleFloor: graphiteMediumDistanceFieldFontLimit / run.size,
    matrixScaleCeil: graphiteGlyphsAsPathsFontSize / run.size,
    cacheKey: `162:${run.size}`,
  };
}

function chooseAutoTextMode(run, transform, useSdfForSmallText) {
  const approximateDeviceTextSize = approximateTransformedTextSize(run.size, transform);
  if (!Number.isFinite(approximateDeviceTextSize) || approximateDeviceTextSize <= 0) {
    return "path";
  }
  if (usesDistanceFieldText(approximateDeviceTextSize, useSdfForSmallText)) {
    return "sdf";
  }
  if (approximateDeviceTextSize < graphiteDirectAtlasLimit) {
    return canUseDirectMaskMode(transform)
      ? "direct-mask"
      : "transformed-mask";
  }
  return "path";
}

export function inspectAutoTextSelection(
  run,
  transform = identityTextMatrix2d,
  options = {},
) {
  const normalizedRun = normalizeShapedRun(run);
  const normalizedTransform = normalizeTransform2d(transform);
  const useSdfForSmallText = options.useSdfForSmallText ?? true;
  const sdfSelection = resolveGraphiteSdfSelection(
    normalizedRun,
    normalizedTransform,
    useSdfForSmallText,
  );
  return {
    mode: chooseAutoTextMode(normalizedRun, normalizedTransform, useSdfForSmallText),
    approximateDeviceTextSize: approximateTransformedTextSize(
      normalizedRun.size,
      normalizedTransform,
    ),
    sdfStrikeSize: sdfSelection?.strikeSize ?? null,
    sdfStrikeToSourceScale: sdfSelection?.strikeToSourceScale ?? null,
  };
}

function collectGlyphIndices(run) {
  return Array.from({ length: run.glyphIDs.length }, (_unused, index) => index);
}

function partitionGlyphIndices(indices, predicate) {
  const accepted = [];
  const rejected = [];
  for (const index of indices) {
    if (predicate(index)) {
      accepted.push(index);
    } else {
      rejected.push(index);
    }
  }
  return { accepted, rejected };
}

function buildResolvedDirectMaskState(subRun, indices, color, transform) {
  return {
    kind: "direct-mask",
    x: 0,
    y: 0,
    color: cloneColor(color),
    glyphs: indices.map((index) => cloneDirectMaskGlyph(subRun.glyphs[index])),
    transform: cloneTransform2d(transform),
  };
}

function buildResolvedTransformedMaskState(subRun, indices, color, transform) {
  return {
    kind: "transformed-mask",
    x: 0,
    y: 0,
    color: cloneColor(color),
    glyphs: indices.map((index) => cloneTransformedMaskGlyph(subRun.glyphs[index])),
    transform: cloneTransform2d(transform),
  };
}

function buildResolvedSdfState(subRun, indices, color, transform) {
  return {
    kind: "sdf",
    x: 0,
    y: 0,
    color: cloneColor(color),
    glyphs: indices.map((index) => cloneSdfGlyph(subRun.glyphs[index])),
    transform: cloneTransform2d(transform),
  };
}

function buildResolvedPathState(pathGlyphEntries, indices, color, transform) {
  return {
    kind: "path",
    x: 0,
    y: 0,
    color: cloneColor(color),
    glyphs: indices
      .map((index) => pathGlyphEntries[index])
      .filter((glyph) => glyph !== null)
      .map(clonePathTextGlyph),
    transform: cloneTransform2d(transform),
  };
}

function composeResolvedTextRuns(runs, color, transform) {
  if (runs.length === 0) {
    return {
      kind: "path",
      x: 0,
      y: 0,
      color: cloneColor(color),
      glyphs: [],
      transform: cloneTransform2d(transform),
    };
  }
  if (runs.length === 1) {
    return runs[0];
  }
  return {
    kind: "composite",
    runs,
  };
}

function resolveAutoTextState(state, layoutState, groupTransform, cache) {
  const x = layoutState.x ?? state.x;
  const y = layoutState.y ?? state.y;
  if (cache.host !== state.host || cache.run !== state.run || cache.x !== x || cache.y !== y) {
    cache.host = state.host;
    cache.run = state.run;
    cache.x = x;
    cache.y = y;
    cache.translatedRun = translateGlyphRun(state.run, x, y);
    cache.directMaskSubRun = null;
    cache.directMaskTransformKey = "";
    cache.transformedMaskSubRun = null;
    cache.transformedMaskScale = NaN;
    cache.sdfSubRuns = new Map();
    cache.pathGlyphEntries = null;
  }

  const approximateDeviceTextSize = approximateTransformedTextSize(
    cache.translatedRun.size,
    groupTransform,
  );
  const preferBitmapMask = Number.isFinite(approximateDeviceTextSize) &&
    approximateDeviceTextSize > 0 &&
    approximateDeviceTextSize < graphiteDirectAtlasLimit;
  const preferDirectMask = preferBitmapMask && canUseDirectMaskMode(groupTransform);
  const resolvedRuns = [];
  let remaining = collectGlyphIndices(cache.translatedRun);

  const sdfSelection = resolveGraphiteSdfSelection(
    cache.translatedRun,
    groupTransform,
    state.useSdfForSmallText,
  );
  if (remaining.length > 0 && sdfSelection) {
    if (!cache.sdfSubRuns.has(sdfSelection.cacheKey)) {
      cache.sdfSubRuns.set(
        sdfSelection.cacheKey,
        buildSdfSubRun(state.host, cache.translatedRun, sdfSelection.strikeSize),
      );
    }
    const sdfSubRun = cache.sdfSubRuns.get(sdfSelection.cacheKey);
    const { accepted, rejected } = partitionGlyphIndices(
      remaining,
      (index) => Boolean(sdfSubRun.glyphs[index]?.sdf),
    );
    if (accepted.length > 0) {
      resolvedRuns.push(
        buildResolvedSdfState(sdfSubRun, accepted, state.color, groupTransform),
      );
    }
    remaining = rejected;
  }

  if (
    remaining.length > 0 &&
    preferDirectMask
  ) {
    const directMaskTransformKey = serializeMatrix2d(groupTransform);
    if (!cache.directMaskSubRun || cache.directMaskTransformKey !== directMaskTransformKey) {
      cache.directMaskSubRun = buildDirectMaskSubRun(
        state.host,
        cache.translatedRun,
        groupTransform,
      );
      cache.directMaskTransformKey = directMaskTransformKey;
    }
    const { accepted, rejected } = partitionGlyphIndices(
      remaining,
      (index) => Boolean(cache.directMaskSubRun.glyphs[index]?.mask),
    );
    if (accepted.length > 0) {
      resolvedRuns.push(
        buildResolvedDirectMaskState(
          cache.directMaskSubRun,
          accepted,
          state.color,
          groupTransform,
        ),
      );
    }
    remaining = rejected;
  }

  if (remaining.length > 0 && preferBitmapMask && !preferDirectMask) {
    const strikeScale = getTransformedMaskStrikeScale(groupTransform);
    if (!cache.transformedMaskSubRun || cache.transformedMaskScale !== strikeScale) {
      cache.transformedMaskSubRun = buildTransformedMaskSubRun(
        state.host,
        cache.translatedRun,
        strikeScale,
      );
      cache.transformedMaskScale = strikeScale;
    }
    const { accepted, rejected } = partitionGlyphIndices(
      remaining,
      (index) => Boolean(cache.transformedMaskSubRun.glyphs[index]?.mask),
    );
    if (accepted.length > 0) {
      resolvedRuns.push(
        buildResolvedTransformedMaskState(
          cache.transformedMaskSubRun,
          accepted,
          state.color,
          groupTransform,
        ),
      );
    }
    remaining = rejected;
  }

  if (remaining.length > 0) {
    cache.pathGlyphEntries ??= buildPathGlyphEntries(state.host, cache.translatedRun);
    const { accepted, rejected } = partitionGlyphIndices(
      remaining,
      (index) => cache.pathGlyphEntries[index] !== null,
    );
    if (accepted.length > 0) {
      resolvedRuns.push(
        buildResolvedPathState(
          cache.pathGlyphEntries,
          accepted,
          state.color,
          groupTransform,
        ),
      );
    }
    remaining = rejected;
  }

  if (
    remaining.length > 0 &&
    Number.isFinite(approximateDeviceTextSize) &&
    approximateDeviceTextSize > 0
  ) {
    const strikeScale = getTransformedMaskStrikeScale(groupTransform);
    if (!cache.transformedMaskSubRun || cache.transformedMaskScale !== strikeScale) {
      cache.transformedMaskSubRun = buildTransformedMaskSubRun(
        state.host,
        cache.translatedRun,
        strikeScale,
      );
      cache.transformedMaskScale = strikeScale;
    }
    const { accepted } = partitionGlyphIndices(
      remaining,
      (index) => Boolean(cache.transformedMaskSubRun.glyphs[index]?.mask),
    );
    if (accepted.length > 0) {
      resolvedRuns.push(
        buildResolvedTransformedMaskState(
          cache.transformedMaskSubRun,
          accepted,
          state.color,
          groupTransform,
        ),
      );
    }
  }

  return composeResolvedTextRuns(resolvedRuns, state.color, groupTransform);
}

function normalizeResolvedAutoTextState(state, groupTransform) {
  const normalized = normalizeTextInit(state);
  if (normalized.kind === "composite") {
    return normalized;
  }
  return {
    ...normalized,
    transform: cloneTransform2d(groupTransform),
  };
}

function normalizeTriangleInit(init = {}) {
  return {
    positions: init.positions
      ? init.positions.map((position) => [...position])
      : [
          [0, 100, 0],
          [100, 100, 0],
          [50, 0, 0],
        ],
    color: init.color
      ? normalizeColor(init.color)
      : { r: 1, g: 1, b: 1, a: 1 },
  };
}

function ensureFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} expects a function`);
  }
}

function cloneLayout(layout = {}) {
  return {
    ...layout,
  };
}

function computeLayout(layout = {}) {
  return {
    x: layout.x ?? 0,
    y: layout.y ?? 0,
    width: layout.width ?? 0,
    height: layout.height ?? 0,
  };
}

let nextLayoutNodeId = 1;
const dirtyLayoutScenes = new Set();

function isLayoutNode(node) {
  return (
    node instanceof LayoutGroup2d ||
    node instanceof LayoutItem2d ||
    node instanceof LayoutGroup3d ||
    node instanceof LayoutItem3d
  );
}

function ensureNode2d(node) {
  if (
    !(node instanceof Rect2d) &&
    !(node instanceof Path2d) &&
    !(node instanceof Text2d) &&
    !(node instanceof Group2d) &&
    !(node instanceof LayoutGroup2d) &&
    !(node instanceof LayoutItem2d)
  ) {
    throw new TypeError("Scene2d.add expects a Rect2d, Path2d, Text2d, Group2d, LayoutGroup2d, or LayoutItem2d");
  }
}

function ensureNode3d(node) {
  if (
    !(node instanceof Triangle3d) &&
    !(node instanceof Group3d) &&
    !(node instanceof LayoutGroup3d) &&
    !(node instanceof LayoutItem3d)
  ) {
    throw new TypeError("Scene3d.add expects a Triangle3d, Group3d, LayoutGroup3d, or LayoutItem3d");
  }
}

function ensureScene(value) {
  if (!(value instanceof Scene2d) && !(value instanceof Scene3d)) {
    throw new TypeError("setWindowScene expects a Scene2d or Scene3d");
  }
}

function isLayoutNode2d(node) {
  return node instanceof LayoutGroup2d || node instanceof LayoutItem2d;
}

function isLayoutNode3d(node) {
  return node instanceof LayoutGroup3d || node instanceof LayoutItem3d;
}

function collectLayoutRoots2d(nodes, roots = []) {
  for (const node of nodes) {
    if (isLayoutNode2d(node)) {
      roots.push(node);
      continue;
    }
    if (node instanceof Group2d) {
      collectLayoutRoots2d(node._children, roots);
    }
  }
  return roots;
}

function collectLayoutRoots3d(nodes, roots = []) {
  for (const node of nodes) {
    if (isLayoutNode3d(node)) {
      roots.push(node);
      continue;
    }
    if (node instanceof Group3d) {
      collectLayoutRoots3d(node._children, roots);
    }
  }
  return roots;
}

function buildLayoutTree(node) {
  if (node instanceof LayoutGroup2d || node instanceof LayoutGroup3d) {
    return {
      id: node._layoutNodeId,
      style: cloneLayout(node._layout),
      children: node._children.map((child) => buildLayoutTree(child)),
    };
  }
  if (node instanceof LayoutItem2d || node instanceof LayoutItem3d) {
    return {
      id: node._layoutNodeId,
      style: cloneLayout(node._layout),
      children: [],
    };
  }
  throw new TypeError("buildLayoutTree expects a layout node");
}

function computeLayouts(root) {
  const results = Deno.core.ops.op_goldlight_compute_layout(buildLayoutTree(root));
  const computedLayouts = new Map();
  for (const result of results) {
    computedLayouts.set(result.id, result);
  }
  return computedLayouts;
}

function markSceneLayoutDirty(scene) {
  if (!scene) {
    return;
  }
  scene._layoutDirty = true;
  dirtyLayoutScenes.add(scene);
  Deno.core.ops.op_goldlight_worker_request_animation_frame();
}

function markLayoutNodeDirty(node) {
  let current = node;
  while (current !== null) {
    current._layoutSubtreeDirty = true;
    current = current._layoutParent;
  }
  if (node._scene) {
    markSceneLayoutDirty(node._scene);
  }
}

function clearLayoutNodeDirty(node) {
  node._layoutSubtreeDirty = false;
  if (node instanceof LayoutGroup2d || node instanceof LayoutGroup3d) {
    for (const child of node._children) {
      clearLayoutNodeDirty(child);
    }
  }
}

function hasDirtyLayoutRoots(roots) {
  return roots.some((root) => root._layoutSubtreeDirty);
}

function flushDirtyLayouts() {
  if (dirtyLayoutScenes.size === 0) {
    return;
  }
  const scenes = Array.from(dirtyLayoutScenes);
  dirtyLayoutScenes.clear();
  for (const scene of scenes) {
    scene.flushLayout();
  }
}

globalThis.__goldlightFlushLayout = function () {
  flushDirtyLayouts();
};

function applyOffsetToNode2d(node, offsetX, offsetY) {
  if (node instanceof Rect2d) {
    const current = node.get();
    node._applyLayoutState({
      ...current,
      x: offsetX,
      y: offsetY,
    });
    return;
  }

  if (node instanceof Path2d) {
    const current = node.get();
    node._applyLayoutState({
      ...current,
      x: offsetX,
      y: offsetY,
    });
    return;
  }

  if (node instanceof Text2d) {
    const current = node.get();
    node._applyLayoutState({
      ...current,
      x: offsetX,
      y: offsetY,
    });
    return;
  }

  if (node instanceof Group2d) {
    for (const child of node._children) {
      applyOffsetToNode2d(child, offsetX, offsetY);
    }
    return;
  }

  if (node instanceof LayoutGroup2d) {
    node._applyComputedLayouts(offsetX, offsetY);
    return;
  }

  if (node instanceof LayoutItem2d && node._content !== null) {
    node._applyComputedLayouts(offsetX, offsetY);
  }
}

function applyGroupTransformToNode2d(node, transform) {
  if (node instanceof Rect2d || node instanceof Path2d || node instanceof Text2d) {
    node._applyGroupTransform(transform);
    return;
  }

  if (node instanceof Group2d) {
    const nextTransform = multiplyAffineTransforms(transform, node._state.transform);
    for (const child of node._children) {
      applyGroupTransformToNode2d(child, nextTransform);
    }
    return;
  }

  if (node instanceof LayoutGroup2d) {
    for (const child of node._children) {
      applyGroupTransformToNode2d(child, transform);
    }
    return;
  }

  if (node instanceof LayoutItem2d && node._content !== null) {
    applyGroupTransformToNode2d(node._content, transform);
  }
}

function getParentGroupTransform2d(node) {
  const transforms = [];
  let current = node._parentNode2d ?? null;
  while (current !== null) {
    if (current instanceof Group2d) {
      transforms.push(current._state.transform);
    }
    current = current._parentNode2d ?? null;
  }
  let result = [1, 0, 0, 1, 0, 0];
  for (let index = transforms.length - 1; index >= 0; index -= 1) {
    result = multiplyAffineTransforms(result, transforms[index]);
  }
  return result;
}

function applyOffsetToNode3d(node, offsetX, offsetY) {
  if (node instanceof Triangle3d) {
    node._applyLayoutOffset(offsetX, offsetY);
    return;
  }

  if (node instanceof Group3d) {
    for (const child of node._children) {
      applyOffsetToNode3d(child, offsetX, offsetY);
    }
    return;
  }

  if (node instanceof LayoutGroup3d) {
    node._applyComputedLayouts(offsetX, offsetY);
    return;
  }

  if (node instanceof LayoutItem3d && node._content !== null) {
    node._applyComputedLayouts(offsetX, offsetY);
  }
}

function attachNodeToScene2d(scene, node) {
  node._scene = scene;

  if (node instanceof Rect2d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Path2d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Text2d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Group2d || node instanceof LayoutGroup2d) {
    node._sceneId = scene.id;
    for (const child of node._children) {
      attachNodeToScene2d(scene, child);
    }
    return;
  }

  if (node instanceof LayoutItem2d) {
    node._sceneId = scene.id;
    if (node._content !== null) {
      attachNodeToScene2d(scene, node._content);
      node._applyComputedLayouts(0, 0);
    }
    return;
  }
}

function attachNodeToScene3d(scene, node) {
  node._scene = scene;

  if (node instanceof Triangle3d) {
    node._attachToScene(scene.id);
    return;
  }

  if (node instanceof Group3d || node instanceof LayoutGroup3d) {
    node._sceneId = scene.id;
    for (const child of node._children) {
      attachNodeToScene3d(scene, child);
    }
    return;
  }

  if (node instanceof LayoutItem3d) {
    node._sceneId = scene.id;
    if (node._content !== null) {
      attachNodeToScene3d(scene, node._content);
      node._applyComputedLayouts(0, 0);
    }
  }
}

export function createWindow(init = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowInit(init));
}

export function setWindowScene(scene) {
  ensureScene(scene);
  markSceneLayoutDirty(scene);
  if (scene instanceof Scene2d) {
    Deno.core.ops.op_goldlight_present_scene_2d(scene.id);
    return scene;
  }
  Deno.core.ops.op_goldlight_present_scene_3d(scene.id);
  return scene;
}

export class Scene2d {
  constructor(init = {}) {
    this._state = {
      clearColor: normalizeColor(init.clearColor),
    };
    this._children = [];
    const handle = Deno.core.ops.op_goldlight_create_scene_2d({
      clearColor: this._state.clearColor,
    });
    this.id = handle.id;
    this._layoutDirty = false;
  }

  set(patch = {}) {
    if (patch.clearColor !== undefined) {
      this._state.clearColor = normalizeColor(patch.clearColor);
    }
    Deno.core.ops.op_goldlight_scene_2d_set_clear_color(this.id, {
      color: this._state.clearColor,
    });
    return this;
  }

  get() {
    return {
      clearColor: cloneColor(this._state.clearColor),
    };
  }

  add(node) {
    ensureNode2d(node);
    if (isLayoutNode(node)) {
      node._layoutParent = null;
    }
    node._parentNode2d = null;
    this._children.push(node);
    attachNodeToScene2d(this, node);
    applyGroupTransformToNode2d(node, [1, 0, 0, 1, 0, 0]);
    markSceneLayoutDirty(this);
    return node;
  }

  _flushLayoutRoot(root) {
    if (!root._layoutSubtreeDirty) {
      return;
    }
    const computedLayouts = computeLayouts(root);
    root._setComputedLayouts(computedLayouts);
    root._applyComputedLayouts(0, 0);
    clearLayoutNodeDirty(root);
  }

  flushLayout() {
    if (!this._layoutDirty) {
      return this;
    }
    const roots = collectLayoutRoots2d(this._children);
    for (const root of roots) {
      this._flushLayoutRoot(root);
    }
    this._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._layoutDirty) {
      dirtyLayoutScenes.add(this);
    }
    return this;
  }
}

export class Group2d {
  constructor(init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._parentNode2d = null;
    this._state = normalizeGroupInit(init);
  }

  set(patch = {}) {
    if (Object.prototype.hasOwnProperty.call(patch, "transform")) {
      this._state = normalizeGroupInit({
        ...this._state,
        transform: patch.transform,
      });
      applyGroupTransformToNode2d(this, getParentGroupTransform2d(this));
    }
    return this;
  }

  get() {
    return cloneGroupState(this._state);
  }

  add(child) {
    ensureNode2d(child);
    if (isLayoutNode(child)) {
      child._layoutParent = null;
    }
    child._parentNode2d = this;
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene2d(this._scene, child);
      applyGroupTransformToNode2d(child, getParentGroupTransform2d(child));
      markSceneLayoutDirty(this._scene);
    }
    return child;
  }
}

export class LayoutGroup2d {
  constructor(init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = cloneLayout(init);
    this._computedLayout = computeLayout(this._layout);
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
    this._parentNode2d = null;
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  add(child) {
    if (!(child instanceof LayoutItem2d) && !(child instanceof LayoutGroup2d)) {
      throw new TypeError("LayoutGroup2d.add expects a LayoutItem2d or LayoutGroup2d");
    }
    child._layoutParent = this;
    child._parentNode2d = this;
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene2d(this._scene, child);
    }
    markLayoutNodeDirty(this);
    return child;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
    for (const child of this._children) {
      child._setComputedLayouts(computedLayouts);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    const baseX = offsetX + this._computedLayout.x;
    const baseY = offsetY + this._computedLayout.y;
    for (const child of this._children) {
      child._applyComputedLayouts(baseX, baseY);
    }
  }

  flushLayout() {
    if (!this._scene) {
      return this;
    }
    let root = this;
    while (root._layoutParent !== null) {
      root = root._layoutParent;
    }
    this._scene._flushLayoutRoot(root);
    const roots = collectLayoutRoots2d(this._scene._children);
    this._scene._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._scene._layoutDirty) {
      dirtyLayoutScenes.add(this._scene);
    }
    return this;
  }
}

export class LayoutItem2d {
  constructor() {
    this._sceneId = null;
    this._scene = null;
    this._content = null;
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = {};
    this._computedLayout = computeLayout();
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
    this._parentNode2d = null;
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  setContent(content) {
    ensureNode2d(content);
    this._content = content;
    content._parentNode2d = this;
    if (this._scene) {
      attachNodeToScene2d(this._scene, content);
    }
    markLayoutNodeDirty(this);
    return this;
  }

  getContent() {
    return this._content;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    if (this._content === null) {
      return;
    }
    const x = offsetX + this._computedLayout.x;
    const y = offsetY + this._computedLayout.y;
    const groupTransform = getParentGroupTransform2d(this._content);
    if (this._content instanceof Rect2d) {
      const current = this._content.get();
      this._content._applyLayoutState({
        x,
        y,
        width: this._computedLayout.width || current.width,
        height: this._computedLayout.height || current.height,
      });
      this._content._applyGroupTransform(groupTransform);
      return;
    }
    if (this._content instanceof Path2d) {
      this._content._applyLayoutState({ x, y });
      this._content._applyGroupTransform(groupTransform);
      return;
    }
    if (this._content instanceof Text2d) {
      this._content._applyLayoutState({ x, y });
      this._content._applyGroupTransform(groupTransform);
      return;
    }
    applyOffsetToNode2d(this._content, x, y);
    applyGroupTransformToNode2d(this._content, groupTransform);
  }
}

export class Rect2d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._parentNode2d = null;
    this._state = normalizeRectInit(init);
    this._layoutState = null;
    this._groupTransform = [1, 0, 0, 1, 0, 0];
    this._resolvedState = cloneRectState(this._state);
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_2d_create_rect(sceneId, this._resolvedState);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  _syncResolvedState() {
    const layoutState = this._layoutState ?? {};
    this._resolvedState = {
      x: layoutState.x ?? this._state.x,
      y: layoutState.y ?? this._state.y,
      width: layoutState.width ?? this._state.width,
      height: layoutState.height ?? this._state.height,
      color: normalizeColor(this._state.color),
      transform: cloneTransform2d(this._groupTransform),
    };
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_rect_2d_update(this.id, this._resolvedState);
    }
  }

  set(patch = {}) {
    if (patch.x !== undefined) this._state.x = patch.x;
    if (patch.y !== undefined) this._state.y = patch.y;
    if (patch.width !== undefined) this._state.width = patch.width;
    if (patch.height !== undefined) this._state.height = patch.height;
    if (patch.color !== undefined) this._state.color = normalizeColor(patch.color);

    this._syncResolvedState();
    return this;
  }

  _applyLayoutState(state) {
    this._layoutState = {
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
    };
    this._syncResolvedState();
  }

  _applyGroupTransform(transform) {
    this._groupTransform = cloneTransform2d(transform);
    this._syncResolvedState();
  }

  get() {
    return cloneRectState(this._state);
  }
}

export class Path2d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._parentNode2d = null;
    this._state = normalizePathInit(init);
    this._layoutState = null;
    this._groupTransform = [1, 0, 0, 1, 0, 0];
    this._resolvedState = clonePathState(this._state);
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_2d_create_path(sceneId, this._resolvedState);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  _syncResolvedState() {
    const layoutState = this._layoutState ?? {};
    this._resolvedState = {
      ...clonePathState(this._state),
      x: layoutState.x ?? this._state.x,
      y: layoutState.y ?? this._state.y,
      transform: cloneTransform2d(this._groupTransform),
    };
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_path_2d_update(this.id, this._resolvedState);
    }
  }

  set(patch = {}) {
    if (patch.x !== undefined) this._state.x = patch.x;
    if (patch.y !== undefined) this._state.y = patch.y;
    if (patch.verbs !== undefined) this._state.verbs = patch.verbs.map(normalizePathVerb);
    if (patch.fillRule !== undefined) this._state.fillRule = patch.fillRule;
    if (patch.style !== undefined) this._state.style = patch.style;
    if (patch.color !== undefined) this._state.color = normalizeColor(patch.color);
    if (Object.prototype.hasOwnProperty.call(patch, "shader")) {
      this._state.shader = normalizePathShader(patch.shader);
    }
    if (patch.strokeWidth !== undefined) this._state.strokeWidth = patch.strokeWidth;
    if (patch.strokeJoin !== undefined) this._state.strokeJoin = patch.strokeJoin;
    if (patch.strokeCap !== undefined) this._state.strokeCap = patch.strokeCap;
    if (patch.dashArray !== undefined) this._state.dashArray = patch.dashArray.map((value) => Number(value));
    if (patch.dashOffset !== undefined) this._state.dashOffset = patch.dashOffset;

    this._syncResolvedState();
    return this;
  }

  _applyLayoutState(state) {
    this._layoutState = {
      x: state.x,
      y: state.y,
    };
    this._syncResolvedState();
  }

  _applyGroupTransform(transform) {
    this._groupTransform = cloneTransform2d(transform);
    this._syncResolvedState();
  }

  get() {
    return clonePathState(this._state);
  }
}

export class Text2d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._parentNode2d = null;
    this._state = normalizeTextInit(init);
    this._layoutState = null;
    this._groupTransform = [1, 0, 0, 1, 0, 0];
    this._autoCache = createAutoTextCache();
    this._resolvedState = cloneTextState(this._state);
    this._syncResolvedState();
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_2d_create_text(sceneId, this._resolvedState);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  _syncResolvedState() {
    const layoutState = this._layoutState ?? {};
    if (this._state.kind === "auto") {
      const resolved = resolveAutoTextState(
        this._state,
        layoutState,
        this._groupTransform,
        this._autoCache,
      );
      this._resolvedState = normalizeResolvedAutoTextState(
        resolved,
        this._groupTransform,
      );
    } else {
      this._resolvedState = {
        ...normalizeTextInit({
          ...this._state,
          x: layoutState.x ?? this._state.x,
          y: layoutState.y ?? this._state.y,
        }),
        transform: cloneTransform2d(this._groupTransform),
      };
    }
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_text_2d_update(this.id, this._resolvedState);
    }
  }

  set(patch = {}) {
    const nextKind = patch.kind ?? this._state.kind;
    this._state = normalizeTextInit({
      ...this._state,
      ...patch,
      glyphs: Object.prototype.hasOwnProperty.call(patch, "glyphs") ? patch.glyphs : this._state.glyphs,
    });
    if (nextKind !== "auto") {
      this._autoCache = createAutoTextCache();
    }
    this._syncResolvedState();
    return this;
  }

  _applyLayoutState(state) {
    this._layoutState = {
      x: state.x,
      y: state.y,
    };
    this._syncResolvedState();
  }

  _applyGroupTransform(transform) {
    this._groupTransform = cloneTransform2d(transform);
    this._syncResolvedState();
  }

  get() {
    return cloneTextState(this._state);
  }
}

export class Scene3d {
  constructor(init = {}) {
    this._state = {
      clearColor: normalizeColor(init.clearColor),
      camera: normalizeCameraInit(init.camera),
    };
    this._children = [];
    const handle = Deno.core.ops.op_goldlight_create_scene_3d({
      clearColor: this._state.clearColor,
      camera: this._state.camera,
    });
    this.id = handle.id;
    this._layoutDirty = false;
  }

  set(patch = {}) {
    if (patch.clearColor !== undefined) {
      this._state.clearColor = normalizeColor(patch.clearColor);
      Deno.core.ops.op_goldlight_scene_3d_set_clear_color(this.id, {
        color: this._state.clearColor,
      });
    }
    if (patch.camera !== undefined) {
      this._state.camera = normalizeCameraInit(patch.camera);
      Deno.core.ops.op_goldlight_scene_3d_set_camera(this.id, this._state.camera);
    }
    return this;
  }

  get() {
    return {
      clearColor: cloneColor(this._state.clearColor),
      camera: cloneCamera(this._state.camera),
    };
  }

  add(node) {
    ensureNode3d(node);
    if (isLayoutNode(node)) {
      node._layoutParent = null;
    }
    this._children.push(node);
    attachNodeToScene3d(this, node);
    markSceneLayoutDirty(this);
    return node;
  }

  _flushLayoutRoot(root) {
    if (!root._layoutSubtreeDirty) {
      return;
    }
    const computedLayouts = computeLayouts(root);
    root._setComputedLayouts(computedLayouts);
    root._applyComputedLayouts(0, 0);
    clearLayoutNodeDirty(root);
  }

  flushLayout() {
    if (!this._layoutDirty) {
      return this;
    }
    const roots = collectLayoutRoots3d(this._children);
    for (const root of roots) {
      this._flushLayoutRoot(root);
    }
    this._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._layoutDirty) {
      dirtyLayoutScenes.add(this);
    }
    return this;
  }
}

export class Triangle3d {
  constructor(init = {}) {
    this.id = null;
    this._sceneId = null;
    this._scene = null;
    this._state = normalizeTriangleInit(init);
    this._baseLayoutState = cloneTriangleState(this._state);
  }

  _attachToScene(sceneId) {
    if (this.id !== null) {
      return;
    }
    const handle = Deno.core.ops.op_goldlight_scene_3d_create_triangle(sceneId, this._state);
    this.id = handle.id;
    this._sceneId = sceneId;
  }

  set(patch = {}) {
    if (patch.positions !== undefined) {
      this._state.positions = patch.positions.map((position) => [...position]);
      this._baseLayoutState.positions = patch.positions.map((position) => [...position]);
    }
    if (patch.color !== undefined) {
      this._state.color = normalizeColor(patch.color);
      this._baseLayoutState.color = normalizeColor(patch.color);
    }

    if (this.id !== null) {
      Deno.core.ops.op_goldlight_triangle_3d_update(this.id, this._state);
    }
    return this;
  }

  get() {
    return cloneTriangleState(this._state);
  }

  _applyLayoutOffset(offsetX, offsetY) {
    const positions = this._baseLayoutState.positions;
    const bounds = positions.reduce((acc, [x, y]) => ({
      minX: Math.min(acc.minX, x),
      maxX: Math.max(acc.maxX, x),
      minY: Math.min(acc.minY, y),
      maxY: Math.max(acc.maxY, y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const translated = positions.map(([x, y, z]) => [
      x - bounds.minX + offsetX,
      y - bounds.minY + offsetY,
      z,
    ]);
    this._state.positions = translated;
    if (this.id !== null) {
      Deno.core.ops.op_goldlight_triangle_3d_update(this.id, {
        positions: translated,
        color: this._state.color,
      });
    }
  }
}

export class Group3d {
  constructor(_init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  add(child) {
    ensureNode3d(child);
    if (isLayoutNode(child)) {
      child._layoutParent = null;
    }
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene3d(this._scene, child);
      markSceneLayoutDirty(this._scene);
    }
    return child;
  }
}

export class LayoutGroup3d {
  constructor(init = {}) {
    this._children = [];
    this._sceneId = null;
    this._scene = null;
    this._state = {};
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = cloneLayout(init);
    this._computedLayout = computeLayout(this._layout);
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  set(_patch = {}) {
    return this;
  }

  get() {
    return {};
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  add(child) {
    if (!(child instanceof LayoutItem3d) && !(child instanceof LayoutGroup3d)) {
      throw new TypeError("LayoutGroup3d.add expects a LayoutItem3d or LayoutGroup3d");
    }
    child._layoutParent = this;
    this._children.push(child);
    if (this._scene) {
      attachNodeToScene3d(this._scene, child);
    }
    markLayoutNodeDirty(this);
    return child;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
    for (const child of this._children) {
      child._setComputedLayouts(computedLayouts);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    const baseX = offsetX + this._computedLayout.x;
    const baseY = offsetY + this._computedLayout.y;
    for (const child of this._children) {
      child._applyComputedLayouts(baseX, baseY);
    }
  }

  flushLayout() {
    if (!this._scene) {
      return this;
    }
    let root = this;
    while (root._layoutParent !== null) {
      root = root._layoutParent;
    }
    this._scene._flushLayoutRoot(root);
    const roots = collectLayoutRoots3d(this._scene._children);
    this._scene._layoutDirty = hasDirtyLayoutRoots(roots);
    if (this._scene._layoutDirty) {
      dirtyLayoutScenes.add(this._scene);
    }
    return this;
  }
}

export class LayoutItem3d {
  constructor() {
    this._sceneId = null;
    this._scene = null;
    this._content = null;
    this._layoutNodeId = nextLayoutNodeId++;
    this._layout = {};
    this._computedLayout = computeLayout();
    this._layoutParent = null;
    this._layoutSubtreeDirty = true;
  }

  setLayout(layout = {}) {
    this._layout = { ...this._layout, ...cloneLayout(layout) };
    this._computedLayout = computeLayout(this._layout);
    markLayoutNodeDirty(this);
    return this;
  }

  getLayout() {
    return cloneLayout(this._layout);
  }

  getComputedLayout() {
    return { ...this._computedLayout };
  }

  setContent(content) {
    ensureNode3d(content);
    this._content = content;
    if (this._scene) {
      attachNodeToScene3d(this._scene, content);
    }
    markLayoutNodeDirty(this);
    return this;
  }

  getContent() {
    return this._content;
  }

  _setComputedLayouts(computedLayouts) {
    if (computedLayouts.has(this._layoutNodeId)) {
      this._computedLayout = computedLayouts.get(this._layoutNodeId);
    }
  }

  _applyComputedLayouts(offsetX, offsetY) {
    if (this._content === null) {
      return;
    }
    const x = offsetX + this._computedLayout.x;
    const y = offsetY + this._computedLayout.y;
    applyOffsetToNode3d(this._content, x, y);
  }
}

const windowEventListeners = new Map();
let animationFrameCallbacks = [];
let nextAnimationFrameHandle = 1;

export function requestAnimationFrame(callback) {
  ensureFunction(callback, "requestAnimationFrame");
  const handle = nextAnimationFrameHandle++;
  animationFrameCallbacks.push({ handle, callback });
  Deno.core.ops.op_goldlight_worker_request_animation_frame();
  return handle;
}

export function cancelAnimationFrame(handle) {
  animationFrameCallbacks = animationFrameCallbacks.filter((entry) => entry.handle !== handle);
}

export function addWindowEventListener(type, listener) {
  ensureFunction(listener, "addWindowEventListener");
  const listeners = windowEventListeners.get(type) ?? [];
  listeners.push(listener);
  windowEventListeners.set(type, listeners);
}

function dispatchWindowEvent(event) {
  if (event.type === "animationFrame") {
    const callbacks = animationFrameCallbacks;
    animationFrameCallbacks = [];
    for (const { callback } of callbacks) {
      callback(event.timestampMs);
    }
  }

  const listeners = windowEventListeners.get(event.type) ?? [];
  for (const listener of listeners) {
    listener(event);
  }
}

globalThis.__goldlightFlushLayout = function () {
  flushDirtyLayouts();
};

globalThis.__goldlightPump = function () {
  const events = Deno.core.ops.op_goldlight_worker_drain_events();
  for (const event of events) {
    dispatchWindowEvent(event);
  }
};
