use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use tiny_skia::{
    FillRule, LineCap, LineJoin, Mask, Path, PathBuilder, PathStroker, Stroke, StrokeDash,
    Transform,
};

use crate::drawing::PathDrawCommand;
use crate::render::{PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D};

const ENTRY_PADDING: u32 = 1;
const DEFAULT_ATLAS_DIM: u32 = 2048;
const MAX_ATLAS_PAGES: usize = 4;
const CURVE_CONIC_STEPS: usize = 24;
const ARC_STEP_RADIANS: f32 = std::f32::consts::PI / 16.0;
const EPSILON: f32 = 1e-5;
const HAIRLINE_COVERAGE_WIDTH: f32 = 1.0;
const DEFAULT_MITER_LIMIT: f32 = 4.0;

#[derive(Clone, Debug)]
pub struct CoverageMask {
    pub page_index: usize,
    pub texture_origin: [u32; 2],
    pub atlas_size: [u32; 2],
    pub mask_origin: [f32; 2],
    pub mask_size: [u32; 2],
}

pub struct AtlasProvider {
    raster_path_atlas: RasterPathAtlas,
}

impl AtlasProvider {
    pub fn new(device: &wgpu::Device) -> Self {
        Self {
            raster_path_atlas: RasterPathAtlas::new(
                device,
                DEFAULT_ATLAS_DIM,
                DEFAULT_ATLAS_DIM,
                MAX_ATLAS_PAGES,
            ),
        }
    }

    pub fn begin_frame(&mut self) {
        self.raster_path_atlas.begin_frame();
    }

    pub fn add_path(
        &mut self,
        path: &PathDrawCommand,
        surface_width: u32,
        surface_height: u32,
    ) -> Option<CoverageMask> {
        self.raster_path_atlas
            .add_path(path, surface_width, surface_height)
    }

    pub fn upload_pending(&mut self, queue: &wgpu::Queue) {
        self.raster_path_atlas.upload_pending(queue);
    }

    pub fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        self.raster_path_atlas.page_view(page_index)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct PathMaskKey(u64);

#[derive(Clone, Copy, Debug)]
struct CacheEntry {
    page_index: usize,
    texture_origin: [u32; 2],
    mask_size: [u32; 2],
}

#[derive(Clone, Copy, Debug)]
struct DeviceMaskBounds {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

struct PreparedMaskShape {
    key: PathMaskKey,
    coverage_path: Path,
    fill_rule: FillRule,
    local_to_device: Transform,
    mask_bounds: DeviceMaskBounds,
}

struct RasterPathAtlas {
    device: wgpu::Device,
    width: u32,
    height: u32,
    max_pages: usize,
    pages: Vec<AtlasPage>,
    cache: HashMap<PathMaskKey, CacheEntry>,
    next_evict_page: usize,
}

struct AtlasPage {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    pixels: Vec<u8>,
    width: u32,
    height: u32,
    cursor_x: u32,
    cursor_y: u32,
    row_height: u32,
    dirty: bool,
    in_use_this_frame: bool,
    keys: Vec<PathMaskKey>,
}

impl RasterPathAtlas {
    fn new(device: &wgpu::Device, width: u32, height: u32, max_pages: usize) -> Self {
        Self {
            device: device.clone(),
            width,
            height,
            max_pages,
            pages: vec![AtlasPage::new(device, width, height, 0)],
            cache: HashMap::new(),
            next_evict_page: 0,
        }
    }

    fn begin_frame(&mut self) {
        for page in &mut self.pages {
            page.in_use_this_frame = false;
        }
    }

    fn add_path(
        &mut self,
        path: &PathDrawCommand,
        surface_width: u32,
        surface_height: u32,
    ) -> Option<CoverageMask> {
        let prepared = PreparedMaskShape::from_path(path, surface_width, surface_height)?;
        if !self.fits_in_atlas(prepared.mask_bounds.width, prepared.mask_bounds.height) {
            return None;
        }

        if let Some(&entry) = self.cache.get(&prepared.key) {
            let page = self.pages.get_mut(entry.page_index)?;
            page.in_use_this_frame = true;
            return Some(self.coverage_mask_for_entry(entry, &prepared.mask_bounds));
        }

        let mask = prepared.rasterize()?;
        let (page_index, texture_origin) = self.allocate_entry(
            prepared.key,
            prepared.mask_bounds.width,
            prepared.mask_bounds.height,
        )?;
        let page = self.pages.get_mut(page_index)?;
        page.blit_mask(texture_origin, &mask);
        page.in_use_this_frame = true;
        page.keys.push(prepared.key);

        let entry = CacheEntry {
            page_index,
            texture_origin,
            mask_size: [prepared.mask_bounds.width, prepared.mask_bounds.height],
        };
        self.cache.insert(prepared.key, entry);
        Some(self.coverage_mask_for_entry(entry, &prepared.mask_bounds))
    }

