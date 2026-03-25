import type { DawnBackendContext } from './dawn_backend_context.ts';
import type { DawnCaps } from './caps.ts';
import type { DrawingGraphicsPipelineDesc } from './draw_pass.ts';

export type DrawingBufferDescriptor = Readonly<{
  label?: string;
  size: number;
  usage: GPUBufferUsageFlags;
  mappedAtCreation?: boolean;
}>;

export type DrawingTextureDescriptor = Readonly<{
  label?: string;
  size: GPUExtent3D;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
  sampleCount?: number;
  mipLevelCount?: number;
  dimension?: GPUTextureDimension;
}>;

export type DrawingSamplerDescriptor = Readonly<{
  label?: string;
  magFilter?: GPUFilterMode;
  minFilter?: GPUFilterMode;
  mipmapFilter?: GPUMipmapFilterMode;
  addressModeU?: GPUAddressMode;
  addressModeV?: GPUAddressMode;
  addressModeW?: GPUAddressMode;
}>;

export type DrawingGraphicsPipelineHandle = Readonly<{
  key: string;
  descriptor: DrawingGraphicsPipelineDesc;
}>;

export type DawnResourceProvider = Readonly<{
  backend: DawnBackendContext;
  resourceBudget: number;
  createBuffer: (descriptor: DrawingBufferDescriptor) => GPUBuffer;
  createTexture: (descriptor: DrawingTextureDescriptor) => GPUTexture;
  createSampler: (descriptor?: DrawingSamplerDescriptor) => GPUSampler;
  createViewportBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  createStepBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  createGradientBindGroup: (buffer: GPUBuffer) => GPUBindGroup;
  createClipTextureBindGroup: (
    clipTextureView?: GPUTextureView,
    dstTextureView?: GPUTextureView,
  ) => GPUBindGroup;
  createGraphicsPipelineHandle: (
    descriptor: DrawingGraphicsPipelineDesc,
  ) => DrawingGraphicsPipelineHandle;
  resolveGraphicsPipelineHandle: (handle: DrawingGraphicsPipelineHandle) => GPURenderPipeline;
  findOrCreateGraphicsPipeline: (descriptor: DrawingGraphicsPipelineDesc) => GPURenderPipeline;
  getStencilAttachmentView: () => GPUTextureView;
}>;

const renderAttachmentUsage = 0x10;
const textureCopyDstUsage = 0x02;
const floatBytes = Float32Array.BYTES_PER_ELEMENT;
const floatsPerVertex = 6;
const stencilFormat = 'depth24plus-stencil8';
const noColorWrites = 0;
const srcOverBlend: GPUBlendState = {
  color: {
    operation: 'add',
    srcFactor: 'src-alpha',
    dstFactor: 'one-minus-src-alpha',
  },
  alpha: {
    operation: 'add',
    srcFactor: 'one',
    dstFactor: 'one-minus-src-alpha',
  },
};
const clearBlend: GPUBlendState = {
  color: {
    operation: 'add',
    srcFactor: 'zero',
    dstFactor: 'zero',
  },
  alpha: {
    operation: 'add',
    srcFactor: 'zero',
    dstFactor: 'zero',
  },
};
const srcBlend: GPUBlendState = {
  color: {
    operation: 'add',
    srcFactor: 'one',
    dstFactor: 'zero',
  },
  alpha: {
    operation: 'add',
    srcFactor: 'one',
    dstFactor: 'zero',
  },
};
const dstBlend: GPUBlendState = {
  color: {
    operation: 'add',
    srcFactor: 'zero',
    dstFactor: 'one',
  },
  alpha: {
    operation: 'add',
    srcFactor: 'zero',
    dstFactor: 'one',
  },
};
const maxPatchResolveLevel = 5;
const tessellationPrecision = 4;
const patchPrecision = 4;
const tessellationPrecisionLiteral = `${tessellationPrecision}.0`;
const patchPrecisionLiteral = `${patchPrecision}.0`;
const cubicLengthTermLiteral = `${(patchPrecision * (3 * 2 / 8)).toFixed(1)}`;
const curveFillSegments = 1 << maxPatchResolveLevel;
const strokePatchSegments = (1 << 14) - 1;
const textureBindingUsage = 0x04;

const getBlendState = (blendMode: DrawingGraphicsPipelineDesc['blendMode']): GPUBlendState =>
  blendMode === 'clear'
    ? clearBlend
    : blendMode === 'src'
    ? srcBlend
    : blendMode === 'dst'
    ? dstBlend
    : manualBlendModes.has(blendMode)
    ? srcBlend
    : srcOverBlend;