    fn upload_pending(&mut self, queue: &wgpu::Queue) {
        for page in &mut self.pages {
            page.upload_if_dirty(queue);
        }
    }

    fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        &self.pages[page_index].view
    }

    fn fits_in_atlas(&self, width: u32, height: u32) -> bool {
        width.saturating_add(ENTRY_PADDING * 2) <= self.width
            && height.saturating_add(ENTRY_PADDING * 2) <= self.height
    }

    fn coverage_mask_for_entry(
        &self,
        entry: CacheEntry,
        mask_bounds: &DeviceMaskBounds,
    ) -> CoverageMask {
        CoverageMask {
            page_index: entry.page_index,
            texture_origin: entry.texture_origin,
            atlas_size: [self.width, self.height],
            mask_origin: [mask_bounds.left as f32, mask_bounds.top as f32],
            mask_size: entry.mask_size,
        }
    }

    fn allocate_entry(
        &mut self,
        _key: PathMaskKey,
        width: u32,
        height: u32,
    ) -> Option<(usize, [u32; 2])> {
        let padded_width = width.checked_add(ENTRY_PADDING * 2)?;
        let padded_height = height.checked_add(ENTRY_PADDING * 2)?;

        for page_index in 0..self.pages.len() {
            if let Some(texture_origin) =
                self.pages[page_index].allocate(padded_width, padded_height)
            {
                return Some((page_index, texture_origin));
            }
        }

        if self.pages.len() < self.max_pages {
            let page_index = self.pages.len();
            self.pages.push(AtlasPage::new(
                &self.device,
                self.width,
                self.height,
                page_index,
            ));
            let texture_origin = self.pages[page_index].allocate(padded_width, padded_height)?;
            return Some((page_index, texture_origin));
        }

        let reset_page_index = (0..self.pages.len())
            .map(|offset| (self.next_evict_page + offset) % self.pages.len())
            .find(|&index| !self.pages[index].in_use_this_frame)?;
        let page_index = reset_page_index;
        self.next_evict_page = (page_index + 1) % self.pages.len();

        let keys = std::mem::take(&mut self.pages[page_index].keys);
        for page_key in keys {
            self.cache.remove(&page_key);
        }
        self.pages[page_index].reset();
        let texture_origin = self.pages[page_index].allocate(padded_width, padded_height)?;
        Some((page_index, texture_origin))
    }
}

impl AtlasPage {
    fn new(device: &wgpu::Device, width: u32, height: u32, page_index: usize) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("goldlight path atlas page {page_index}")),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            texture,
            view,
            pixels: vec![0; (width * height) as usize],
            width,
            height,
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            dirty: false,
            in_use_this_frame: false,
            keys: Vec::new(),
        }
    }

    fn allocate(&mut self, padded_width: u32, padded_height: u32) -> Option<[u32; 2]> {
        if padded_width > self.width || padded_height > self.height {
            return None;
        }

        if self.cursor_x.saturating_add(padded_width) > self.width {
            self.cursor_x = 0;
            self.cursor_y = self.cursor_y.checked_add(self.row_height)?;
            self.row_height = 0;
        }
        if self.cursor_y.saturating_add(padded_height) > self.height {
            return None;
        }

        let texture_origin = [
            self.cursor_x.checked_add(ENTRY_PADDING)?,
            self.cursor_y.checked_add(ENTRY_PADDING)?,
        ];
        self.cursor_x = self.cursor_x.checked_add(padded_width)?;
        self.row_height = self.row_height.max(padded_height);
        Some(texture_origin)
    }

    fn reset(&mut self) {
        self.pixels.fill(0);
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.row_height = 0;
        self.dirty = true;
        self.in_use_this_frame = false;
    }

    fn blit_mask(&mut self, texture_origin: [u32; 2], mask: &Mask) {
        let width = mask.width();
        let height = mask.height();
        let src = mask.data();
        for row in 0..height {
            let src_offset = (row * width) as usize;
            let dst_offset = ((texture_origin[1] + row) * self.width + texture_origin[0]) as usize;
            self.pixels[dst_offset..dst_offset + width as usize]
                .copy_from_slice(&src[src_offset..src_offset + width as usize]);
        }
        self.dirty = true;
    }

    fn upload_if_dirty(&mut self, queue: &wgpu::Queue) {
        if !self.dirty {
            return;
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &self.pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.width),
                rows_per_image: Some(self.height),
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );
        self.dirty = false;
    }
}