const manualBlendModes = new Set<DrawingGraphicsPipelineDesc['blendMode']>([
  'dst-over',
  'src-in',
  'dst-in',
  'src-out',
  'dst-out',
  'src-atop',
  'dst-atop',
  'xor',
  'multiply',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);

const commonBlendShaderSource = `
@group(3) @binding(0) var clipMaskSampler: sampler;
@group(3) @binding(1) var clipMaskTexture: texture_2d<f32>;
@group(3) @binding(2) var dstColorSampler: sampler;
@group(3) @binding(3) var dstColorTexture: texture_2d<f32>;

fn clip_coverage(devicePosition: vec2<f32>) -> f32 {
  var coverage = 1.0;
  if (step.params.y > 0.5) {
    let uv = (devicePosition - step.clipAtlas.xy) * step.clipAtlas.zw;
    coverage *= textureSample(clipMaskTexture, clipMaskSampler, uv).a;
  }
  if (step.params.z > 0.5) {
    let local = devicePosition - step.clipAnalytic.xy;
    let inside = local.x >= 0.0 && local.y >= 0.0 &&
      local.x <= step.clipAnalytic.z && local.y <= step.clipAnalytic.w;
    coverage *= select(0.0, 1.0, inside);
  }
  return coverage;
}

fn apply_clip_shader(color: vec4<f32>) -> vec4<f32> {
  if (step.params.w > 0.5) {
    return color * step.clipShader;
  }
  return color;
}

fn premul_to_straight(color: vec4<f32>) -> vec4<f32> {
  if (color.a <= 1e-5) {
    return vec4<f32>(0.0);
  }
  return vec4<f32>(color.rgb / color.a, color.a);
}

fn straight_to_premul(color: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(color.rgb * color.a, color.a);
}

fn blend_channel_soft_light(backdrop: f32, source: f32) -> f32 {
  if (source <= 0.5) {
    return backdrop - (1.0 - (2.0 * source)) * backdrop * (1.0 - backdrop);
  }
  let d = select(((16.0 * backdrop - 12.0) * backdrop + 4.0) * backdrop, sqrt(backdrop), backdrop > 0.25);
  return backdrop + ((2.0 * source - 1.0) * (d - backdrop));
}

fn lum(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.3, 0.59, 0.11));
}

fn sat(color: vec3<f32>) -> f32 {
  return max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
}

fn clip_color(color: vec3<f32>) -> vec3<f32> {
  let l = lum(color);
  let n = min(color.r, min(color.g, color.b));
  let x = max(color.r, max(color.g, color.b));
  var c = color;
  if (n < 0.0) {
    c = vec3<f32>(
      l + (((c.r - l) * l) / (l - n)),
      l + (((c.g - l) * l) / (l - n)),
      l + (((c.b - l) * l) / (l - n)),
    );
  }
  if (x > 1.0) {
    c = vec3<f32>(
      l + (((c.r - l) * (1.0 - l)) / (x - l)),
      l + (((c.g - l) * (1.0 - l)) / (x - l)),
      l + (((c.b - l) * (1.0 - l)) / (x - l)),
    );
  }
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn set_lum(color: vec3<f32>, l: f32) -> vec3<f32> {
  return clip_color(color + vec3<f32>(l - lum(color)));
}

fn set_sat(color: vec3<f32>, s: f32) -> vec3<f32> {
  let cmin = min(color.r, min(color.g, color.b));
  let cmax = max(color.r, max(color.g, color.b));
  if (cmax <= cmin) {
    return vec3<f32>(0.0);
  }
  let mid = color.r + color.g + color.b - cmin - cmax;
  var result = vec3<f32>(0.0);
  if (color.r == cmin) {
    result.r = 0.0;
  } else if (color.r == cmax) {
    result.r = s;
  } else {
    result.r = ((color.r - cmin) * s) / (cmax - cmin);
  }
  if (color.g == cmin) {
    result.g = 0.0;
  } else if (color.g == cmax) {
    result.g = s;
  } else {
    result.g = ((color.g - cmin) * s) / (cmax - cmin);
  }
  if (color.b == cmin) {
    result.b = 0.0;
  } else if (color.b == cmax) {
    result.b = s;
  } else {
    result.b = ((color.b - cmin) * s) / (cmax - cmin);
  }
  return result;
}

fn blend_advanced(mode: i32, source: vec3<f32>, backdrop: vec3<f32>) -> vec3<f32> {
  if (mode == 13) { return source * backdrop; }
  if (mode == 14) { return source + backdrop - source * backdrop; }
  if (mode == 15) {
    return vec3<f32>(
      select(2.0 * source.r * backdrop.r, 1.0 - 2.0 * (1.0 - source.r) * (1.0 - backdrop.r), backdrop.r > 0.5),
      select(2.0 * source.g * backdrop.g, 1.0 - 2.0 * (1.0 - source.g) * (1.0 - backdrop.g), backdrop.g > 0.5),
      select(2.0 * source.b * backdrop.b, 1.0 - 2.0 * (1.0 - source.b) * (1.0 - backdrop.b), backdrop.b > 0.5),
    );
  }
  if (mode == 16) { return min(source, backdrop); }
  if (mode == 17) { return max(source, backdrop); }
  if (mode == 18) {
    return vec3<f32>(
      select(min(1.0, backdrop.r / max(1.0 - source.r, 1e-5)), 1.0, backdrop.r <= 0.0),
      select(min(1.0, backdrop.g / max(1.0 - source.g, 1e-5)), 1.0, backdrop.g <= 0.0),
      select(min(1.0, backdrop.b / max(1.0 - source.b, 1e-5)), 1.0, backdrop.b <= 0.0),
    );
  }
  if (mode == 19) {
    return vec3<f32>(
      select(1.0 - min(1.0, (1.0 - backdrop.r) / max(source.r, 1e-5)), 0.0, backdrop.r >= 1.0),
      select(1.0 - min(1.0, (1.0 - backdrop.g) / max(source.g, 1e-5)), 0.0, backdrop.g >= 1.0),
      select(1.0 - min(1.0, (1.0 - backdrop.b) / max(source.b, 1e-5)), 0.0, backdrop.b >= 1.0),
    );
  }
  if (mode == 20) {
    return vec3<f32>(
      select(2.0 * source.r * backdrop.r, 1.0 - 2.0 * (1.0 - source.r) * (1.0 - backdrop.r), source.r > 0.5),
      select(2.0 * source.g * backdrop.g, 1.0 - 2.0 * (1.0 - source.g) * (1.0 - backdrop.g), source.g > 0.5),
      select(2.0 * source.b * backdrop.b, 1.0 - 2.0 * (1.0 - source.b) * (1.0 - backdrop.b), source.b > 0.5),
    );
  }
  if (mode == 21) {
    return vec3<f32>(
      blend_channel_soft_light(backdrop.r, source.r),
      blend_channel_soft_light(backdrop.g, source.g),
      blend_channel_soft_light(backdrop.b, source.b),
    );
  }
  if (mode == 22) { return abs(backdrop - source); }
  if (mode == 23) { return source + backdrop - 2.0 * source * backdrop; }
  if (mode == 24) { return set_lum(set_sat(source, sat(backdrop)), lum(backdrop)); }
  if (mode == 25) { return set_lum(set_sat(backdrop, sat(source)), lum(backdrop)); }
  if (mode == 26) { return set_lum(source, lum(backdrop)); }
  if (mode == 27) { return set_lum(backdrop, lum(source)); }
  return source;
}

fn blend_with_dst(srcStraight: vec4<f32>, devicePosition: vec2<f32>) -> vec4<f32> {
  let mode = i32(round(step.dst.z));
  if (step.dst.w <= 0.5) {
    return srcStraight;
  }
  let uv = (devicePosition + vec2<f32>(0.5, 0.5)) * step.dst.xy;
  let dstPremul = textureSample(dstColorTexture, dstColorSampler, uv);
  let srcPremul = straight_to_premul(srcStraight);
  let sa = srcPremul.a;
  let da = dstPremul.a;
  if (mode == 0) { return vec4<f32>(0.0); }
  if (mode == 1) { return srcPremul; }
  if (mode == 2) { return dstPremul; }
  var outPremul = vec4<f32>(0.0);
  if (mode == 3) { outPremul = srcPremul + dstPremul * (1.0 - sa); }
  else if (mode == 4) { outPremul = srcPremul * (1.0 - da) + dstPremul; }
  else if (mode == 5) { outPremul = srcPremul * da; }
  else if (mode == 6) { outPremul = dstPremul * sa; }
  else if (mode == 7) { outPremul = srcPremul * (1.0 - da); }
  else if (mode == 8) { outPremul = dstPremul * (1.0 - sa); }
  else if (mode == 9) { outPremul = srcPremul * da + dstPremul * (1.0 - sa); }
  else if (mode == 10) { outPremul = srcPremul * (1.0 - da) + dstPremul * sa; }
  else if (mode == 11) { outPremul = srcPremul * (1.0 - da) + dstPremul * (1.0 - sa); }
  else if (mode == 12) { outPremul = min(srcPremul + dstPremul, vec4<f32>(1.0)); }
  else if (mode == 100) {
    let src = premul_to_straight(srcPremul);
    let dst = premul_to_straight(dstPremul);
    let result = clamp(
      (step.blender.x * src * dst) +
      (step.blender.y * src) +
      (step.blender.z * dst) +
      vec4<f32>(step.blender.w),
      vec4<f32>(0.0),
      vec4<f32>(1.0),
    );
    outPremul = straight_to_premul(result);
  }
  else {
    let src = premul_to_straight(srcPremul);
    let dst = premul_to_straight(dstPremul);
    let blended = blend_advanced(mode, src.rgb, dst.rgb);
    let outAlpha = sa + da - sa * da;
    let outRgbPremul =
      ((1.0 - da) * srcPremul.rgb) +
      ((1.0 - sa) * dstPremul.rgb) +
      (sa * da * blended);
    outPremul = vec4<f32>(outRgbPremul, outAlpha);
  }
  return outPremul;
}
`;

const commonStepUniformSource = `
struct StepUniform {
  matrix0: vec4<f32>,
  matrix1: vec4<f32>,
  color: vec4<f32>,
  params: vec4<f32>,
  clipAtlas: vec4<f32>,
  clipAnalytic: vec4<f32>,
  clipShader: vec4<f32>,
  dst: vec4<f32>,
  blender: vec4<f32>,
  shaderInfo: vec4<f32>,
  shaderMeta: vec4<f32>,
  shaderParams0: vec4<f32>,
  shaderParams1: vec4<f32>,
  gradientOffsets0: vec4<f32>,
  gradientOffsets1: vec4<f32>,
  gradientColor0: vec4<f32>,
  gradientColor1: vec4<f32>,
  gradientColor2: vec4<f32>,
  gradientColor3: vec4<f32>,
  gradientColor4: vec4<f32>,
  gradientColor5: vec4<f32>,
  gradientColor6: vec4<f32>,
  gradientColor7: vec4<f32>,
  shaderLocalMatrix0: vec4<f32>,
  shaderLocalMatrix1: vec4<f32>,
};
`;

const commonPaintShaderSource = `
struct FSGradientBuffer {
  data: array<f32>,
};

@group(2) @binding(0) var<storage, read> fsGradientBuffer: FSGradientBuffer;

fn saturate01(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn paint_local_position(devicePosition: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.shaderLocalMatrix0.x * devicePosition.x) +
      (step.shaderLocalMatrix0.z * devicePosition.y) + step.shaderLocalMatrix1.x,
    (step.shaderLocalMatrix0.y * devicePosition.x) +
      (step.shaderLocalMatrix0.w * devicePosition.y) + step.shaderLocalMatrix1.y,
  );
}

fn unpremul_color(color: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(color.rgb / max(color.a, 0.0001), color.a);
}

fn unpremul_polar(color: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(color.r, color.g / max(color.a, 0.0001), color.b / max(color.a, 0.0001), color.a);
}

fn css_lab_to_xyz(lab: vec3<f32>) -> vec3<f32> {
  let k = 24389.0 / 27.0;
  let e = 216.0 / 24389.0;
  var f = vec3<f32>(0.0);
  f.y = (lab.x + 16.0) / 116.0;
  f.x = (lab.y / 500.0) + f.y;
  f.z = f.y - (lab.z / 200.0);
  let fCubed = f * f * f;
  var xyz = vec3<f32>(
    select((116.0 * f.x - 16.0) / k, fCubed.x, fCubed.x > e),
    select(lab.x / k, fCubed.y, lab.x > k * e),
    select((116.0 * f.z - 16.0) / k, fCubed.z, fCubed.z > e),
  );
  let d50 = vec3<f32>(0.3457 / 0.3585, 1.0, (1.0 - 0.3457 - 0.3585) / 0.3585);
  return xyz * d50;
}

fn css_hcl_to_lab(hcl: vec3<f32>) -> vec3<f32> {
  let radiansHue = radians(hcl.x);
  return vec3<f32>(hcl.z, hcl.y * cos(radiansHue), hcl.y * sin(radiansHue));
}

fn css_hcl_to_xyz(hcl: vec3<f32>) -> vec3<f32> {
  return css_lab_to_xyz(css_hcl_to_lab(hcl));
}

fn css_oklab_to_linear_srgb(oklab: vec3<f32>) -> vec3<f32> {
  let l_ = oklab.x + 0.3963377774 * oklab.y + 0.2158037573 * oklab.z;
  let m_ = oklab.x - 0.1055613458 * oklab.y - 0.0638541728 * oklab.z;
  let s_ = oklab.x - 0.0894841775 * oklab.y - 1.2914855480 * oklab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  return vec3<f32>(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  );
}

fn css_okhcl_to_linear_srgb(okhcl: vec3<f32>) -> vec3<f32> {
  return css_oklab_to_linear_srgb(css_hcl_to_lab(okhcl));
}

fn css_oklab_gamut_map_to_linear_srgb(oklab: vec3<f32>) -> vec3<f32> {
  let normalR = vec2<f32>(0.409702, -0.912219);
  let normalM = vec2<f32>(-0.397919, -0.917421);
  let normalB = vec2<f32>(-0.906800, 0.421562);
  let normalC = vec2<f32>(-0.171122, 0.985250);
  let normalG = vec2<f32>(0.460276, 0.887776);
  let normalY = vec2<f32>(0.947925, 0.318495);
  let c0YR = 0.091132;
  let cWYR = vec2<f32>(0.070370, 0.034139);
  let cKYR = vec2<f32>(0.018170, 0.378550);
  let c0RM = 0.113902;
  let cWRM = vec2<f32>(0.090836, 0.036251);
  let cKRM = vec2<f32>(0.226781, 0.018764);
  let c0MB = 0.161739;
  let cWMB = vec2<f32>(-0.008202, -0.264819);
  let cKMB = vec2<f32>(0.187156, -0.284304);
  let c0BC = 0.102047;
  let cWBC = vec2<f32>(-0.014804, -0.162608);
  let cKBC = vec2<f32>(-0.276786, 0.004193);
  let c0CG = 0.092029;
  let cWCG = vec2<f32>(-0.038533, -0.001650);
  let cKCG = vec2<f32>(-0.232572, -0.094331);
  let c0GY = 0.081709;
  let cWGY = vec2<f32>(-0.034601, -0.002215);
  let cKGY = vec2<f32>(0.012185, 0.338031);
  var ab = oklab.yz;
  var c0 = 0.0;
  var cW = vec2<f32>(0.0);
  var cK = vec2<f32>(0.0);
  if (dot(ab, normalR) < 0.0) {
    if (dot(ab, normalG) < 0.0) {
      if (dot(ab, normalC) < 0.0) {
        c0 = c0BC; cW = cWBC; cK = cKBC;
      } else {
        c0 = c0CG; cW = cWCG; cK = cKCG;
      }
    } else {
      if (dot(ab, normalY) < 0.0) {
        c0 = c0GY; cW = cWGY; cK = cKGY;
      } else {
        c0 = c0YR; cW = cWYR; cK = cKYR;
      }
    }
  } else if (dot(ab, normalB) < 0.0) {
    if (dot(ab, normalM) < 0.0) {
      c0 = c0RM; cW = cWRM; cK = cKRM;
    } else {
      c0 = c0MB; cW = cWMB; cK = cKMB;
    }
  } else {
    c0 = c0BC; cW = cWBC; cK = cKBC;
  }
  var alpha = 1.0;
  let wDenom = dot(cW, ab);
  if (wDenom > 0.0) {
    let wNum = c0 * (1.0 - oklab.x);
    if (wNum < wDenom) {
      alpha = min(alpha, wNum / wDenom);
    }
  }
  let kDenom = dot(cK, ab);
  if (kDenom > 0.0) {
    let kNum = c0 * oklab.x;
    if (kNum < kDenom) {
      alpha = min(alpha, kNum / kDenom);
    }
  }
  return css_oklab_to_linear_srgb(vec3<f32>(oklab.x, oklab.y * alpha, oklab.z * alpha));
}

fn css_okhcl_gamut_map_to_linear_srgb(okhcl: vec3<f32>) -> vec3<f32> {
  return css_oklab_gamut_map_to_linear_srgb(css_hcl_to_lab(okhcl));
}

fn css_hsl_to_srgb(hslIn: vec3<f32>) -> vec3<f32> {
  var hsl = hslIn;
  hsl.x = hsl.x - 360.0 * floor(hsl.x / 360.0);
  if (hsl.x < 0.0) {
    hsl.x += 360.0;
  }
  hsl.y = hsl.y / 100.0;
  hsl.z = hsl.z / 100.0;
  let modK = vec3<f32>(
    fract((0.0 + hsl.x / 30.0) / 12.0) * 12.0,
    fract((8.0 + hsl.x / 30.0) / 12.0) * 12.0,
    fract((4.0 + hsl.x / 30.0) / 12.0) * 12.0,
  );
  let a = hsl.y * min(hsl.z, 1.0 - hsl.z);
  return vec3<f32>(hsl.z) - a * clamp(min(modK - 3.0, 9.0 - modK), vec3<f32>(-1.0), vec3<f32>(1.0));
}

fn css_hwb_to_srgb(hwbIn: vec3<f32>) -> vec3<f32> {
  var hwb = hwbIn;
  hwb.y = hwb.y / 100.0;
  hwb.z = hwb.z / 100.0;
  if (hwb.y + hwb.z >= 1.0) {
    return vec3<f32>(hwb.y / (hwb.y + hwb.z));
  }
  var rgb = css_hsl_to_srgb(vec3<f32>(hwb.x, 100.0, 50.0));
  rgb *= 1.0 - hwb.y - hwb.z;
  rgb += hwb.y;
  return rgb;
}

fn interpolated_to_rgb_unpremul(colorIn: vec4<f32>, colorSpace: i32, doUnpremul: i32) -> vec4<f32> {
  var color = colorIn;
  if (doUnpremul != 0) {
    if (colorSpace == 2 || colorSpace == 3 || colorSpace == 4) {
      color = unpremul_color(color);
    } else if (
      colorSpace == 5 || colorSpace == 6 || colorSpace == 7 ||
      colorSpace == 9 || colorSpace == 10
    ) {
      color = unpremul_polar(color);
    }
  }
  if (colorSpace == 2) {
    color = vec4<f32>(css_lab_to_xyz(color.rgb), color.a);
  } else if (colorSpace == 3) {
    color = vec4<f32>(css_oklab_to_linear_srgb(color.rgb), color.a);
  } else if (colorSpace == 4) {
    color = vec4<f32>(css_oklab_gamut_map_to_linear_srgb(color.rgb), color.a);
  } else if (colorSpace == 5) {
    color = vec4<f32>(css_hcl_to_xyz(color.rgb), color.a);
  } else if (colorSpace == 6) {
    color = vec4<f32>(css_okhcl_to_linear_srgb(color.rgb), color.a);
  } else if (colorSpace == 7) {
    color = vec4<f32>(css_okhcl_gamut_map_to_linear_srgb(color.rgb), color.a);
  } else if (colorSpace == 9) {
    color = vec4<f32>(css_hsl_to_srgb(color.rgb), color.a);
  } else if (colorSpace == 10) {
    color = vec4<f32>(css_hwb_to_srgb(color.rgb), color.a);
  }
  return color;
}

fn tile_grad(tileMode: i32, tIn: vec2<f32>) -> vec2<f32> {
  var t = tIn;
  if (tileMode == 1) {
    t.x = fract(t.x);
  } else if (tileMode == 2) {
    let t1 = t.x - 1.0;
    t.x = abs(t1 - 2.0 * floor(t1 * 0.5) - 1.0);
  } else if (tileMode == 3) {
    if (t.x < 0.0 || t.x > 1.0) {
      return vec2<f32>(0.0, -1.0);
    }
  }
  return t;
}

fn inline_gradient_stop_offset(layoutCode: i32, index: i32) -> f32 {
  if (index <= 0) {
    return step.gradientOffsets0.x;
  } else if (index == 1) {
    return step.gradientOffsets0.y;
  } else if (index == 2) {
    return step.gradientOffsets0.z;
  } else if (index == 3) {
    return step.gradientOffsets0.w;
  } else if (layoutCode == 2 && index == 4) {
    return step.gradientOffsets1.x;
  } else if (layoutCode == 2 && index == 5) {
    return step.gradientOffsets1.y;
  } else if (layoutCode == 2 && index == 6) {
    return step.gradientOffsets1.z;
  }
  return step.gradientOffsets1.w;
}

fn inline_gradient_stop_color(index: i32) -> vec4<f32> {
  if (index <= 0) {
    return step.gradientColor0;
  } else if (index == 1) {
    return step.gradientColor1;
  } else if (index == 2) {
    return step.gradientColor2;
  } else if (index == 3) {
    return step.gradientColor3;
  } else if (index == 4) {
    return step.gradientColor4;
  } else if (index == 5) {
    return step.gradientColor5;
  } else if (index == 6) {
    return step.gradientColor6;
  }
  return step.gradientColor7;
}

fn buffer_gradient_stop_color(index: i32, numStops: i32, bufferOffset: i32) -> vec4<f32> {
  let base = bufferOffset + numStops + (index * 4);
  return vec4<f32>(
    fsGradientBuffer.data[base],
    fsGradientBuffer.data[base + 1],
    fsGradientBuffer.data[base + 2],
    fsGradientBuffer.data[base + 3],
  );
}

fn buffer_gradient_stop_offset(index: i32, bufferOffset: i32) -> f32 {
  return fsGradientBuffer.data[bufferOffset + index];
}

fn gradient_stop_offset(layoutCode: i32, index: i32, bufferOffset: i32) -> f32 {
  if (layoutCode == 3) {
    return buffer_gradient_stop_offset(index, bufferOffset);
  }
  return inline_gradient_stop_offset(layoutCode, index);
}

fn gradient_stop_color(layoutCode: i32, index: i32, numStops: i32, bufferOffset: i32) -> vec4<f32> {
  if (layoutCode == 3) {
    return buffer_gradient_stop_color(index, numStops, bufferOffset);
  }
  return inline_gradient_stop_color(index);
}

fn mix_gradient_interval(
  t: f32,
  lowOffset: f32,
  lowColor: vec4<f32>,
  highOffset: f32,
  highColor: vec4<f32>,
) -> vec4<f32> {
  if (highOffset <= lowOffset) {
    return select(lowColor, highColor, t >= highOffset);
  }
  return mix(lowColor, highColor, (t - lowOffset) / (highOffset - lowOffset));
}

fn gradient_interpolated_color(
  layoutCode: i32,
  numStops: i32,
  bufferOffset: i32,
  t: f32,
) -> vec4<f32> {
  var startIndex = 0;
  var endIndex = numStops - 1;
  if (
    numStops > 1 &&
    gradient_stop_offset(layoutCode, 0, bufferOffset) ==
      gradient_stop_offset(layoutCode, 1, bufferOffset)
  ) {
    startIndex = 1;
  }
  if (
    numStops > 1 &&
    gradient_stop_offset(layoutCode, numStops - 2, bufferOffset) ==
      gradient_stop_offset(layoutCode, numStops - 1, bufferOffset)
  ) {
    endIndex = numStops - 2;
  }

  if (t <= gradient_stop_offset(layoutCode, startIndex, bufferOffset)) {
    return gradient_stop_color(layoutCode, startIndex, numStops, bufferOffset);
  }
  if (t >= gradient_stop_offset(layoutCode, endIndex, bufferOffset)) {
    return gradient_stop_color(layoutCode, endIndex, numStops, bufferOffset);
  }

  var lowIndex = startIndex;
  var highIndex = endIndex;
  while (highIndex - lowIndex > 1) {
    let middleIndex = (lowIndex + highIndex) / 2;
    if (t < gradient_stop_offset(layoutCode, middleIndex, bufferOffset)) {
      highIndex = middleIndex;
    } else {
      lowIndex = middleIndex;
    }
  }

  let lowOffset = gradient_stop_offset(layoutCode, lowIndex, bufferOffset);
  let lowColor = gradient_stop_color(layoutCode, lowIndex, numStops, bufferOffset);
  let highOffset = gradient_stop_offset(layoutCode, highIndex, bufferOffset);
  let highColor = gradient_stop_color(layoutCode, highIndex, numStops, bufferOffset);
  return mix_gradient_interval(t, lowOffset, lowColor, highOffset, highColor);
}

fn colorize_gradient(
  layoutCode: i32,
  numStops: i32,
  bufferOffset: i32,
  tileMode: i32,
  t: vec2<f32>,
) -> vec4<f32> {
  if (t.y < 0.0) {
    return vec4<f32>(0.0);
  }

  if (tileMode == 0) {
    if (t.x < 0.0) {
      return gradient_stop_color(layoutCode, 0, numStops, bufferOffset);
    }
    if (t.x > 1.0) {
      return gradient_stop_color(layoutCode, numStops - 1, numStops, bufferOffset);
    }
    return gradient_interpolated_color(layoutCode, numStops, bufferOffset, t.x);
  }

  let tiled = tile_grad(tileMode, t);
  if (tiled.y < 0.0) {
    return vec4<f32>(0.0);
  }
  return gradient_interpolated_color(layoutCode, numStops, bufferOffset, tiled.x);
}

fn linear_grad_layout(pos: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(pos.x + 0.00001, 1.0);
}

fn radial_grad_layout(pos: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(length(pos), 1.0);
}

fn sweep_grad_layout(biasParam: f32, scaleParam: f32, pos: vec2<f32>) -> vec2<f32> {
  let angle = select(atan2(-pos.y, -pos.x), sign(pos.y) * -1.5707963267949, pos.x == 0.0);
  let t = (angle * 0.1591549430918 + 0.5 + biasParam) * scaleParam;
  return vec2<f32>(t, 1.0);
}

fn conical_grad_layout(radius0: f32, dRadius: f32, a: f32, invA: f32, pos: vec2<f32>) -> vec2<f32> {
  if (a == 0.0 && invA == 1.0) {
    return vec2<f32>(length(pos) * dRadius - radius0, 1.0);
  }
  let c = dot(pos, pos) - radius0 * radius0;
  let negB = 2.0 * (dRadius * radius0 + pos.x);
  var t = 0.0;
  if (a == 0.0) {
    t = c / negB;
  } else {
    let d = negB * negB - 4.0 * a * c;
    if (d < 0.0) {
      return vec2<f32>(0.0, -1.0);
    }
    t = invA * (negB + sign(1.0 - dRadius) * sqrt(d));
  }
  return vec2<f32>(t, sign(t * dRadius + radius0));
}

fn paint_shader_color(devicePosition: vec2<f32>) -> vec4<f32> {
  let kind = i32(round(step.shaderInfo.x));
  if (kind == 0) {
    return step.color;
  }
  let gradientLayout = i32(round(step.shaderInfo.y));
  let numStops = i32(round(step.shaderInfo.z));
  let bufferOffset = i32(round(step.shaderInfo.w));
  let tileMode = i32(round(step.shaderMeta.x));
  let colorSpace = i32(round(step.shaderMeta.y));
  let doUnpremul = i32(round(step.shaderMeta.z));
  let coords = paint_local_position(devicePosition);
  let t = select(
    select(
      select(
        radial_grad_layout(coords),
        linear_grad_layout(coords),
        kind == 1,
      ),
      sweep_grad_layout(step.shaderParams0.x, step.shaderParams0.y, coords),
      kind == 3,
    ),
    conical_grad_layout(step.shaderParams0.x, step.shaderParams0.y, step.shaderParams0.z, step.shaderParams0.w, coords),
    kind == 4,
  );
  let color = colorize_gradient(gradientLayout, numStops, bufferOffset, tileMode, t);
  return interpolated_to_rgb_unpremul(color, colorSpace, doUnpremul);
}
`;

const fillPathShaderSource = `
struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

${commonStepUniformSource}

@group(1) @binding(0) var<uniform> step: StepUniform;
${commonBlendShaderSource}
${commonPaintShaderSource}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
};

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}


fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, step.matrix1.w, 1.0);
}

@vertex
fn vs_main(
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>,
) -> VertexOut {
  let devicePosition = local_to_device(position);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.color = color;
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let coverage = in.color.a;
  let clipCoverage = clip_coverage(in.devicePosition);
  var color = apply_clip_shader(paint_shader_color(in.devicePosition));
  color.a *= coverage * clipCoverage;
  return blend_with_dst(color, in.devicePosition);
}
`;

const wedgePatchShaderSource = `
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

${commonStepUniformSource}

@group(1) @binding(0) var<uniform> step: StepUniform;
${commonBlendShaderSource}
${commonPaintShaderSource}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, step.matrix1.w, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

fn affine_matrix() -> mat2x2<f32> {
  return mat2x2<f32>(
    vec2<f32>(step.matrix0.x, step.matrix0.y),
    vec2<f32>(step.matrix0.z, step.matrix0.w),
  );
}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let v1 = matrix * (p0 - (2.0 * p1) + p2);
  let v2 = matrix * (p1 - (2.0 * p2) + p3);
  return max(dot(v1, v1), dot(v2, v2));
}

fn wangs_formula_cubic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTerm = ${cubicLengthTermLiteral};
  return max(ceil(sqrt(lengthTerm * sqrt(max(m, 0.0)))), 1.0);
}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {
  return fma(b - a, vec2<f32>(t), a);
}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  let tp0 = matrix * p0;
  let tp1 = matrix * p1;
  let tp2 = matrix * p2;
  let center = (min(min(tp0, tp1), tp2) + max(max(tp0, tp1), tp2)) * 0.5;
  let cp0 = tp0 - center;
  let cp1 = tp1 - center;
  let cp2 = tp2 - center;
  let maxLen = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rpMinus1 = max(0.0, fma(maxLen, ${patchPrecisionLiteral}, -1.0));
  let numer = length(dp) * ${patchPrecisionLiteral} + rpMinus1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}

fn wangs_formula_conic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return max(ceil(sqrt(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0))), 1.0);
}

fn wangs_formula_cubic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTermPow2 = ${((3 * 3) * (2 * 2) / 64 * (4 * 4)).toFixed(2)};
  return ceil(log2(max(lengthTermPow2 * m, 1.0)) * 0.25);
}

fn wangs_formula_conic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return ceil(log2(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0)) * 0.5);
}

fn tessellate_filled_curve(
  vectorXform: mat2x2<f32>,
  resolveLevel: f32,
  idxInResolveLevel: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  curveType: f32,
  weight: f32,
) -> vec2<f32> {
  _ = weight;
  if (curveType > 1.5) {
    return select(select(p0, p2, idxInResolveLevel != 0.0), p1, resolveLevel != 0.0);
  }

  var localP0 = p0;
  var localP1 = p1;
  var localP2 = p2;
  var localP3 = p3;
  var w = -1.0;
  var maxResolveLevel = 0.0;
  if (curveType > 0.5) {
    w = localP3.x;
    maxResolveLevel = wangs_formula_conic_log2(localP0, localP1, localP2, w, vectorXform);
    localP1 *= w;
    localP3 = localP2;
  } else {
    maxResolveLevel = wangs_formula_cubic_log2(localP0, localP1, localP2, localP3, vectorXform);
  }

  var localResolveLevel = resolveLevel;
  var localIdxInResolveLevel = idxInResolveLevel;
  if (localResolveLevel > maxResolveLevel) {
    localIdxInResolveLevel = floor(localIdxInResolveLevel * exp2(maxResolveLevel - localResolveLevel));
    localResolveLevel = maxResolveLevel;
  }
  let fixedVertexID = floor(0.5 + (localIdxInResolveLevel * exp2(MAX_RESOLVE_LEVEL - localResolveLevel)));
  if (0.0 < fixedVertexID && fixedVertexID < 32.0) {
    let T = fixedVertexID * (1.0 / 32.0);
    let ab = unchecked_mix_vec2(localP0, localP1, T);
    let bc = unchecked_mix_vec2(localP1, localP2, T);
    let cd = unchecked_mix_vec2(localP2, localP3, T);
    let abc = unchecked_mix_vec2(ab, bc, T);
    let bcd = unchecked_mix_vec2(bc, cd, T);
    let abcd = unchecked_mix_vec2(abc, bcd, T);
    let u = mix(1.0, w, T);
    let v = w + 1.0 - u;
    let uv = mix(u, v, T);
    return select(abc / uv, abcd, w < 0.0);
  } else {
    return select(localP0, localP3, fixedVertexID > 0.0);
  }
}

@vertex
fn vs_main(
  @location(0) resolveLevelAndIdx: vec2<f32>,
  @location(1) p0: vec2<f32>,
  @location(2) p1: vec2<f32>,
  @location(3) p2: vec2<f32>,
  @location(4) p3: vec2<f32>,
  @location(5) curveMeta: vec4<f32>,
  @location(6) fanPoint: vec2<f32>,
) -> VertexOut {
  var local: vec2<f32>;
  let curveType = curveMeta.x;
  let weight = curveMeta.y;
  if (resolveLevelAndIdx.x < 0.0) {
    local = fanPoint;
  } else {
    local = tessellate_filled_curve(
      affine_matrix(),
      resolveLevelAndIdx.x,
      resolveLevelAndIdx.y,
      p0,
      p1,
      p2,
      p3,
      curveType,
      weight,
    );
  }
  let devicePosition = local_to_device(local);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let clipCoverage = clip_coverage(in.devicePosition);
  var color = apply_clip_shader(paint_shader_color(in.devicePosition));
  color.a *= clipCoverage;
  return blend_with_dst(color, in.devicePosition);
}
`;

const curvePatchShaderSource = `
const SEGMENTS: u32 = ${curveFillSegments}u;
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

${commonStepUniformSource}

@group(1) @binding(0) var<uniform> step: StepUniform;
${commonBlendShaderSource}
${commonPaintShaderSource}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, step.matrix1.w, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

fn affine_matrix() -> mat2x2<f32> {
  return mat2x2<f32>(
    vec2<f32>(step.matrix0.x, step.matrix0.y),
    vec2<f32>(step.matrix0.z, step.matrix0.w),
  );
}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let v1 = matrix * (p0 - (2.0 * p1) + p2);
  let v2 = matrix * (p1 - (2.0 * p2) + p3);
  return max(dot(v1, v1), dot(v2, v2));
}

fn wangs_formula_cubic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTerm = ${cubicLengthTermLiteral};
  return max(ceil(sqrt(lengthTerm * sqrt(max(m, 0.0)))), 1.0);
}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {
  return fma(b - a, vec2<f32>(t), a);
}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  let tp0 = matrix * p0;
  let tp1 = matrix * p1;
  let tp2 = matrix * p2;
  let center = (min(min(tp0, tp1), tp2) + max(max(tp0, tp1), tp2)) * 0.5;
  let cp0 = tp0 - center;
  let cp1 = tp1 - center;
  let cp2 = tp2 - center;
  let maxLen = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rpMinus1 = max(0.0, fma(maxLen, ${patchPrecisionLiteral}, -1.0));
  let numer = length(dp) * ${patchPrecisionLiteral} + rpMinus1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}

fn wangs_formula_conic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return max(ceil(sqrt(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0))), 1.0);
}

fn wangs_formula_cubic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTermPow2 = ${((3 * 3) * (2 * 2) / 64 * (4 * 4)).toFixed(2)};
  return ceil(log2(max(lengthTermPow2 * m, 1.0)) * 0.25);
}

fn wangs_formula_conic_log2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return ceil(log2(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0)) * 0.5);
}

fn tessellate_filled_curve(
  vectorXform: mat2x2<f32>,
  resolveLevel: f32,
  idxInResolveLevel: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  curveType: f32,
  weight: f32,
) -> vec2<f32> {
  _ = weight;
  if (curveType > 1.5) {
    return select(select(p0, p2, idxInResolveLevel != 0.0), p1, resolveLevel != 0.0);
  }
  var localP0 = p0;
  var localP1 = p1;
  var localP2 = p2;
  var localP3 = p3;
  var w = -1.0;
  var maxResolveLevel = 0.0;
  if (curveType > 0.5) {
    w = localP3.x;
    maxResolveLevel = wangs_formula_conic_log2(localP0, localP1, localP2, w, vectorXform);
    localP1 *= w;
    localP3 = localP2;
  } else {
    maxResolveLevel = wangs_formula_cubic_log2(localP0, localP1, localP2, localP3, vectorXform);
  }
  var localResolveLevel = resolveLevel;
  var localIdxInResolveLevel = idxInResolveLevel;
  if (localResolveLevel > maxResolveLevel) {
    localIdxInResolveLevel = floor(localIdxInResolveLevel * exp2(maxResolveLevel - localResolveLevel));
    localResolveLevel = maxResolveLevel;
  }
  let fixedVertexID = floor(0.5 + (localIdxInResolveLevel * exp2(MAX_RESOLVE_LEVEL - localResolveLevel)));
  if (0.0 < fixedVertexID && fixedVertexID < 32.0) {
    let T = fixedVertexID * (1.0 / 32.0);
    let ab = unchecked_mix_vec2(localP0, localP1, T);
    let bc = unchecked_mix_vec2(localP1, localP2, T);
    let cd = unchecked_mix_vec2(localP2, localP3, T);
    let abc = unchecked_mix_vec2(ab, bc, T);
    let bcd = unchecked_mix_vec2(bc, cd, T);
    let abcd = unchecked_mix_vec2(abc, bcd, T);
    let u = mix(1.0, w, T);
    let v = w + 1.0 - u;
    let uv = mix(u, v, T);
    return select(abc / uv, abcd, w < 0.0);
  }
  return select(localP0, localP3, fixedVertexID > 0.0);
}

fn cosine_between_unit_vectors(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return clamp(dot(a, b), -1.0, 1.0);
}

fn miter_extent(cosTheta: f32, miterLimit: f32) -> f32 {
  let x = fma(cosTheta, 0.5, 0.5);
  if (x * miterLimit * miterLimit >= 1.0) {
    return inverseSqrt(max(x, 1e-5));
  }
  return sqrt(max(x, 0.0));
}

fn num_radial_segments_per_radian(approxDevStrokeRadius: f32) -> f32 {
  let radius = max(approxDevStrokeRadius, 0.5);
  return 0.5 / acos(max(1.0 - (1.0 / ${tessellationPrecisionLiteral}) / radius, -1.0));
}

@vertex
fn vs_main(
  @location(0) resolveLevelAndIdx: vec2<f32>,
  @location(1) p0: vec2<f32>,
  @location(2) p1: vec2<f32>,
  @location(3) p2: vec2<f32>,
  @location(4) p3: vec2<f32>,
  @location(5) curveMeta: vec4<f32>,
) -> VertexOut {
  let local = tessellate_filled_curve(
    affine_matrix(),
    resolveLevelAndIdx.x,
    resolveLevelAndIdx.y,
    p0,
    p1,
    p2,
    p3,
    curveMeta.x,
    curveMeta.y,
  );
  let devicePosition = local_to_device(local);
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let clipCoverage = clip_coverage(in.devicePosition);
  var color = apply_clip_shader(paint_shader_color(in.devicePosition));
  color.a *= clipCoverage;
  return blend_with_dst(color, in.devicePosition);
}
`;

const strokePatchShaderSource = `
const SEGMENTS: u32 = ${strokePatchSegments}u;
const MAX_RESOLVE_LEVEL: f32 = ${maxPatchResolveLevel}.0;

struct ViewportUniform {
  scale: vec2<f32>,
  translate: vec2<f32>,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;

${commonStepUniformSource}

@group(1) @binding(0) var<uniform> step: StepUniform;
${commonBlendShaderSource}
${commonPaintShaderSource}

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) devicePosition: vec2<f32>,
};

fn device_to_ndc(position: vec2<f32>) -> vec4<f32> {
  return vec4<f32>((position * viewport.scale) + viewport.translate, step.matrix1.w, 1.0);
}

fn local_to_device(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (step.matrix0.x * position.x) + (step.matrix0.z * position.y) + step.matrix1.x,
    (step.matrix0.y * position.x) + (step.matrix0.w * position.y) + step.matrix1.y,
  );
}

fn affine_matrix() -> mat2x2<f32> {
  return mat2x2<f32>(
    vec2<f32>(step.matrix0.x, step.matrix0.y),
    vec2<f32>(step.matrix0.z, step.matrix0.w),
  );
}

fn wangs_formula_max_fdiff_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let v1 = matrix * (p0 - (2.0 * p1) + p2);
  let v2 = matrix * (p1 - (2.0 * p2) + p3);
  return max(dot(v1, v1), dot(v2, v2));
}

fn wangs_formula_cubic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  matrix: mat2x2<f32>,
) -> f32 {
  let m = wangs_formula_max_fdiff_p2(p0, p1, p2, p3, matrix);
  let lengthTerm = ${cubicLengthTermLiteral};
  return max(ceil(sqrt(lengthTerm * sqrt(max(m, 0.0)))), 1.0);
}

fn wangs_formula_conic_p2(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  let tp0 = matrix * p0;
  let tp1 = matrix * p1;
  let tp2 = matrix * p2;
  let center = (min(min(tp0, tp1), tp2) + max(max(tp0, tp1), tp2)) * 0.5;
  let cp0 = tp0 - center;
  let cp1 = tp1 - center;
  let cp2 = tp2 - center;
  let maxLen = sqrt(max(max(dot(cp0, cp0), dot(cp1, cp1)), dot(cp2, cp2)));
  let dp = fma(vec2<f32>(-2.0 * w), cp1, cp0) + cp2;
  let dw = abs(fma(-2.0, w, 2.0));
  let rpMinus1 = max(0.0, fma(maxLen, ${patchPrecisionLiteral}, -1.0));
  let numer = length(dp) * ${patchPrecisionLiteral} + rpMinus1 * dw;
  let denom = 4.0 * min(w, 1.0);
  return numer / max(denom, 1e-5);
}

fn wangs_formula_conic(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  w: f32,
  matrix: mat2x2<f32>,
) -> f32 {
  return max(ceil(sqrt(max(wangs_formula_conic_p2(p0, p1, p2, w, matrix), 1.0))), 1.0);
}

fn eval_patch(
  curveType: f32,
  weight: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  if (curveType < 0.5) {
    return mix(p0, p1, t);
  }
  if (curveType < 1.5) {
    return (oneMinusT * oneMinusT * p0) + (2.0 * oneMinusT * t * p1) + (t * t * p2);
  }
  if (curveType < 2.5) {
    let denom = (oneMinusT * oneMinusT) + (2.0 * weight * oneMinusT * t) + (t * t);
    return ((oneMinusT * oneMinusT * p0) + (2.0 * weight * oneMinusT * t * p1) + (t * t * p2)) / max(denom, 1e-5);
  }
  return (
    (oneMinusT * oneMinusT * oneMinusT * p0) +
    (3.0 * oneMinusT * oneMinusT * t * p1) +
    (3.0 * oneMinusT * t * t * p2) +
    (t * t * t * p3)
  );
}

fn cosine_between_unit_vectors(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return clamp(dot(a, b), -1.0, 1.0);
}

fn miter_extent(cosTheta: f32, miterLimit: f32) -> f32 {
  let x = fma(cosTheta, 0.5, 0.5);
  if (x * miterLimit * miterLimit >= 1.0) {
    return inverseSqrt(max(x, 1e-5));
  }
  return sqrt(max(x, 0.0));
}

fn num_radial_segments_per_radian(approxDevStrokeRadius: f32) -> f32 {
  let radius = max(approxDevStrokeRadius, 0.5);
  return 0.5 / acos(max(1.0 - (1.0 / ${tessellationPrecisionLiteral}) / radius, -1.0));
}

fn robust_normalize_diff(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let delta = a - b;
  if (all(delta == vec2<f32>(0.0, 0.0))) {
    return vec2<f32>(0.0, 0.0);
  }
  let invMag = 1.0 / max(abs(delta.x), abs(delta.y));
  return normalize(invMag * delta);
}

fn unchecked_mix(a: f32, b: f32, t: f32) -> f32 {
  return fma(b - a, t, a);
}

fn unchecked_mix_vec2(a: vec2<f32>, b: vec2<f32>, t: f32) -> vec2<f32> {
  return fma(b - a, vec2<f32>(t), a);
}

fn patch_start_tangent(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> vec2<f32> {
  if (distance(p0, p1) > 1e-5) {
    return robust_normalize_diff(p1, p0);
  }
  if (distance(p0, p2) > 1e-5) {
    return robust_normalize_diff(p2, p0);
  }
  return robust_normalize_diff(p3, p0);
}

fn patch_end_tangent(
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
) -> vec2<f32> {
  if (distance(p3, p2) > 1e-5) {
    return robust_normalize_diff(p3, p2);
  }
  if (distance(p3, p1) > 1e-5) {
    return robust_normalize_diff(p3, p1);
  }
  return robust_normalize_diff(p3, p0);
}

fn eval_patch_tangent(
  curveType: f32,
  weight: f32,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  p3: vec2<f32>,
  t: f32,
) -> vec2<f32> {
  if (curveType < 0.5) {
    return robust_normalize_diff(p1, p0);
  }
  if (curveType < 1.5) {
    let tangent =
      (2.0 * (1.0 - t) * (p1 - p0)) +
      (2.0 * t * (p2 - p1));
    return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
  }
  if (curveType < 2.5) {
    let oneMinusT = 1.0 - t;
    let numerator =
      (oneMinusT * oneMinusT * p0) +
      (2.0 * weight * oneMinusT * t * p1) +
      (t * t * p2);
    let denom = (oneMinusT * oneMinusT) + (2.0 * weight * oneMinusT * t) + (t * t);
    let numeratorDeriv =
      (-2.0 * oneMinusT * p0) +
      (2.0 * weight * (1.0 - 2.0 * t) * p1) +
      (2.0 * t * p2);
    let denomDeriv = (-2.0 * oneMinusT) + (2.0 * weight * (1.0 - 2.0 * t)) + (2.0 * t);
    let safeDenom = max(denom, 1e-5);
    let tangent = ((numeratorDeriv * safeDenom) - (numerator * denomDeriv)) / (safeDenom * safeDenom);
    return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
  }
  let oneMinusT = 1.0 - t;
  let tangent =
    (3.0 * oneMinusT * oneMinusT * (p1 - p0)) +
    (6.0 * oneMinusT * t * (p2 - p1)) +
    (3.0 * t * t * (p3 - p2));
  return robust_normalize_diff(tangent, vec2<f32>(0.0, 0.0));
}

fn cross_length_2d(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return (a.x * b.y) - (a.y * b.x);
}

fn stroke_join_edges(joinType: f32, prevTan: vec2<f32>, tan0: vec2<f32>, strokeRadius: f32) -> f32 {
  if (joinType >= 0.0) {
    return sign(joinType) + 3.0;
  }
  let joinRads = acos(cosine_between_unit_vectors(prevTan, tan0));
  let numRadialSegmentsInJoin = max(ceil(joinRads * num_radial_segments_per_radian(strokeRadius)), 1.0);
  return numRadialSegmentsInJoin + 2.0;
}

fn tangents_nearly_parallel(turn: f32, tan0: vec2<f32>, tan1: vec2<f32>) -> bool {
  let sinEpsilon = 1e-2;
  let tangentScale = max(dot(tan0, tan0) * dot(tan1, tan1), 1e-5);
  return abs(turn) * inverseSqrt(tangentScale) < sinEpsilon;
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) p0: vec2<f32>,
  @location(1) p1: vec2<f32>,
  @location(2) p2: vec2<f32>,
  @location(3) p3: vec2<f32>,
  @location(4) joinControlPoint: vec2<f32>,
  @location(5) stroke: vec2<f32>,
  @location(6) curveMeta: vec2<f32>,
) -> VertexOut {
  var edgeID = f32(vertexIndex >> 1u);
  if ((vertexIndex & 1u) != 0u) {
    edgeID = -edgeID;
  }
  let affine = affine_matrix();
  let curveType = curveMeta.x;
  var weight = -1.0;
  var curveP0 = p0;
  var curveP1 = p1;
  var curveP2 = p2;
  var curveP3 = p3;
  if (curveType >= 1.5 && curveType < 2.5) {
    weight = curveMeta.y;
    curveP3 = curveP2;
  }
  var strokeRadius = stroke.x;
  var joinType = stroke.y;
  var lastControlPoint = joinControlPoint;
  let maxScale = max(step.matrix1.z, 1.0);
  var numParametricSegments: f32;
  if (weight < 0.0) {
    if (all(curveP0 == curveP1) && all(curveP2 == curveP3)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_cubic(curveP0, curveP1, curveP2, curveP3, affine);
    }
  } else {
    if (all(curveP0 == curveP1) || all(curveP1 == curveP2)) {
      numParametricSegments = 1.0;
    } else {
      numParametricSegments = wangs_formula_conic(curveP0, curveP1, curveP2, weight, affine);
    }
  }
  let isHairline = strokeRadius == 0.0;
  let numRadialSegmentsPerRadian = num_radial_segments_per_radian(
    select(maxScale * strokeRadius, 0.5, isHairline),
  );
  if (isHairline) {
    strokeRadius = 0.5;
    curveP0 = affine * curveP0;
    curveP1 = affine * curveP1;
    curveP2 = affine * curveP2;
    curveP3 = affine * curveP3;
    lastControlPoint = affine * lastControlPoint;
  }
  var prevTan = robust_normalize_diff(curveP0, lastControlPoint);
  var tan0 = robust_normalize_diff(select(select(curveP2, curveP3, all(curveP1 == curveP2)), curveP1, !all(curveP0 == curveP1)), curveP0);
  var tan1 = robust_normalize_diff(curveP3, select(select(curveP1, curveP0, all(curveP2 == curveP1)), curveP2, !all(curveP3 == curveP2)));
  if (length(tan0) <= 1e-5) {
    joinType = 0.0;
    if (weight < 0.0) {
      tan0 = vec2<f32>(1.0, 0.0);
      tan1 = vec2<f32>(-1.0, 0.0);
    } else {
      weight = -1.0;
      tan0 = prevTan;
      tan1 = prevTan;
      if (length(prevTan) <= 1e-5) {
        curveP2 = curveP0 + (strokeRadius * vec2<f32>(1.0, 0.0));
        curveP3 = curveP2;
        curveP0 = curveP0 - (strokeRadius * vec2<f32>(1.0, 0.0));
        curveP1 = curveP0;
        prevTan = vec2<f32>(1.0, 0.0);
        tan0 = prevTan;
        tan1 = prevTan;
      } else {
        curveP1 = curveP0;
        curveP2 = curveP0 + (strokeRadius * prevTan);
        curveP3 = curveP2;
      }
    }
  }
  let maxEdges = f32(SEGMENTS);
  var numEdgesInJoin = stroke_join_edges(joinType, prevTan, tan0, strokeRadius);
  if (joinType < 0.0) {
    numEdgesInJoin = min(numEdgesInJoin, maxEdges - 2.0);
  }
  var joinTan0 = tan0;
  var joinTan1 = tan1;
  var turn = cross_length_2d(curveP2 - curveP0, curveP3 - curveP1);
  var strokeOutset = sign(edgeID);
  var combinedEdgeID = abs(edgeID) - numEdgesInJoin;
  if (combinedEdgeID < 0.0) {
    joinTan1 = joinTan0;
    if (!all(lastControlPoint == curveP0)) {
      joinTan0 = prevTan;
    }
    turn = cross_length_2d(joinTan0, joinTan1);
  }
  let cosTheta = cosine_between_unit_vectors(joinTan0, joinTan1);
  var rotation = acos(cosTheta);
  if (turn < 0.0) {
    rotation = -rotation;
  }
  var numRadialSegments: f32;
  if (combinedEdgeID < 0.0) {
    numRadialSegments = numEdgesInJoin - 2.0;
    numParametricSegments = 1.0;
    curveP1 = curveP0;
    curveP2 = curveP0;
    curveP3 = curveP0;
    combinedEdgeID += numRadialSegments + 1.0;
    if (!tangents_nearly_parallel(turn, joinTan0, joinTan1) || dot(joinTan0, joinTan1) < 0.0) {
      if (combinedEdgeID >= 0.0) {
        strokeOutset = select(max(strokeOutset, 0.0), min(strokeOutset, 0.0), turn < 0.0);
      }
    }
    combinedEdgeID = max(combinedEdgeID, 0.0);
  } else {
    let maxCombinedSegments = maxEdges - numEdgesInJoin - 1.0;
    numRadialSegments = max(ceil(abs(rotation) * numRadialSegmentsPerRadian), 1.0);
    numRadialSegments = min(numRadialSegments, maxCombinedSegments);
    numParametricSegments = min(numParametricSegments, maxCombinedSegments - numRadialSegments + 1.0);
  }
  let radsPerSegment = rotation / numRadialSegments;
  let numCombinedSegments = numParametricSegments + numRadialSegments - 1.0;
  let isFinalEdge = combinedEdgeID >= numCombinedSegments;
  if (combinedEdgeID > numCombinedSegments) {
    strokeOutset = 0.0;
  }
  if (abs(edgeID) == 2.0 && joinType > 0.0) {
    strokeOutset *= miter_extent(cosTheta, joinType);
  }
  var strokeCoord: vec2<f32>;
  var curveTangent: vec2<f32>;
  if (combinedEdgeID != 0.0 && !isFinalEdge) {
    var coeffA: vec2<f32>;
    var coeffB: vec2<f32>;
    var coeffC = curveP1 - curveP0;
    let deltaP = curveP3 - curveP0;
    if (curveType < 2.5) {
      if (curveType < 1.5) {
        if (curveType < 0.5) {
          let edgeP = curveP2 - curveP1;
          coeffB = edgeP - coeffC;
          coeffA = (-3.0 * edgeP) + deltaP;
        } else {
          coeffA = vec2<f32>(0.0, 0.0);
          coeffB = (0.5 * deltaP) - coeffC;
        }
      } else {
        coeffC *= weight;
        coeffB = (0.5 * deltaP) - coeffC;
        coeffA = (weight - 1.0) * deltaP;
        curveP1 *= weight;
      }
    } else {
      let edgeP = curveP2 - curveP1;
      coeffB = edgeP - coeffC;
      coeffA = (-3.0 * edgeP) + deltaP;
    }
    let coeffBScaled = coeffB * (numParametricSegments * 2.0);
    let coeffCScaled = coeffC * (numParametricSegments * numParametricSegments);
    var lastParametricEdgeID = 0.0;
    let maxParametricEdgeID = min(numParametricSegments - 1.0, combinedEdgeID);
    let negAbsRadsPerSegment = -abs(radsPerSegment);
    let maxRotation0 = (1.0 + combinedEdgeID) * abs(radsPerSegment);
    for (var exp = ${maxPatchResolveLevel - 1}; exp >= 0; exp--) {
      let testParametricID = lastParametricEdgeID + exp2(f32(exp));
      if (testParametricID <= maxParametricEdgeID) {
        var testTan = fma(vec2<f32>(testParametricID), coeffA, coeffBScaled);
        testTan = fma(vec2<f32>(testParametricID), testTan, coeffCScaled);
        let cosRotationAtTest = dot(normalize(testTan), joinTan0);
        let maxRotation = min(fma(testParametricID, negAbsRadsPerSegment, maxRotation0), 3.14159265359);
        if (cosRotationAtTest >= cos(maxRotation)) {
          lastParametricEdgeID = testParametricID;
        }
      }
    }
    let parametricT = lastParametricEdgeID / numParametricSegments;
    let lastRadialEdgeID = combinedEdgeID - lastParametricEdgeID;
    let angle0Magnitude = acos(clamp(joinTan0.x, -1.0, 1.0));
    let angle0 = select(angle0Magnitude, -angle0Magnitude, joinTan0.y < 0.0);
    let radialAngle = fma(lastRadialEdgeID, radsPerSegment, angle0);
    let radialTangent = vec2<f32>(cos(radialAngle), sin(radialAngle));
    curveTangent = radialTangent;
    let radialNorm = vec2<f32>(-radialTangent.y, radialTangent.x);
    let quadraticA = dot(radialNorm, coeffA);
    let quadraticBOver2 = dot(radialNorm, coeffB);
    let quadraticC = dot(radialNorm, coeffC);
    let discrOver4 = max((quadraticBOver2 * quadraticBOver2) - (quadraticA * quadraticC), 0.0);
    var rootQ = sqrt(discrOver4);
    if (quadraticBOver2 > 0.0) {
      rootQ = -rootQ;
    }
    rootQ -= quadraticBOver2;
    let rootSentinel = -0.5 * rootQ * quadraticA;
    let useQaRoot = abs(fma(rootQ, rootQ, rootSentinel)) < abs(fma(quadraticA, quadraticC, rootSentinel));
    let rootNumer = select(quadraticC, rootQ, useQaRoot);
    let rootDenom = select(rootQ, quadraticA, useQaRoot);
    var radialT = 0.0;
    if (lastRadialEdgeID != 0.0) {
      radialT = select(0.0, clamp(rootNumer / rootDenom, 0.0, 1.0), rootDenom != 0.0);
    }
    if (lastRadialEdgeID == 0.0) {
      radialT = 0.0;
    }
    let finalT = max(parametricT, radialT);
    if (curveType < 2.5) {
      if (curveType < 1.5) {
        if (curveType < 0.5) {
          let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
          let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
          let cd = unchecked_mix_vec2(curveP2, curveP3, finalT);
          let abc = unchecked_mix_vec2(ab, bc, finalT);
          let bcd = unchecked_mix_vec2(bc, cd, finalT);
          strokeCoord = unchecked_mix_vec2(abc, bcd, finalT);
          if (finalT != radialT) {
            curveTangent = robust_normalize_diff(bcd, abc);
          }
        } else {
          let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
          let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
          strokeCoord = unchecked_mix_vec2(ab, bc, finalT);
          if (finalT != radialT) {
            curveTangent = robust_normalize_diff(bc, ab);
          }
        }
      } else {
        let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
        let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
        let abc = unchecked_mix_vec2(ab, bc, finalT);
        let u = unchecked_mix(1.0, weight, finalT);
        let v = weight + 1.0 - u;
        let uv = unchecked_mix(u, v, finalT);
        strokeCoord = abc / max(uv, 1e-5);
        if (finalT != radialT) {
          curveTangent = robust_normalize_diff(bc * u, ab * v);
        }
      }
    } else {
      let ab = unchecked_mix_vec2(curveP0, curveP1, finalT);
      let bc = unchecked_mix_vec2(curveP1, curveP2, finalT);
      let cd = unchecked_mix_vec2(curveP2, curveP3, finalT);
      let abc = unchecked_mix_vec2(ab, bc, finalT);
      let bcd = unchecked_mix_vec2(bc, cd, finalT);
      strokeCoord = unchecked_mix_vec2(abc, bcd, finalT);
      if (finalT != radialT) {
        curveTangent = robust_normalize_diff(bcd, abc);
      }
    }
  } else {
    curveTangent = select(joinTan0, joinTan1, isFinalEdge);
    strokeCoord = select(curveP0, curveP3, isFinalEdge);
  }
  let ortho = vec2<f32>(curveTangent.y, -curveTangent.x);
  let strokedCoord = strokeCoord + (ortho * strokeRadius * strokeOutset);
  let devicePosition = select(
    local_to_device(strokedCoord),
    strokedCoord + step.matrix1.xy,
    isHairline,
  );
  var out: VertexOut;
  out.position = device_to_ndc(devicePosition);
  out.devicePosition = devicePosition;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let clipCoverage = clip_coverage(in.devicePosition);
  var color = apply_clip_shader(paint_shader_color(in.devicePosition));
  color.a *= clipCoverage;
  return blend_with_dst(color, in.devicePosition);
}
`;

const createStencilFaceState = (
  passOp: GPUStencilOperation,
  compare: GPUCompareFunction = 'always',
  options: Readonly<{
    failOp?: GPUStencilOperation;
    depthFailOp?: GPUStencilOperation;
  }> = {},
): GPUStencilFaceState => ({
  compare,
  failOp: options.failOp ?? 'keep',
  depthFailOp: options.depthFailOp ?? 'keep',
  passOp,
});

const createFillStencilFaceState = (
  frontPassOp: GPUStencilOperation,
  backPassOp: GPUStencilOperation,
): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: false,
  depthCompare: 'less',
  stencilReadMask: 0xff,
  stencilWriteMask: 0xff,
  stencilFront: createStencilFaceState(frontPassOp),
  stencilBack: createStencilFaceState(backPassOp),
});

const createStencilCoverState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
  stencilReadMask: 0xff,
  stencilWriteMask: 0xff,
  // Graphite's stencil cover consumes the accumulated winding mask as it shades.
  stencilFront: createStencilFaceState('zero', 'not-equal', {
    depthFailOp: 'zero',
  }),
  stencilBack: createStencilFaceState('zero', 'not-equal', {
    depthFailOp: 'zero',
  }),
});

const createDirectDepthLessState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
});

const createDirectState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: false,
  depthCompare: 'always',
  stencilReadMask: 0x00,
  stencilWriteMask: 0x00,
});

const createClipCoverDepthLessState = (): GPUDepthStencilState => ({
  format: stencilFormat,
  depthWriteEnabled: true,
  depthCompare: 'less',
  stencilReadMask: 0xff,
  stencilWriteMask: 0x00,
  stencilFront: createStencilFaceState('keep', 'equal'),
  stencilBack: createStencilFaceState('keep', 'equal'),
});

const createPathShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-path-shader',
    code: fillPathShaderSource,
  });

const createWedgePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-wedge-patch-shader',
    code: wedgePatchShaderSource,
  });

const createCurvePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-curve-patch-shader',
    code: curvePatchShaderSource,
  });

const createStrokePatchShaderModule = (backend: DawnBackendContext): GPUShaderModule =>
  backend.device.createShaderModule({
    label: 'drawing-stroke-patch-shader',
    code: strokePatchShaderSource,
  });