impl PreparedMaskShape {
    fn from_path(path: &PathDrawCommand, surface_width: u32, surface_height: u32) -> Option<Self> {
        if matches!(path.style, PathStyle2D::Stroke) && path.stroke_width < HAIRLINE_COVERAGE_WIDTH
        {
            return None;
        }

        let local_path = build_local_path(path)?;
        let local_to_device = local_to_device_transform(path);
        let (coverage_path, fill_rule) = match path.style {
            PathStyle2D::Fill => (local_path, fill_rule(path.fill_rule)),
            PathStyle2D::Stroke => {
                let stroke = stroke_style(path);
                let resolution_scale = PathStroker::compute_resolution_scale(&local_to_device);
                let stroked = local_path.stroke(&stroke, resolution_scale)?;
                (stroked, FillRule::Winding)
            }
        };

        let transformed_bounds = coverage_path.bounds().transform(local_to_device)?;
        let mask_bounds = intersect_mask_bounds(
            transformed_bounds,
            surface_width.max(1),
            surface_height.max(1),
        )?;
        let clipped_mask_origin = [
            mask_bounds.left as f32 - transformed_bounds.left(),
            mask_bounds.top as f32 - transformed_bounds.top(),
        ];

        Some(Self {
            key: build_path_mask_key(
                path,
                &local_to_device,
                clipped_mask_origin,
                [mask_bounds.width, mask_bounds.height],
            ),
            coverage_path,
            fill_rule,
            local_to_device,
            mask_bounds,
        })
    }

    fn rasterize(&self) -> Option<Mask> {
        let mut mask = Mask::new(self.mask_bounds.width, self.mask_bounds.height)?;
        let transform = self.local_to_device.post_translate(
            -(self.mask_bounds.left as f32),
            -(self.mask_bounds.top as f32),
        );
        mask.fill_path(&self.coverage_path, self.fill_rule, true, transform);
        Some(mask)
    }
}

fn build_local_path(path: &PathDrawCommand) -> Option<Path> {
    let mut builder = PathBuilder::new();
    let mut current = [0.0, 0.0];
    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                builder.move_to(to[0], to[1]);
                current = to;
            }
            PathVerb2D::LineTo { to } => {
                builder.line_to(to[0], to[1]);
                current = to;
            }
            PathVerb2D::QuadTo { control, to } => {
                builder.quad_to(control[0], control[1], to[0], to[1]);
                current = to;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                append_flattened_conic(&mut builder, current, control, to, weight);
                current = to;
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                builder.cubic_to(
                    control1[0],
                    control1[1],
                    control2[0],
                    control2[1],
                    to[0],
                    to[1],
                );
                current = to;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                append_flattened_arc(
                    &mut builder,
                    center,
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                );
                current = arc_endpoint(center, radius, start_angle, end_angle, counter_clockwise);
            }
            PathVerb2D::Close => {
                builder.close();
            }
        }
    }
    builder.finish()
}

fn fill_rule(fill_rule: PathFillRule2D) -> FillRule {
    match fill_rule {
        PathFillRule2D::Nonzero => FillRule::Winding,
        PathFillRule2D::Evenodd => FillRule::EvenOdd,
    }
}

fn stroke_style(path: &PathDrawCommand) -> Stroke {
    Stroke {
        width: path.stroke_width.max(EPSILON),
        miter_limit: DEFAULT_MITER_LIMIT,
        line_cap: match path.stroke_cap {
            PathStrokeCap2D::Butt => LineCap::Butt,
            PathStrokeCap2D::Square => LineCap::Square,
            PathStrokeCap2D::Round => LineCap::Round,
        },
        line_join: match path.stroke_join {
            PathStrokeJoin2D::Miter => LineJoin::Miter,
            PathStrokeJoin2D::Bevel => LineJoin::Bevel,
            PathStrokeJoin2D::Round => LineJoin::Round,
        },
        dash: normalize_dash_array(&path.dash_array)
            .and_then(|dash_array| StrokeDash::new(dash_array, path.dash_offset)),
    }
}

fn local_to_device_transform(path: &PathDrawCommand) -> Transform {
    Transform::from_row(
        path.transform[0],
        path.transform[1],
        path.transform[2],
        path.transform[3],
        path.transform[4],
        path.transform[5],
    )
    .pre_translate(path.x, path.y)
}