const canonicalizeSamplerDescriptor = (
  descriptor: DrawingSamplerDescriptor = {},
): Required<DrawingSamplerDescriptor> => ({
  label: descriptor.label ?? '',
  magFilter: descriptor.magFilter ?? 'nearest',
  minFilter: descriptor.minFilter ?? 'nearest',
  mipmapFilter: descriptor.mipmapFilter ?? 'nearest',
  addressModeU: descriptor.addressModeU ?? 'clamp-to-edge',
  addressModeV: descriptor.addressModeV ?? 'clamp-to-edge',
  addressModeW: descriptor.addressModeW ?? 'clamp-to-edge',
});

const createSamplerCacheKey = (
  descriptor: Required<DrawingSamplerDescriptor>,
): string =>
  [
    descriptor.magFilter,
    descriptor.minFilter,
    descriptor.mipmapFilter,
    descriptor.addressModeU,
    descriptor.addressModeV,
    descriptor.addressModeW,
  ].join('|');

export const createDawnResourceProvider = (
  backend: DawnBackendContext,
  options: Readonly<{
    caps?: DawnCaps;
    resourceBudget?: number;
  }> = {},
): DawnResourceProvider => {
  const caps = options.caps;
  let viewportBindGroupLayout: GPUBindGroupLayout | null = null;
  let stepBindGroupLayout: GPUBindGroupLayout | null = null;
  let gradientBindGroupLayout: GPUBindGroupLayout | null = null;
  let clipTextureBindGroupLayout: GPUBindGroupLayout | null = null;
  let drawingPipelineLayout: GPUPipelineLayout | null = null;
  let stencilAttachment:
    | Readonly<{
      width: number;
      height: number;
      sampleCount: number;
      texture: GPUTexture;
      view: GPUTextureView;
    }>
    | null = null;
  const samplerCache = new Map<string, GPUSampler>();
  const shaderModuleCache = new Map<string, GPUShaderModule>();
  const graphicsPipelineCache = new Map<string, GPURenderPipeline>();
  let defaultClipTextureView: GPUTextureView | null = null;
  let defaultDstTextureView: GPUTextureView | null = null;

  const createVertexLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * floatsPerVertex,
    attributes: [
      {
        shaderLocation: 0,
        offset: 0,
        format: 'float32x2',
      },
      {
        shaderLocation: 1,
        offset: floatBytes * 2,
        format: 'float32x4',
      },
    ],
  });

  const createPatchResolveVertexLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 2,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
    ],
  });

  const createWedgePatchInstanceLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 14,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 1, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 5, offset: floatBytes * 8, format: 'float32x4' },
      { shaderLocation: 6, offset: floatBytes * 12, format: 'float32x2' },
    ],
  });

  const createCurvePatchInstanceLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 12,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 1, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 5, offset: floatBytes * 8, format: 'float32x4' },
    ],
  });

  const createStrokePatchLayout = (): GPUVertexBufferLayout => ({
    arrayStride: floatBytes * 14,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: floatBytes * 0, format: 'float32x2' },
      { shaderLocation: 1, offset: floatBytes * 2, format: 'float32x2' },
      { shaderLocation: 2, offset: floatBytes * 4, format: 'float32x2' },
      { shaderLocation: 3, offset: floatBytes * 6, format: 'float32x2' },
      { shaderLocation: 4, offset: floatBytes * 8, format: 'float32x2' },
      { shaderLocation: 5, offset: floatBytes * 10, format: 'float32x2' },
      { shaderLocation: 6, offset: floatBytes * 12, format: 'float32x2' },
    ],
  });

  const sampleCount = caps?.supportsSampleCount(
      backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1,
      backend.target.format,
    )
    ? backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1
    : caps?.defaultSampleCount ?? 1;

  const getViewportBindGroupLayout = (): GPUBindGroupLayout => {
    if (viewportBindGroupLayout) {
      return viewportBindGroupLayout;
    }

    viewportBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-viewport-bind-group-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: 'uniform',
        },
      }],
    });
    return viewportBindGroupLayout;
  };

  const getStepBindGroupLayout = (): GPUBindGroupLayout => {
    if (stepBindGroupLayout) {
      return stepBindGroupLayout;
    }

    stepBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-step-bind-group-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'uniform',
        },
      }],
    });
    return stepBindGroupLayout;
  };

  const getGradientBindGroupLayout = (): GPUBindGroupLayout => {
    if (gradientBindGroupLayout) {
      return gradientBindGroupLayout;
    }

    gradientBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-gradient-bind-group-layout',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: 'read-only-storage',
        },
      }],
    });
    return gradientBindGroupLayout;
  };

  const getClipTextureBindGroupLayout = (): GPUBindGroupLayout => {
    if (clipTextureBindGroupLayout) {
      return clipTextureBindGroupLayout;
    }

    clipTextureBindGroupLayout = backend.device.createBindGroupLayout({
      label: 'drawing-clip-texture-bind-group-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: 'filtering',
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
            multisampled: false,
          },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {
            type: 'filtering',
          },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
            multisampled: false,
          },
        },
      ],
    });
    return clipTextureBindGroupLayout;
  };

  const getDefaultClipTextureView = (): GPUTextureView => {
    if (defaultClipTextureView) {
      return defaultClipTextureView;
    }

    const texture = backend.device.createTexture({
      label: 'drawing-default-clip-texture',
      size: {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: textureBindingUsage | renderAttachmentUsage | textureCopyDstUsage,
    });
    if (
      'writeTexture' in backend.queue &&
      typeof backend.queue.writeTexture === 'function'
    ) {
      const pixel = new Uint8Array([255, 255, 255, 255]);
      backend.queue.writeTexture(
        { texture },
        pixel,
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    }
    defaultClipTextureView = texture.createView();
    return defaultClipTextureView;
  };

  const getDefaultDstTextureView = (): GPUTextureView => {
    if (defaultDstTextureView) {
      return defaultDstTextureView;
    }

    const texture = backend.device.createTexture({
      label: 'drawing-default-dst-texture',
      size: {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
      },
      format: 'rgba8unorm',
      usage: textureBindingUsage | renderAttachmentUsage | textureCopyDstUsage,
    });
    if (
      'writeTexture' in backend.queue &&
      typeof backend.queue.writeTexture === 'function'
    ) {
      const pixel = new Uint8Array([0, 0, 0, 0]);
      backend.queue.writeTexture(
        { texture },
        pixel,
        { bytesPerRow: 4, rowsPerImage: 1 },
        { width: 1, height: 1, depthOrArrayLayers: 1 },
      );
    }
    defaultDstTextureView = texture.createView();
    return defaultDstTextureView;
  };

  const getDrawingPipelineLayout = (): GPUPipelineLayout => {
    if (drawingPipelineLayout) {
      return drawingPipelineLayout;
    }

    drawingPipelineLayout = backend.device.createPipelineLayout({
      label: 'drawing-pipeline-layout',
      bindGroupLayouts: [
        getViewportBindGroupLayout(),
        getStepBindGroupLayout(),
        getGradientBindGroupLayout(),
        getClipTextureBindGroupLayout(),
      ],
    });
    return drawingPipelineLayout;
  };
  const getOrCreateShaderModule = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPUShaderModule => {
    const cacheKey = descriptor.shader;
    const existing = shaderModuleCache.get(cacheKey);
    if (existing) {
      return existing;
    }

    const shaderModule = descriptor.shader === 'path'
      ? createPathShaderModule(backend)
      : descriptor.shader === 'wedge-patch'
      ? createWedgePatchShaderModule(backend)
      : descriptor.shader === 'curve-patch'
      ? createCurvePatchShaderModule(backend)
      : createStrokePatchShaderModule(backend);
    shaderModuleCache.set(cacheKey, shaderModule);
    return shaderModule;
  };

  const getVertexLayout = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): readonly GPUVertexBufferLayout[] =>
    descriptor.vertexLayout === 'device-vertex'
      ? [createVertexLayout()]
      : descriptor.vertexLayout === 'wedge-patch-instance'
      ? [createPatchResolveVertexLayout(), createWedgePatchInstanceLayout()]
      : descriptor.vertexLayout === 'curve-patch-instance'
      ? [createPatchResolveVertexLayout(), createCurvePatchInstanceLayout()]
      : [createStrokePatchLayout()];

  const getDepthStencil = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPUDepthStencilState | undefined =>
    descriptor.depthStencil === 'none'
      ? undefined
      : descriptor.depthStencil === 'direct'
      ? createDirectState()
      : descriptor.depthStencil === 'clip-stencil-write'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('replace'),
        stencilBack: createStencilFaceState('replace'),
      }
      : descriptor.depthStencil === 'clip-stencil-intersect'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('replace', 'equal'),
        stencilBack: createStencilFaceState('replace', 'equal'),
      }
      : descriptor.depthStencil === 'clip-stencil-difference'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0xff,
        stencilFront: createStencilFaceState('zero', 'equal'),
        stencilBack: createStencilFaceState('zero', 'equal'),
      }
      : descriptor.depthStencil === 'clip-cover'
      ? {
        format: stencilFormat,
        depthWriteEnabled: false,
        depthCompare: 'always',
        stencilReadMask: 0xff,
        stencilWriteMask: 0x00,
        stencilFront: createStencilFaceState('keep', 'equal'),
        stencilBack: createStencilFaceState('keep', 'equal'),
      }
      : descriptor.depthStencil === 'clip-cover-depth-less'
      ? createClipCoverDepthLessState()
      : descriptor.depthStencil === 'direct-depth-less'
      ? createDirectDepthLessState()
      : descriptor.depthStencil === 'fill-stencil-evenodd'
      ? createFillStencilFaceState('invert', 'invert')
      : descriptor.depthStencil === 'fill-stencil-nonzero'
      ? createFillStencilFaceState('increment-wrap', 'decrement-wrap')
      : createStencilCoverState();

  const createGraphicsPipelineCacheKey = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): string =>
    [
      descriptor.label,
      descriptor.shader,
      descriptor.vertexLayout,
      descriptor.blendMode,
      descriptor.depthStencil,
      descriptor.topology,
      descriptor.colorWriteDisabled ? '1' : '0',
      backend.target.format,
      sampleCount,
    ].join('|');

  const createGraphicsPipelineDescriptor = (
    descriptor: DrawingGraphicsPipelineDesc,
  ): GPURenderPipelineDescriptor => ({
    label: descriptor.label,
    layout: getDrawingPipelineLayout(),
    vertex: {
      module: getOrCreateShaderModule(descriptor),
      entryPoint: 'vs_main',
      buffers: [...getVertexLayout(descriptor)],
    },
    fragment: {
      module: getOrCreateShaderModule(descriptor),
      entryPoint: 'fs_main',
      targets: [{
        format: backend.target.format,
        blend: descriptor.colorWriteDisabled ? undefined : getBlendState(descriptor.blendMode),
        writeMask: descriptor.colorWriteDisabled ? noColorWrites : undefined,
      }],
    },
    primitive: {
      topology: descriptor.topology,
      cullMode: 'none',
      frontFace: 'ccw',
    },
    multisample: {
      count: sampleCount,
    },
    depthStencil: getDepthStencil(descriptor),
  });

  const provider: DawnResourceProvider = {
    backend,
    resourceBudget: options.resourceBudget ?? Number.POSITIVE_INFINITY,
    createBuffer: (descriptor) => backend.device.createBuffer(descriptor),
    createTexture: (descriptor) => {
      const normalizedSampleCount = descriptor.sampleCount &&
          caps?.supportsSampleCount(descriptor.sampleCount, descriptor.format) === false
        ? 1
        : descriptor.sampleCount;
      const supportedUsage = caps?.getSupportedTextureUsages(descriptor.format);
      const needsTextureBinding = (descriptor.usage & textureBindingUsage) !== 0;
      const needsRenderAttachment = (descriptor.usage & renderAttachmentUsage) !== 0;
      if (supportedUsage) {
        if (needsTextureBinding && !supportedUsage.has('sample')) {
          throw new Error(`Format ${descriptor.format} does not support texture binding`);
        }
        if (needsRenderAttachment && !supportedUsage.has('render')) {
          throw new Error(`Format ${descriptor.format} does not support render attachment usage`);
        }
      }
      return backend.device.createTexture({
        ...descriptor,
        sampleCount: normalizedSampleCount,
      });
    },
    createViewportBindGroup: (buffer) =>
      backend.device.createBindGroup({
        label: 'drawing-viewport-bind-group',
        layout: getViewportBindGroupLayout(),
        entries: [{
          binding: 0,
          resource: {
            buffer,
          },
        }],
      }),
    createStepBindGroup: (buffer) =>
      backend.device.createBindGroup({
        label: 'drawing-step-bind-group',
        layout: getStepBindGroupLayout(),
        entries: [{
          binding: 0,
          resource: {
            buffer,
          },
        }],
      }),
    createGradientBindGroup: (buffer) =>
      backend.device.createBindGroup({
        label: 'drawing-gradient-bind-group',
        layout: getGradientBindGroupLayout(),
        entries: [{
          binding: 0,
          resource: {
            buffer,
          },
        }],
      }),
    createClipTextureBindGroup: (clipTextureView, dstTextureView) =>
      backend.device.createBindGroup({
        label: 'drawing-clip-texture-bind-group',
        layout: getClipTextureBindGroupLayout(),
        entries: [
          {
            binding: 0,
            resource: provider.createSampler({
              label: 'drawing-clip-texture-sampler',
              magFilter: 'linear',
              minFilter: 'linear',
            }),
          },
          {
            binding: 1,
            resource: clipTextureView ?? getDefaultClipTextureView(),
          },
          {
            binding: 2,
            resource: provider.createSampler({
              label: 'drawing-dst-texture-sampler',
              magFilter: 'nearest',
              minFilter: 'nearest',
            }),
          },
          {
            binding: 3,
            resource: dstTextureView ?? getDefaultDstTextureView(),
          },
        ],
      }),
    createGraphicsPipelineHandle: (descriptor) => ({
      key: createGraphicsPipelineCacheKey(descriptor),
      descriptor,
    }),
    resolveGraphicsPipelineHandle: (handle) => {
      const existing = graphicsPipelineCache.get(handle.key);
      if (existing) {
        return existing;
      }

      const pipeline = backend.device.createRenderPipeline(
        createGraphicsPipelineDescriptor(handle.descriptor),
      );
      graphicsPipelineCache.set(handle.key, pipeline);
      return pipeline;
    },
    createSampler: (descriptor = {}) => {
      const normalized = canonicalizeSamplerDescriptor(descriptor);
      const key = createSamplerCacheKey(normalized);
      const existing = samplerCache.get(key);
      if (existing) {
        return existing;
      }

      const sampler = backend.device.createSampler({
        ...normalized,
        label: descriptor.label,
      });
      samplerCache.set(key, sampler);
      return sampler;
    },
    findOrCreateGraphicsPipeline: (descriptor) => {
      return provider.resolveGraphicsPipelineHandle(
        provider.createGraphicsPipelineHandle(descriptor),
      );
    },
    getStencilAttachmentView: () => {
      const sampleCount = caps?.supportsSampleCount(
          backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1,
          stencilFormat,
        )
        ? backend.target.kind === 'offscreen' ? backend.target.sampleCount : 1
        : 1;
      if (
        stencilAttachment &&
        stencilAttachment.width === backend.target.width &&
        stencilAttachment.height === backend.target.height &&
        stencilAttachment.sampleCount === sampleCount
      ) {
        return stencilAttachment.view;
      }

      const texture = backend.device.createTexture({
        label: 'drawing-stencil',
        size: {
          width: backend.target.width,
          height: backend.target.height,
          depthOrArrayLayers: 1,
        },
        format: stencilFormat,
        sampleCount,
        usage: renderAttachmentUsage,
      });
      const view = texture.createView();
      stencilAttachment = {
        width: backend.target.width,
        height: backend.target.height,
        sampleCount,
        texture,
        view,
      };
      return view;
    },
  };

  return provider;
};