fn intersect_mask_bounds(
    bounds: tiny_skia::Rect,
    surface_width: u32,
    surface_height: u32,
) -> Option<DeviceMaskBounds> {
    let left = bounds.left().floor().max(0.0) as i32;
    let top = bounds.top().floor().max(0.0) as i32;
    let right = bounds.right().ceil().min(surface_width as f32) as i32;
    let bottom = bounds.bottom().ceil().min(surface_height as f32) as i32;
    if right <= left || bottom <= top {
        return None;
    }
    Some(DeviceMaskBounds {
        left,
        top,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

fn normalize_dash_array(dash_array: &[f32]) -> Option<Vec<f32>> {
    let filtered = dash_array
        .iter()
        .copied()
        .filter(|value| value.is_finite() && *value > EPSILON)
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        return None;
    }
    if filtered.len() % 2 == 1 {
        return Some(
            filtered
                .iter()
                .copied()
                .chain(filtered.iter().copied())
                .collect(),
        );
    }
    Some(filtered)
}

fn append_flattened_conic(
    builder: &mut PathBuilder,
    from: [f32; 2],
    control: [f32; 2],
    to: [f32; 2],
    weight: f32,
) {
    for step in 1..=CURVE_CONIC_STEPS {
        let t = step as f32 / CURVE_CONIC_STEPS as f32;
        let omt = 1.0 - t;
        let denom = omt * omt + 2.0 * weight * omt * t + t * t;
        if denom.abs() <= EPSILON {
            continue;
        }
        let x = ((omt * omt * from[0]) + (2.0 * weight * omt * t * control[0]) + (t * t * to[0]))
            / denom;
        let y = ((omt * omt * from[1]) + (2.0 * weight * omt * t * control[1]) + (t * t * to[1]))
            / denom;
        builder.line_to(x, y);
    }
}

fn append_flattened_arc(
    builder: &mut PathBuilder,
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) {
    let sweep = normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    let steps = ((sweep.abs() / ARC_STEP_RADIANS).ceil() as usize).max(1);
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let angle = start_angle + sweep * t;
        builder.line_to(
            center[0] + radius * angle.cos(),
            center[1] + radius * angle.sin(),
        );
    }
}

fn arc_endpoint(
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> [f32; 2] {
    let angle = start_angle + normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    [
        center[0] + radius * angle.cos(),
        center[1] + radius * angle.sin(),
    ]
}

fn normalized_arc_sweep(start_angle: f32, end_angle: f32, counter_clockwise: bool) -> f32 {
    let mut sweep = end_angle - start_angle;
    if counter_clockwise {
        while sweep <= 0.0 {
            sweep += std::f32::consts::PI * 2.0;
        }
    } else {
        while sweep >= 0.0 {
            sweep -= std::f32::consts::PI * 2.0;
        }
    }
    sweep
}

fn build_path_mask_key(
    path: &PathDrawCommand,
    local_to_device: &Transform,
    clipped_mask_origin: [f32; 2],
    mask_size: [u32; 2],
) -> PathMaskKey {
    let mut hasher = DefaultHasher::new();
    mask_size.hash(&mut hasher);
    hash_f32_bits(clipped_mask_origin[0], &mut hasher);
    hash_f32_bits(clipped_mask_origin[1], &mut hasher);
    hash_transform_key(local_to_device, &mut hasher);

    match path.style {
        PathStyle2D::Fill => {
            0u8.hash(&mut hasher);
            match path.fill_rule {
                PathFillRule2D::Nonzero => 0u8.hash(&mut hasher),
                PathFillRule2D::Evenodd => 1u8.hash(&mut hasher),
            }
        }
        PathStyle2D::Stroke => {
            1u8.hash(&mut hasher);
            hash_f32_bits(path.stroke_width, &mut hasher);
            match path.stroke_cap {
                PathStrokeCap2D::Butt => 0u8.hash(&mut hasher),
                PathStrokeCap2D::Square => 1u8.hash(&mut hasher),
                PathStrokeCap2D::Round => 2u8.hash(&mut hasher),
            }
            match path.stroke_join {
                PathStrokeJoin2D::Miter => 0u8.hash(&mut hasher),
                PathStrokeJoin2D::Bevel => 1u8.hash(&mut hasher),
                PathStrokeJoin2D::Round => 2u8.hash(&mut hasher),
            }
            if let Some(dash_array) = normalize_dash_array(&path.dash_array) {
                1u8.hash(&mut hasher);
                hash_f32_bits(path.dash_offset, &mut hasher);
                dash_array.len().hash(&mut hasher);
                for value in dash_array {
                    hash_f32_bits(value, &mut hasher);
                }
            } else {
                0u8.hash(&mut hasher);
            }
        }
    }

    hash_path_geometry(path, &mut hasher);
    PathMaskKey(hasher.finish())
}

fn hash_transform_key(transform: &Transform, hasher: &mut impl Hasher) {
    hash_f32_bits(transform.sx, hasher);
    hash_f32_bits(transform.sy, hasher);
    hash_f32_bits(transform.kx, hasher);
    hash_f32_bits(transform.ky, hasher);
    fractional_translation_bucket(transform.tx).hash(hasher);
    fractional_translation_bucket(transform.ty).hash(hasher);
}

fn fractional_translation_bucket(value: f32) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    let frac = value - value.floor();
    (frac.clamp(0.0, 255.0 / 256.0) * 256.0).floor() as u8
}

fn hash_path_geometry(path: &PathDrawCommand, hasher: &mut impl Hasher) {
    path.verbs.len().hash(hasher);
    for verb in &path.verbs {
        match verb {
            PathVerb2D::MoveTo { to } => {
                0u8.hash(hasher);
                hash_point(*to, hasher);
            }
            PathVerb2D::LineTo { to } => {
                1u8.hash(hasher);
                hash_point(*to, hasher);
            }
            PathVerb2D::QuadTo { control, to } => {
                2u8.hash(hasher);
                hash_point(*control, hasher);
                hash_point(*to, hasher);
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                3u8.hash(hasher);
                hash_point(*control, hasher);
                hash_point(*to, hasher);
                hash_f32_bits(*weight, hasher);
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                4u8.hash(hasher);
                hash_point(*control1, hasher);
                hash_point(*control2, hasher);
                hash_point(*to, hasher);
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                5u8.hash(hasher);
                hash_point(*center, hasher);
                hash_f32_bits(*radius, hasher);
                hash_f32_bits(*start_angle, hasher);
                hash_f32_bits(*end_angle, hasher);
                counter_clockwise.hash(hasher);
            }
            PathVerb2D::Close => {
                6u8.hash(hasher);
            }
        }
    }
}

fn hash_point(point: [f32; 2], hasher: &mut impl Hasher) {
    hash_f32_bits(point[0], hasher);
    hash_f32_bits(point[1], hasher);
}

fn hash_f32_bits(value: f32, hasher: &mut impl Hasher) {
    value.to_bits().hash(hasher);
}

#[cfg(test)]
mod tests {
    use super::{build_path_mask_key, local_to_device_transform};
    use crate::drawing::PathDrawCommand;
    use crate::render::{
        ColorValue, PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D,
    };

    fn fill_path(x: f32) -> PathDrawCommand {
        PathDrawCommand {
            x,
            y: 0.0,
            verbs: vec![
                PathVerb2D::MoveTo { to: [0.0, 0.0] },
                PathVerb2D::LineTo { to: [40.0, 0.0] },
                PathVerb2D::LineTo { to: [40.0, 40.0] },
                PathVerb2D::Close,
            ],
            fill_rule: PathFillRule2D::Nonzero,
            style: PathStyle2D::Fill,
            color: ColorValue::default(),
            shader: None,
            stroke_width: 1.0,
            stroke_join: PathStrokeJoin2D::Miter,
            stroke_cap: PathStrokeCap2D::Butt,
            dash_array: Vec::new(),
            dash_offset: 0.0,
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        }
    }

    #[test]
    fn integer_translation_reuses_mask_key() {
        let left = fill_path(0.0);
        let right = fill_path(10.0);

        let left_key = build_path_mask_key(
            &left,
            &local_to_device_transform(&left),
            [0.0, 0.0],
            [40, 40],
        );
        let right_key = build_path_mask_key(
            &right,
            &local_to_device_transform(&right),
            [0.0, 0.0],
            [40, 40],
        );

        assert_eq!(left_key, right_key);
    }

    #[test]
    fn fractional_translation_changes_mask_key() {
        let left = fill_path(0.0);
        let right = fill_path(0.25);

        let left_key = build_path_mask_key(
            &left,
            &local_to_device_transform(&left),
            [0.0, 0.0],
            [40, 40],
        );
        let right_key = build_path_mask_key(
            &right,
            &local_to_device_transform(&right),
            [0.0, 0.0],
            [40, 40],
        );

        assert_ne!(left_key, right_key);
    }
}
