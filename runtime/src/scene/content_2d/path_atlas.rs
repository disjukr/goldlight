use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::f32::consts::PI;
use std::hash::{Hash, Hasher};
use std::sync::mpsc::{self, Receiver, TryRecvError};

use peniko::{
    kurbo::{PathEl, Point as KurboPoint},
    Color, Fill,
};

use super::vello_compute::{
    stroke_from_parts, CoverageAaConfig, CoverageComputeRenderer, CoverageScene,
};
use super::PathDrawCommand;
use crate::scene::{PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, PathVerb2D};

const ENTRY_PADDING: u32 = 1;
const DEFAULT_ATLAS_DIM: u32 = 2048;
const GRAPHITE_PATH_PLOT_WIDTH: u32 = DEFAULT_ATLAS_DIM / 2;
const GRAPHITE_PATH_PLOT_HEIGHT: u32 = DEFAULT_ATLAS_DIM / 2;
const MAX_ATLAS_PAGES: usize = 4;
const ATLAS_TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const GRAPHITE_COMPUTE_ATLAS_BBOX_AREA_THRESHOLD: f32 = 1024.0 * 512.0;
const GRAPHITE_COMPUTE_COORDINATE_THRESHOLD: f32 = 1e10;
const EPSILON: f32 = 1e-5;
const HAIRLINE_COVERAGE_WIDTH: f32 = 1.0;
const DEFAULT_MITER_LIMIT: f32 = 4.0;
const RASTER_SUBPIXEL_ROWS: usize = 4;
const SKIA_AA_SHIFT: i32 = 2;
const SKIA_CURVE_MAX_SHIFT: i32 = 6;
const GRAPHITE_CONIC_TOLERANCE: f32 = 0.25;
const MAX_CONIC_TO_QUAD_POW2: u32 = 5;

type Point = [f32; 2];

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

    pub fn prepare_mask(
        &mut self,
        path: &PathDrawCommand,
        surface_width: u32,
        surface_height: u32,
    ) -> Option<CoverageMask> {
        self.raster_path_atlas
            .prepare_mask(path, surface_width, surface_height)
    }

    pub fn upload_pending(&mut self, queue: &wgpu::Queue) {
        self.raster_path_atlas.upload_pending(queue);
    }

    pub fn encode_pending(&mut self, encoder: &mut wgpu::CommandEncoder) {
        self.raster_path_atlas.encode_pending(encoder);
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
    plot_index: usize,
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

#[derive(Clone, Copy, Debug)]
struct FloatBounds {
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
}

#[derive(Clone, Debug)]
struct RasterContour {
    points: Vec<Point>,
}

struct PreparedMaskShape {
    key: PathMaskKey,
    contours: Vec<RasterContour>,
    fill_rule: PathFillRule2D,
    alpha: f32,
    mask_bounds: DeviceMaskBounds,
    transformed_bounds: FloatBounds,
}

struct RasterMask {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

struct RasterPathAtlas {
    device: wgpu::Device,
    width: u32,
    height: u32,
    plot_width: u32,
    plot_height: u32,
    plots_per_page: usize,
    max_pages: usize,
    pages: Vec<AtlasPage>,
    cache: HashMap<PathMaskKey, CacheEntry>,
    next_evict_plot: usize,
    compute_backend: ComputeBackendState,
}

struct AtlasPage {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    plots: Vec<AtlasPlot>,
    pending_scene: CoverageScene,
    pending_occupied_width: u32,
    pending_occupied_height: u32,
}

struct AtlasPlot {
    offset: [u32; 2],
    width: u32,
    pixels: Vec<u8>,
    allocator: SkylineRectanizer,
    dirty_rect: DirtyRect,
    in_use_this_frame: bool,
    keys: Vec<PathMaskKey>,
}

#[derive(Clone, Copy, Debug)]
struct DirtyRect {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

impl DirtyRect {
    fn empty() -> Self {
        Self {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        }
    }

    fn is_empty(&self) -> bool {
        self.left >= self.right || self.top >= self.bottom
    }

    fn join(&mut self, left: u32, top: u32, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        let right = left.saturating_add(width);
        let bottom = top.saturating_add(height);
        if self.is_empty() {
            *self = Self {
                left,
                top,
                right,
                bottom,
            };
            return;
        }
        self.left = self.left.min(left);
        self.top = self.top.min(top);
        self.right = self.right.max(right);
        self.bottom = self.bottom.max(bottom);
    }

    fn clear(&mut self) {
        *self = Self::empty();
    }
}

#[derive(Clone, Copy, Debug)]
struct SkylineSegment {
    x: u32,
    y: u32,
    width: u32,
}

struct SkylineRectanizer {
    width: u32,
    height: u32,
    skyline: Vec<SkylineSegment>,
}

impl SkylineRectanizer {
    fn new(width: u32, height: u32) -> Self {
        let mut rectanizer = Self {
            width,
            height,
            skyline: Vec::new(),
        };
        rectanizer.reset();
        rectanizer
    }

    fn reset(&mut self) {
        self.skyline.clear();
        self.skyline.push(SkylineSegment {
            x: 0,
            y: 0,
            width: self.width,
        });
    }

    fn add_rect(&mut self, width: u32, height: u32) -> Option<[u32; 2]> {
        if width > self.width || height > self.height {
            return None;
        }

        let mut best_width = self.width.saturating_add(1);
        let mut best_x = 0;
        let mut best_y = self.height.saturating_add(1);
        let mut best_index = None;

        for index in 0..self.skyline.len() {
            if let Some(y) = self.rectangle_fits(index, width, height) {
                let segment_width = self.skyline[index].width;
                if y < best_y || (y == best_y && segment_width < best_width) {
                    best_index = Some(index);
                    best_width = segment_width;
                    best_x = self.skyline[index].x;
                    best_y = y;
                }
            }
        }

        let best_index = best_index?;
        self.add_skyline_level(best_index, best_x, best_y, width, height);
        Some([best_x, best_y])
    }

    fn rectangle_fits(&self, skyline_index: usize, width: u32, height: u32) -> Option<u32> {
        let x = self.skyline[skyline_index].x;
        if x.saturating_add(width) > self.width {
            return None;
        }

        let mut width_left = width;
        let mut index = skyline_index;
        let mut y = self.skyline[skyline_index].y;
        while width_left > 0 {
            let segment = self.skyline.get(index)?;
            y = y.max(segment.y);
            if y.saturating_add(height) > self.height {
                return None;
            }
            width_left = width_left.saturating_sub(segment.width);
            index += 1;
        }

        Some(y)
    }

    fn add_skyline_level(&mut self, skyline_index: usize, x: u32, y: u32, width: u32, height: u32) {
        self.skyline.insert(
            skyline_index,
            SkylineSegment {
                x,
                y: y.saturating_add(height),
                width,
            },
        );

        let index = skyline_index + 1;
        while index < self.skyline.len() {
            let previous = self.skyline[index - 1];
            if self.skyline[index].x < previous.x.saturating_add(previous.width) {
                let shrink = previous
                    .x
                    .saturating_add(previous.width)
                    .saturating_sub(self.skyline[index].x);
                self.skyline[index].x = self.skyline[index].x.saturating_add(shrink);
                self.skyline[index].width = self.skyline[index].width.saturating_sub(shrink);
                if self.skyline[index].width == 0 {
                    self.skyline.remove(index);
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        let mut index = 0;
        while index + 1 < self.skyline.len() {
            if self.skyline[index].y == self.skyline[index + 1].y {
                let next_width = self.skyline[index + 1].width;
                self.skyline[index].width = self.skyline[index].width.saturating_add(next_width);
                self.skyline.remove(index + 1);
            } else {
                index += 1;
            }
        }
    }
}

#[derive(Clone, Debug)]
struct FlattenedSubpath {
    points: Vec<Point>,
    corners: Vec<bool>,
    closed: bool,
}

#[derive(Clone, Copy, Debug)]
struct StrokeSegmentRecord {
    start: Point,
    end: Point,
    direction: Point,
    normal: Point,
    left_start: Point,
    right_start: Point,
    left_end: Point,
    right_end: Point,
}

#[derive(Clone, Debug)]
struct StrokeContourRecord {
    points: Vec<Point>,
    corners: Vec<bool>,
    closed: bool,
    segments: Vec<StrokeSegmentRecord>,
    degenerate_point: Option<Point>,
}

#[derive(Clone, Copy, Debug)]
struct StrokeStyle {
    half_width: f32,
    join_limit: f32,
    cap: PathStrokeCap2D,
}

#[derive(Clone, Copy, Debug)]
struct CoverageStrokeParams {
    width: f32,
    alpha: f32,
}

enum ComputeBackendState {
    Initializing(Receiver<CoverageComputeRenderer>),
    Ready(CoverageComputeRenderer),
    Failed,
}

impl RasterPathAtlas {
    fn new(device: &wgpu::Device, width: u32, height: u32, max_pages: usize) -> Self {
        let (sender, receiver) = mpsc::channel();
        let compute_device = device.clone();
        std::thread::spawn(move || {
            let renderer = CoverageComputeRenderer::new(&compute_device, CoverageAaConfig::Msaa8);
            let _ = sender.send(renderer);
        });
        let plots_per_page =
            ((width / GRAPHITE_PATH_PLOT_WIDTH) * (height / GRAPHITE_PATH_PLOT_HEIGHT)) as usize;
        Self {
            device: device.clone(),
            width,
            height,
            plot_width: GRAPHITE_PATH_PLOT_WIDTH,
            plot_height: GRAPHITE_PATH_PLOT_HEIGHT,
            plots_per_page,
            max_pages,
            pages: vec![AtlasPage::new(
                device,
                width,
                height,
                GRAPHITE_PATH_PLOT_WIDTH,
                GRAPHITE_PATH_PLOT_HEIGHT,
                0,
            )],
            cache: HashMap::new(),
            next_evict_plot: 0,
            compute_backend: ComputeBackendState::Initializing(receiver),
        }
    }

    fn begin_frame(&mut self) {
        for page in &mut self.pages {
            for plot in &mut page.plots {
                plot.in_use_this_frame = false;
            }
            page.pending_scene.reset();
            page.pending_occupied_width = 0;
            page.pending_occupied_height = 0;
        }
    }

    fn prepare_mask(
        &mut self,
        path: &PathDrawCommand,
        surface_width: u32,
        surface_height: u32,
    ) -> Option<CoverageMask> {
        if !self.compute_backend_ready() {
            return None;
        }

        let prepared = PreparedMaskShape::from_path(path, surface_width, surface_height)?;
        if !self.fits_in_atlas(prepared.mask_bounds.width, prepared.mask_bounds.height) {
            return None;
        }

        let clipped_width = prepared.mask_bounds.width as f32;
        let clipped_height = prepared.mask_bounds.height as f32;
        if clipped_width * clipped_height > GRAPHITE_COMPUTE_ATLAS_BBOX_AREA_THRESHOLD {
            return None;
        }

        let unclipped_width = prepared.transformed_bounds.right - prepared.transformed_bounds.left;
        let unclipped_height = prepared.transformed_bounds.bottom - prepared.transformed_bounds.top;
        if unclipped_width.abs() > GRAPHITE_COMPUTE_COORDINATE_THRESHOLD
            || unclipped_height.abs() > GRAPHITE_COMPUTE_COORDINATE_THRESHOLD
        {
            return None;
        }

        self.add_prepared_path(path, prepared)
    }

    fn add_prepared_path(
        &mut self,
        path: &PathDrawCommand,
        prepared: PreparedMaskShape,
    ) -> Option<CoverageMask> {
        if let Some(&entry) = self.cache.get(&prepared.key) {
            let plot = self
                .pages
                .get_mut(entry.page_index)?
                .plots
                .get_mut(entry.plot_index)?;
            plot.in_use_this_frame = true;
            return Some(self.coverage_mask_for_entry(entry, &prepared.mask_bounds));
        }

        let (page_index, plot_index, outer_origin) = self.allocate_entry(
            prepared.key,
            prepared.mask_bounds.width,
            prepared.mask_bounds.height,
        )?;
        let local_texture_origin = [
            outer_origin[0].saturating_add(ENTRY_PADDING),
            outer_origin[1].saturating_add(ENTRY_PADDING),
        ];
        let has_compute_backend = self.compute_backend_ready();
        let plot_offset = self.pages[page_index].plots[plot_index].offset;
        let texture_origin = [
            plot_offset[0].saturating_add(local_texture_origin[0]),
            plot_offset[1].saturating_add(local_texture_origin[1]),
        ];
        {
            let plot = &mut self.pages[page_index].plots[plot_index];
            plot.in_use_this_frame = true;
            plot.keys.push(prepared.key);
        }
        if has_compute_backend {
            let page = self.pages.get_mut(page_index)?;
            append_path_to_page_scene(page, path, texture_origin, prepared.mask_bounds);
        } else {
            let mask = prepared.rasterize();
            let plot = &mut self.pages[page_index].plots[plot_index];
            plot.blit_mask(local_texture_origin, &mask);
        }

        let entry = CacheEntry {
            page_index,
            plot_index,
            texture_origin,
            mask_size: [prepared.mask_bounds.width, prepared.mask_bounds.height],
        };
        self.cache.insert(prepared.key, entry);
        Some(self.coverage_mask_for_entry(entry, &prepared.mask_bounds))
    }

    fn upload_pending(&mut self, queue: &wgpu::Queue) {
        for page in &mut self.pages {
            page.upload_dirty_plots(queue);
        }
    }

    fn encode_pending(&mut self, encoder: &mut wgpu::CommandEncoder) {
        self.poll_compute_backend_init();
        let device = self.device.clone();
        let pages = &mut self.pages;
        let compute_backend = match &mut self.compute_backend {
            ComputeBackendState::Ready(renderer) => renderer,
            ComputeBackendState::Initializing(_) | ComputeBackendState::Failed => return,
        };
        for page in pages {
            if !page.pending_scene.is_empty()
                && page.pending_occupied_width > 0
                && page.pending_occupied_height > 0
            {
                compute_backend.render_scene_to_texture(
                    &device,
                    encoder,
                    &page.pending_scene,
                    &page.view,
                    page.pending_occupied_width,
                    page.pending_occupied_height,
                );
                page.pending_scene.reset();
                page.pending_occupied_width = 0;
                page.pending_occupied_height = 0;
            }
        }
    }

    fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        &self.pages[page_index].view
    }

    fn poll_compute_backend_init(&mut self) {
        let initialized = match &self.compute_backend {
            ComputeBackendState::Initializing(receiver) => match receiver.try_recv() {
                Ok(renderer) => Some(Some(renderer)),
                Err(TryRecvError::Empty) => Some(None),
                Err(TryRecvError::Disconnected) => None,
            },
            ComputeBackendState::Ready(_) => Some(None),
            ComputeBackendState::Failed => None,
        };

        match initialized {
            Some(Some(renderer)) => {
                self.compute_backend = ComputeBackendState::Ready(renderer);
            }
            Some(None) => {}
            None => {
                self.compute_backend = ComputeBackendState::Failed;
            }
        }
    }

    fn compute_backend_ready(&mut self) -> bool {
        self.poll_compute_backend_init();
        matches!(self.compute_backend, ComputeBackendState::Ready(_))
    }

    fn fits_in_atlas(&self, width: u32, height: u32) -> bool {
        width.saturating_add(ENTRY_PADDING * 2) <= self.plot_width
            && height.saturating_add(ENTRY_PADDING * 2) <= self.plot_height
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
    ) -> Option<(usize, usize, [u32; 2])> {
        let padded_width = width.checked_add(ENTRY_PADDING * 2)?;
        let padded_height = height.checked_add(ENTRY_PADDING * 2)?;

        for page_index in 0..self.pages.len() {
            if let Some((plot_index, texture_origin)) =
                self.pages[page_index].allocate(padded_width, padded_height)
            {
                return Some((page_index, plot_index, texture_origin));
            }
        }

        if self.pages.len() < self.max_pages {
            let page_index = self.pages.len();
            self.pages.push(AtlasPage::new(
                &self.device,
                self.width,
                self.height,
                self.plot_width,
                self.plot_height,
                page_index,
            ));
            let (plot_index, texture_origin) =
                self.pages[page_index].allocate(padded_width, padded_height)?;
            return Some((page_index, plot_index, texture_origin));
        }

        let total_plots = self.pages.len().saturating_mul(self.plots_per_page);
        for offset in 0..total_plots {
            let candidate = (self.next_evict_plot + offset) % total_plots;
            let page_index = candidate / self.plots_per_page;
            let plot_index = candidate % self.plots_per_page;
            if self.pages[page_index].plots[plot_index].in_use_this_frame {
                continue;
            }

            let stale_keys = std::mem::take(&mut self.pages[page_index].plots[plot_index].keys);
            for stale_key in stale_keys {
                self.cache.remove(&stale_key);
            }
            self.pages[page_index].plots[plot_index].reset();
            let texture_origin =
                self.pages[page_index].plots[plot_index].allocate(padded_width, padded_height)?;
            self.next_evict_plot = (candidate + 1) % total_plots;
            return Some((page_index, plot_index, texture_origin));
        }

        None
    }
}

impl AtlasPage {
    fn new(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        plot_width: u32,
        plot_height: u32,
        page_index: usize,
    ) -> Self {
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
            format: ATLAS_TEXTURE_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let plots_x = width / plot_width;
        let plots_y = height / plot_height;
        let mut plots = Vec::with_capacity((plots_x * plots_y) as usize);
        for row in 0..plots_y {
            for col in 0..plots_x {
                plots.push(AtlasPlot::new(
                    [col * plot_width, row * plot_height],
                    plot_width,
                    plot_height,
                ));
            }
        }

        Self {
            texture,
            view,
            plots,
            pending_scene: CoverageScene::new(),
            pending_occupied_width: 0,
            pending_occupied_height: 0,
        }
    }

    fn allocate(&mut self, padded_width: u32, padded_height: u32) -> Option<(usize, [u32; 2])> {
        for (plot_index, plot) in self.plots.iter_mut().enumerate() {
            if let Some(origin) = plot.allocate(padded_width, padded_height) {
                return Some((plot_index, origin));
            }
        }
        None
    }

    fn upload_dirty_plots(&mut self, queue: &wgpu::Queue) {
        let texture = &self.texture;
        let plots = &mut self.plots;
        for plot in plots {
            plot.upload_if_dirty(queue, texture);
        }
    }
}

impl AtlasPlot {
    fn new(offset: [u32; 2], width: u32, height: u32) -> Self {
        Self {
            offset,
            width,
            pixels: vec![0; (width * height * 4) as usize],
            allocator: SkylineRectanizer::new(width, height),
            dirty_rect: DirtyRect::empty(),
            in_use_this_frame: false,
            keys: Vec::new(),
        }
    }

    fn allocate(&mut self, width: u32, height: u32) -> Option<[u32; 2]> {
        let origin = self.allocator.add_rect(width, height)?;
        self.dirty_rect.join(origin[0], origin[1], width, height);
        Some(origin)
    }

    fn reset(&mut self) {
        self.pixels.fill(0);
        self.allocator.reset();
        self.dirty_rect.clear();
        self.in_use_this_frame = false;
        self.keys.clear();
    }

    fn blit_mask(&mut self, texture_origin: [u32; 2], mask: &RasterMask) {
        let width = mask.width;
        let height = mask.height;
        let src = &mask.pixels;
        for row in 0..height {
            let src_offset = (row * width) as usize;
            let dst_offset =
                (((texture_origin[1] + row) * self.width + texture_origin[0]) * 4) as usize;
            for col in 0..width as usize {
                let coverage = src[src_offset + col];
                let base = dst_offset + col * 4;
                self.pixels[base..base + 4]
                    .copy_from_slice(&[coverage, coverage, coverage, coverage]);
            }
        }
    }

    fn upload_if_dirty(&mut self, queue: &wgpu::Queue, texture: &wgpu::Texture) {
        let Some((data_offset, dirty_rect)) = self.prepare_for_upload() else {
            return;
        };

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: self.offset[0].saturating_add(dirty_rect.left),
                    y: self.offset[1].saturating_add(dirty_rect.top),
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &self.pixels[data_offset..],
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.width * 4),
                rows_per_image: Some(dirty_rect.bottom.saturating_sub(dirty_rect.top)),
            },
            wgpu::Extent3d {
                width: dirty_rect.right.saturating_sub(dirty_rect.left),
                height: dirty_rect.bottom.saturating_sub(dirty_rect.top),
                depth_or_array_layers: 1,
            },
        );
    }

    fn prepare_for_upload(&mut self) -> Option<(usize, DirtyRect)> {
        if self.dirty_rect.is_empty() {
            return None;
        }

        let dirty_rect = self.dirty_rect;
        let data_offset = ((dirty_rect.top * self.width + dirty_rect.left) * 4) as usize;
        self.dirty_rect.clear();
        Some((data_offset, dirty_rect))
    }
}

fn append_path_to_page_scene(
    page: &mut AtlasPage,
    path: &PathDrawCommand,
    texture_origin: [u32; 2],
    mask_bounds: DeviceMaskBounds,
) {
    let mut atlas_transform = local_to_device_transform(path);
    atlas_transform[4] += texture_origin[0] as f32 - mask_bounds.left as f32;
    atlas_transform[5] += texture_origin[1] as f32 - mask_bounds.top as f32;

    let slot_left = texture_origin[0] as f32;
    let slot_top = texture_origin[1] as f32;
    let slot_right = slot_left + mask_bounds.width as f32;
    let slot_bottom = slot_top + mask_bounds.height as f32;

    match path.style {
        PathStyle2D::Fill => {
            let path_elements = build_vello_path_elements(path);
            if path_elements.is_empty() {
                return;
            }
            page.pending_scene
                .push_clip_rect(slot_left, slot_top, slot_right, slot_bottom);
            page.pending_scene.solid_fill(
                &path_elements,
                vello_fill_rule(path.fill_rule),
                atlas_transform,
                coverage_mask_color(1.0),
            );
            page.pending_scene.pop_clip();
        }
        PathStyle2D::Stroke => {
            let path_elements = if normalize_dash_array(&path.dash_array).is_some() {
                build_vello_dashed_path_elements(path)
            } else {
                build_vello_path_elements(path)
            };
            if path_elements.is_empty() {
                return;
            }

            let stroke_params = resolve_coverage_stroke_params(path, atlas_transform);
            if stroke_params.alpha <= 0.0 {
                return;
            }

            let stroke = stroke_from_parts(
                stroke_params.width,
                DEFAULT_MITER_LIMIT,
                path.stroke_cap,
                path.stroke_join,
            );
            page.pending_scene
                .push_clip_rect(slot_left, slot_top, slot_right, slot_bottom);
            page.pending_scene.solid_stroke(
                &path_elements,
                &stroke,
                atlas_transform,
                coverage_mask_color(stroke_params.alpha),
            );
            page.pending_scene.pop_clip();
        }
    }

    page.pending_occupied_width = page.pending_occupied_width.max(
        texture_origin[0]
            .saturating_add(mask_bounds.width)
            .saturating_add(ENTRY_PADDING),
    );
    page.pending_occupied_height = page.pending_occupied_height.max(
        texture_origin[1]
            .saturating_add(mask_bounds.height)
            .saturating_add(ENTRY_PADDING),
    );
}

fn build_vello_path_elements(path: &PathDrawCommand) -> Vec<PathEl> {
    let mut elements = Vec::new();
    let mut current = [0.0, 0.0];
    let mut subpath_start = current;
    let mut has_current_subpath = false;
    let conic_tolerance = conic_tolerance_for_transform(local_to_device_transform(path));

    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                current = to;
                subpath_start = to;
                elements.push(PathEl::MoveTo(kurbo_point(to)));
                has_current_subpath = true;
            }
            PathVerb2D::LineTo { to } => {
                if !has_current_subpath {
                    elements.push(PathEl::MoveTo(kurbo_point(current)));
                    subpath_start = current;
                    has_current_subpath = true;
                }
                if !points_equal(current, to) {
                    elements.push(PathEl::LineTo(kurbo_point(to)));
                }
                current = to;
            }
            PathVerb2D::QuadTo { control, to } => {
                if !has_current_subpath {
                    elements.push(PathEl::MoveTo(kurbo_point(current)));
                    subpath_start = current;
                    has_current_subpath = true;
                }
                elements.push(PathEl::QuadTo(kurbo_point(control), kurbo_point(to)));
                current = to;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                if !has_current_subpath {
                    elements.push(PathEl::MoveTo(kurbo_point(current)));
                    subpath_start = current;
                    has_current_subpath = true;
                }
                let mut flattened = vec![current];
                let mut corners = vec![true];
                flatten_conic(
                    current,
                    control,
                    to,
                    weight,
                    conic_tolerance,
                    &mut flattened,
                    &mut corners,
                );
                append_vello_polyline(&mut elements, &flattened[1..], &mut current);
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !has_current_subpath {
                    elements.push(PathEl::MoveTo(kurbo_point(current)));
                    subpath_start = current;
                    has_current_subpath = true;
                }
                elements.push(PathEl::CurveTo(
                    kurbo_point(control1),
                    kurbo_point(control2),
                    kurbo_point(to),
                ));
                current = to;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                if !has_current_subpath {
                    elements.push(PathEl::MoveTo(kurbo_point(current)));
                    subpath_start = current;
                    has_current_subpath = true;
                }
                let mut flattened = vec![current];
                let mut corners = vec![true];
                flatten_arc(
                    center,
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                    &mut flattened,
                    &mut corners,
                );
                append_vello_polyline(&mut elements, &flattened[1..], &mut current);
            }
            PathVerb2D::Close => {
                if has_current_subpath {
                    elements.push(PathEl::ClosePath);
                    current = subpath_start;
                    has_current_subpath = false;
                }
            }
        }
    }

    elements
}

fn build_vello_dashed_path_elements(path: &PathDrawCommand) -> Vec<PathEl> {
    let mut local_path = path.clone();
    local_path.x = 0.0;
    local_path.y = 0.0;
    let dashed_subpaths = apply_dash_pattern(flatten_subpaths(&local_path), &local_path);
    flattened_subpaths_to_vello_path(&dashed_subpaths)
}

fn flattened_subpaths_to_vello_path(subpaths: &[FlattenedSubpath]) -> Vec<PathEl> {
    let mut elements = Vec::new();
    for subpath in subpaths {
        if subpath.points.is_empty() {
            continue;
        }
        elements.push(PathEl::MoveTo(kurbo_point(subpath.points[0])));
        for &point in subpath.points.iter().skip(1) {
            elements.push(PathEl::LineTo(kurbo_point(point)));
        }
        if subpath.closed {
            elements.push(PathEl::ClosePath);
        }
    }
    elements
}

fn append_vello_polyline(elements: &mut Vec<PathEl>, points: &[Point], current: &mut Point) {
    for &point in points {
        if points_equal(*current, point) {
            continue;
        }
        elements.push(PathEl::LineTo(kurbo_point(point)));
        *current = point;
    }
}

fn kurbo_point(point: Point) -> KurboPoint {
    KurboPoint::new(point[0] as f64, point[1] as f64)
}

fn vello_fill_rule(fill_rule: PathFillRule2D) -> Fill {
    match fill_rule {
        PathFillRule2D::Nonzero => Fill::NonZero,
        PathFillRule2D::Evenodd => Fill::EvenOdd,
    }
}

fn coverage_mask_color(alpha: f32) -> Color {
    Color::from_rgba8(255, 0, 0, (alpha.clamp(0.0, 1.0) * 255.0).round() as u8)
}

fn resolve_coverage_stroke_params(
    path: &PathDrawCommand,
    transform: [f32; 6],
) -> CoverageStrokeParams {
    let device_scale = max_scale_factor(transform).max(EPSILON);
    if path.stroke_width <= EPSILON {
        return CoverageStrokeParams {
            width: HAIRLINE_COVERAGE_WIDTH / device_scale,
            alpha: 1.0,
        };
    }

    let width = path.stroke_width.max(EPSILON);
    let device_width = width * device_scale;
    if device_width <= HAIRLINE_COVERAGE_WIDTH {
        CoverageStrokeParams {
            width: HAIRLINE_COVERAGE_WIDTH / device_scale,
            alpha: device_width.clamp(0.0, 1.0),
        }
    } else {
        CoverageStrokeParams { width, alpha: 1.0 }
    }
}

fn max_scale_factor(transform: [f32; 6]) -> f32 {
    let m00 = transform[0];
    let m01 = transform[2];
    let m10 = transform[1];
    let m11 = transform[3];
    let s1 = m00 * m00 + m01 * m01 + m10 * m10 + m11 * m11;
    let e = m00 * m00 + m01 * m01 - m10 * m10 - m11 * m11;
    let f = m00 * m10 + m01 * m11;
    let s2 = (e * e + 4.0 * f * f).sqrt();
    (0.5 * (s1 + s2)).max(0.0).sqrt()
}

impl PreparedMaskShape {
    fn from_path(path: &PathDrawCommand, surface_width: u32, surface_height: u32) -> Option<Self> {
        let local_to_device = local_to_device_transform(path);
        let (contours, fill_rule, alpha, transformed_bounds) =
            prepare_cpu_raster_shape(path, local_to_device)?;
        let mask_bounds = intersect_mask_bounds(
            transformed_bounds,
            surface_width.max(1),
            surface_height.max(1),
        )?;
        let clipped_mask_origin = [
            mask_bounds.left as f32 - transformed_bounds.left,
            mask_bounds.top as f32 - transformed_bounds.top,
        ];

        Some(Self {
            key: build_path_mask_key(
                path,
                &local_to_device,
                clipped_mask_origin,
                [mask_bounds.width, mask_bounds.height],
            ),
            contours,
            fill_rule,
            alpha,
            mask_bounds,
            transformed_bounds,
        })
    }

    fn rasterize(&self) -> RasterMask {
        rasterize_fill_mask(
            &self.contours,
            self.fill_rule,
            self.alpha,
            &self.mask_bounds,
        )
    }
}

fn prepare_cpu_raster_shape(
    path: &PathDrawCommand,
    local_to_device: [f32; 6],
) -> Option<(Vec<RasterContour>, PathFillRule2D, f32, FloatBounds)> {
    let (contours, fill_rule, alpha, bounds) = match path.style {
        PathStyle2D::Fill => {
            let contours = build_device_fill_contours(path);
            (
                contours.clone(),
                path.fill_rule,
                1.0,
                bounds_for_raster_contours(&contours)?,
            )
        }
        PathStyle2D::Stroke => {
            let stroke_params = resolve_coverage_stroke_params(path, local_to_device);
            if stroke_params.alpha <= 0.0 {
                return None;
            }
            let mut adjusted_path = path.clone();
            adjusted_path.stroke_width = stroke_params.width.max(EPSILON);
            let triangles = build_device_stroke_triangles(&adjusted_path);
            let contours = triangle_mesh_to_contours(&triangles);
            (
                contours,
                PathFillRule2D::Nonzero,
                stroke_params.alpha,
                bounds_for_triangles(&triangles)?,
            )
        }
    };
    if contours.is_empty() {
        return None;
    }
    Some((contours, fill_rule, alpha, bounds))
}

fn build_device_fill_contours(path: &PathDrawCommand) -> Vec<RasterContour> {
    flatten_subpaths(path)
        .into_iter()
        .filter_map(|subpath| {
            if subpath.points.len() < 2 {
                return None;
            }
            Some(RasterContour {
                points: subpath
                    .points
                    .into_iter()
                    .map(|point| transform_point(point, path.transform))
                    .collect(),
            })
        })
        .collect()
}

fn build_device_stroke_triangles(path: &PathDrawCommand) -> Vec<[Point; 3]> {
    let stroke_style = resolve_stroke_style(path);
    let subpaths = apply_dash_pattern(flatten_subpaths(path), path);
    let contours = create_stroke_contours(&subpaths, stroke_style.half_width);
    let mut points = Vec::new();
    let half_width = stroke_style.half_width;

    for contour in contours {
        if contour.points.len() < 2 {
            if let Some(point) = contour.degenerate_point {
                append_degenerate_stroke_cap(&mut points, point, half_width, stroke_style.cap);
            }
            continue;
        }

        for segment in &contour.segments {
            append_quad(
                &mut points,
                segment.left_start,
                segment.left_end,
                segment.right_end,
                segment.right_start,
            );
        }

        if contour.segments.is_empty() {
            continue;
        }

        if contour.closed {
            for index in 0..contour.segments.len() {
                if !contour.corners[index] {
                    let incoming = contour.segments
                        [(index + contour.segments.len() - 1) % contour.segments.len()];
                    let outgoing = contour.segments[index];
                    append_stroke_subdivision_body(&mut points, incoming, outgoing);
                    continue;
                }
                let incoming =
                    contour.segments[(index + contour.segments.len() - 1) % contour.segments.len()];
                let outgoing = contour.segments[index];
                append_stroke_join(
                    &mut points,
                    outgoing.start,
                    incoming.direction,
                    outgoing.direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                );
            }
        } else {
            append_stroke_cap(
                &mut points,
                contour.segments[0].start,
                contour.segments[0].direction,
                contour.segments[0].normal,
                half_width,
                stroke_style.cap,
                true,
            );
            append_stroke_cap(
                &mut points,
                contour.segments[contour.segments.len() - 1].end,
                contour.segments[contour.segments.len() - 1].direction,
                contour.segments[contour.segments.len() - 1].normal,
                half_width,
                stroke_style.cap,
                false,
            );
            for index in 1..contour.segments.len() {
                if !contour.corners[index] {
                    let incoming = contour.segments[index - 1];
                    let outgoing = contour.segments[index];
                    append_stroke_subdivision_body(&mut points, incoming, outgoing);
                    continue;
                }
                append_stroke_join(
                    &mut points,
                    contour.segments[index].start,
                    contour.segments[index - 1].direction,
                    contour.segments[index].direction,
                    half_width,
                    path.stroke_join,
                    stroke_style.join_limit,
                );
            }
        }
    }

    points
        .chunks_exact(3)
        .map(|triangle| {
            [
                transform_point(triangle[0], path.transform),
                transform_point(triangle[1], path.transform),
                transform_point(triangle[2], path.transform),
            ]
        })
        .collect()
}

fn triangle_mesh_to_contours(triangles: &[[Point; 3]]) -> Vec<RasterContour> {
    triangles
        .iter()
        .map(|triangle| RasterContour {
            points: vec![triangle[0], triangle[1], triangle[2]],
        })
        .collect()
}

fn bounds_for_raster_contours(contours: &[RasterContour]) -> Option<FloatBounds> {
    let mut bounds = FloatBounds {
        left: f32::INFINITY,
        top: f32::INFINITY,
        right: f32::NEG_INFINITY,
        bottom: f32::NEG_INFINITY,
    };
    for contour in contours {
        for point in &contour.points {
            bounds.left = bounds.left.min(point[0]);
            bounds.top = bounds.top.min(point[1]);
            bounds.right = bounds.right.max(point[0]);
            bounds.bottom = bounds.bottom.max(point[1]);
        }
    }
    bounds_is_valid(bounds).then_some(bounds)
}

fn bounds_for_triangles(triangles: &[[Point; 3]]) -> Option<FloatBounds> {
    let mut bounds = FloatBounds {
        left: f32::INFINITY,
        top: f32::INFINITY,
        right: f32::NEG_INFINITY,
        bottom: f32::NEG_INFINITY,
    };
    for triangle in triangles {
        for point in triangle {
            bounds.left = bounds.left.min(point[0]);
            bounds.top = bounds.top.min(point[1]);
            bounds.right = bounds.right.max(point[0]);
            bounds.bottom = bounds.bottom.max(point[1]);
        }
    }
    bounds_is_valid(bounds).then_some(bounds)
}

fn bounds_is_valid(bounds: FloatBounds) -> bool {
    bounds.left.is_finite()
        && bounds.top.is_finite()
        && bounds.right.is_finite()
        && bounds.bottom.is_finite()
        && bounds.right > bounds.left
        && bounds.bottom > bounds.top
}

fn flatten_quadratic_skia_with_corners(
    from: Point,
    control: Point,
    to: Point,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let steps = skia_quadratic_segments(from, control, to);
    for index in 1..=steps {
        let t = index as f32 / steps as f32;
        push_unique_point(
            out,
            corners,
            evaluate_quadratic(from, control, to, t),
            index == steps,
        );
    }
}

fn flatten_cubic_skia_with_corners(
    from: Point,
    control1: Point,
    control2: Point,
    to: Point,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let steps = skia_cubic_segments(from, control1, control2, to);
    for index in 1..=steps {
        let t = index as f32 / steps as f32;
        push_unique_point(
            out,
            corners,
            evaluate_cubic(from, control1, control2, to, t),
            index == steps,
        );
    }
}

fn skia_quadratic_segments(from: Point, control: Point, to: Point) -> usize {
    let x0 = to_skia_subpixel(from[0]);
    let y0 = to_skia_subpixel(from[1]);
    let x1 = to_skia_subpixel(control[0]);
    let y1 = to_skia_subpixel(control[1]);
    let x2 = to_skia_subpixel(to[0]);
    let y2 = to_skia_subpixel(to[1]);
    let dx = (((x1 as i64) << 1) - x0 as i64 - x2 as i64) >> 2;
    let dy = (((y1 as i64) << 1) - y0 as i64 - y2 as i64) >> 2;
    let shift = diff_to_shift(dx, dy, SKIA_AA_SHIFT).clamp(1, SKIA_CURVE_MAX_SHIFT);
    1usize << shift
}

fn skia_cubic_segments(from: Point, control1: Point, control2: Point, to: Point) -> usize {
    let x0 = to_skia_subpixel(from[0]);
    let y0 = to_skia_subpixel(from[1]);
    let x1 = to_skia_subpixel(control1[0]);
    let y1 = to_skia_subpixel(control1[1]);
    let x2 = to_skia_subpixel(control2[0]);
    let y2 = to_skia_subpixel(control2[1]);
    let x3 = to_skia_subpixel(to[0]);
    let y3 = to_skia_subpixel(to[1]);
    let dx = cubic_delta_from_line(x0, x1, x2, x3);
    let dy = cubic_delta_from_line(y0, y1, y2, y3);
    let shift = (diff_to_shift(dx, dy, SKIA_AA_SHIFT) + 1).clamp(1, SKIA_CURVE_MAX_SHIFT);
    1usize << shift
}

fn to_skia_subpixel(value: f32) -> i64 {
    (value * ((1 << (SKIA_AA_SHIFT + 6)) as f32)).round() as i64
}

fn cubic_delta_from_line(a: i64, b: i64, c: i64, d: i64) -> i64 {
    let one_third = (a * 8 - b * 15 + 6 * c + d) * 19 >> 9;
    let two_third = (a + 6 * b - c * 15 + d * 8) * 19 >> 9;
    one_third.abs().max(two_third.abs())
}

fn diff_to_shift(dx: i64, dy: i64, shift_aa: i32) -> i32 {
    let dist = cheap_distance(dx, dy);
    let shifted = (dist + (1i64 << (2 + shift_aa))) >> (3 + shift_aa);
    if shifted <= 0 {
        return 0;
    }
    ((64 - shifted.leading_zeros() as i32) >> 1).max(0)
}

fn cheap_distance(dx: i64, dy: i64) -> i64 {
    let dx = dx.abs();
    let dy = dy.abs();
    if dx > dy {
        dx + (dy >> 1)
    } else {
        dy + (dx >> 1)
    }
}

fn evaluate_quadratic(from: Point, control: Point, to: Point, t: f32) -> Point {
    let omt = 1.0 - t;
    [
        omt * omt * from[0] + 2.0 * omt * t * control[0] + t * t * to[0],
        omt * omt * from[1] + 2.0 * omt * t * control[1] + t * t * to[1],
    ]
}

fn evaluate_cubic(from: Point, control1: Point, control2: Point, to: Point, t: f32) -> Point {
    let omt = 1.0 - t;
    let omt2 = omt * omt;
    let omt3 = omt2 * omt;
    let t2 = t * t;
    let t3 = t2 * t;
    [
        omt3 * from[0] + 3.0 * omt2 * t * control1[0] + 3.0 * omt * t2 * control2[0] + t3 * to[0],
        omt3 * from[1] + 3.0 * omt2 * t * control1[1] + 3.0 * omt * t2 * control2[1] + t3 * to[1],
    ]
}

fn rasterize_fill_mask(
    contours: &[RasterContour],
    fill_rule: PathFillRule2D,
    alpha: f32,
    mask_bounds: &DeviceMaskBounds,
) -> RasterMask {
    let width = mask_bounds.width as usize;
    let height = mask_bounds.height as usize;
    let mut coverage = vec![0.0f32; width * height];
    let subrow_height = 1.0 / RASTER_SUBPIXEL_ROWS as f32;
    let first_subrow = subrow_height * 0.5;
    let clip_left = mask_bounds.left as f32;
    let clip_right = clip_left + mask_bounds.width as f32;
    let mut spans = Vec::new();

    for y in 0..height {
        let row_offset = y * width;
        for subrow in 0..RASTER_SUBPIXEL_ROWS {
            let sample_y =
                mask_bounds.top as f32 + y as f32 + first_subrow + subrow as f32 * subrow_height;
            spans.clear();
            collect_fill_spans(contours, fill_rule, sample_y, &mut spans);
            for &(span_left, span_right) in &spans {
                let left = span_left.max(clip_left);
                let right = span_right.min(clip_right);
                if right <= left {
                    continue;
                }
                accumulate_span(
                    &mut coverage[row_offset..row_offset + width],
                    mask_bounds.left,
                    left,
                    right,
                    subrow_height,
                );
            }
        }
    }

    let alpha = alpha.clamp(0.0, 1.0);
    let pixels = coverage
        .into_iter()
        .map(|value| ((value.clamp(0.0, 1.0) * alpha) * 255.0).round() as u8)
        .collect();
    RasterMask {
        width: mask_bounds.width,
        height: mask_bounds.height,
        pixels,
    }
}

fn collect_fill_spans(
    contours: &[RasterContour],
    fill_rule: PathFillRule2D,
    sample_y: f32,
    spans: &mut Vec<(f32, f32)>,
) {
    match fill_rule {
        PathFillRule2D::Evenodd => collect_evenodd_spans(contours, sample_y, spans),
        PathFillRule2D::Nonzero => collect_nonzero_spans(contours, sample_y, spans),
    }
}

fn collect_evenodd_spans(contours: &[RasterContour], sample_y: f32, spans: &mut Vec<(f32, f32)>) {
    let mut intersections = Vec::new();
    for contour in contours {
        collect_scanline_intersections(&contour.points, sample_y, |x, _| intersections.push(x));
    }
    intersections.sort_by(|left, right| left.total_cmp(right));

    let mut index = 0;
    while index < intersections.len() {
        let start = intersections[index];
        index += 1;
        while index < intersections.len() && (intersections[index] - start).abs() <= EPSILON {
            index += 1;
        }
        if index >= intersections.len() {
            break;
        }
        let end = intersections[index];
        if end > start {
            spans.push((start, end));
        }
        index += 1;
    }
}

fn collect_nonzero_spans(contours: &[RasterContour], sample_y: f32, spans: &mut Vec<(f32, f32)>) {
    let mut events = Vec::new();
    for contour in contours {
        collect_scanline_intersections(&contour.points, sample_y, |x, winding| {
            events.push((x, winding));
        });
    }
    events.sort_by(|left, right| left.0.total_cmp(&right.0));

    let mut index = 0;
    let mut winding = 0;
    let mut span_start = None;
    while index < events.len() {
        let x = events[index].0;
        let was_filled = winding != 0;
        while index < events.len() && (events[index].0 - x).abs() <= EPSILON {
            winding += events[index].1;
            index += 1;
        }
        let is_filled = winding != 0;
        if !was_filled && is_filled {
            span_start = Some(x);
        } else if was_filled && !is_filled {
            if let Some(start) = span_start.take() {
                if x > start {
                    spans.push((start, x));
                }
            }
        }
    }
}

fn collect_scanline_intersections(points: &[Point], sample_y: f32, mut push: impl FnMut(f32, i32)) {
    if points.len() < 2 {
        return;
    }
    let mut previous = points[points.len() - 1];
    for &point in points {
        if let Some((x, winding)) = scanline_intersection(previous, point, sample_y) {
            push(x, winding);
        }
        previous = point;
    }
}

fn scanline_intersection(from: Point, to: Point, sample_y: f32) -> Option<(f32, i32)> {
    if (from[1] - to[1]).abs() <= EPSILON {
        return None;
    }
    let min_y = from[1].min(to[1]);
    let max_y = from[1].max(to[1]);
    if sample_y < min_y || sample_y >= max_y {
        return None;
    }
    let t = (sample_y - from[1]) / (to[1] - from[1]);
    let x = from[0] + (to[0] - from[0]) * t;
    let winding = if to[1] > from[1] { 1 } else { -1 };
    Some((x, winding))
}

fn accumulate_span(
    row: &mut [f32],
    mask_left: i32,
    span_left: f32,
    span_right: f32,
    span_height: f32,
) {
    let start = span_left.floor() as i32;
    let end = span_right.ceil() as i32;
    for pixel_x in start..end {
        let left = span_left.max(pixel_x as f32);
        let right = span_right.min(pixel_x as f32 + 1.0);
        if right <= left {
            continue;
        }
        let index = pixel_x - mask_left;
        if index < 0 || index >= row.len() as i32 {
            continue;
        }
        row[index as usize] += (right - left) * span_height;
    }
}

fn flatten_subpaths(path: &PathDrawCommand) -> Vec<FlattenedSubpath> {
    let mut subpaths = Vec::new();
    let mut current = [path.x, path.y];
    let mut current_points: Vec<Point> = Vec::new();
    let mut current_corners: Vec<bool> = Vec::new();
    let mut saw_geometry = false;
    let conic_tolerance = conic_tolerance_for_transform(local_to_device_transform(path));

    for verb in &path.verbs {
        match *verb {
            PathVerb2D::MoveTo { to } => {
                push_subpath(
                    &mut subpaths,
                    &mut current_points,
                    &mut current_corners,
                    false,
                );
                let target = [path.x + to[0], path.y + to[1]];
                current = target;
                current_points.push(target);
                current_corners.push(true);
                saw_geometry = true;
            }
            PathVerb2D::LineTo { to } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let target = [path.x + to[0], path.y + to[1]];
                push_unique_point(&mut current_points, &mut current_corners, target, true);
                current = target;
            }
            PathVerb2D::QuadTo { control, to } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_quadratic_skia_with_corners(
                    current,
                    control,
                    target,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::ConicTo {
                control,
                to,
                weight,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let control = [path.x + control[0], path.y + control[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_conic(
                    current,
                    control,
                    target,
                    weight,
                    conic_tolerance,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::CubicTo {
                control1,
                control2,
                to,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let control1 = [path.x + control1[0], path.y + control1[1]];
                let control2 = [path.x + control2[0], path.y + control2[1]];
                let target = [path.x + to[0], path.y + to[1]];
                flatten_cubic_skia_with_corners(
                    current,
                    control1,
                    control2,
                    target,
                    &mut current_points,
                    &mut current_corners,
                );
                current = target;
            }
            PathVerb2D::ArcTo {
                center,
                radius,
                start_angle,
                end_angle,
                counter_clockwise,
            } => {
                if !saw_geometry {
                    current_points.push(current);
                    current_corners.push(true);
                    saw_geometry = true;
                }
                let center = [path.x + center[0], path.y + center[1]];
                flatten_arc(
                    center,
                    radius,
                    start_angle,
                    end_angle,
                    counter_clockwise,
                    &mut current_points,
                    &mut current_corners,
                );
                current = arc_endpoint(center, radius, start_angle, end_angle, counter_clockwise);
            }
            PathVerb2D::Close => {
                push_subpath(
                    &mut subpaths,
                    &mut current_points,
                    &mut current_corners,
                    true,
                );
                saw_geometry = false;
            }
        }
    }

    push_subpath(
        &mut subpaths,
        &mut current_points,
        &mut current_corners,
        false,
    );
    subpaths
}

fn push_subpath(
    subpaths: &mut Vec<FlattenedSubpath>,
    points: &mut Vec<Point>,
    corners: &mut Vec<bool>,
    closed: bool,
) {
    let (normalized, normalized_corners) =
        normalize_subpath_points(std::mem::take(points), std::mem::take(corners));
    if normalized.is_empty() {
        return;
    }
    let actually_closed = closed
        || (normalized.len() > 2 && points_equal(normalized[0], normalized[normalized.len() - 1]));
    let (normalized, normalized_corners) = if actually_closed
        && normalized.len() > 1
        && points_equal(normalized[0], normalized[normalized.len() - 1])
    {
        (
            normalized[..normalized.len() - 1].to_vec(),
            normalized_corners[..normalized_corners.len() - 1].to_vec(),
        )
    } else {
        (normalized, normalized_corners)
    };
    subpaths.push(FlattenedSubpath {
        points: normalized,
        corners: normalized_corners,
        closed: actually_closed,
    });
}

fn normalize_subpath_points(points: Vec<Point>, corners: Vec<bool>) -> (Vec<Point>, Vec<bool>) {
    let mut normalized = Vec::new();
    let mut normalized_corners = Vec::new();
    for (point, corner) in points.into_iter().zip(corners) {
        if normalized
            .last()
            .copied()
            .is_some_and(|last| points_equal(last, point))
        {
            if let Some(last_corner) = normalized_corners.last_mut() {
                *last_corner = *last_corner || corner;
            }
            continue;
        }
        normalized.push(point);
        normalized_corners.push(corner);
    }
    (normalized, normalized_corners)
}

fn create_stroke_contours(
    subpaths: &[FlattenedSubpath],
    half_width: f32,
) -> Vec<StrokeContourRecord> {
    subpaths
        .iter()
        .map(|subpath| StrokeContourRecord {
            points: subpath.points.clone(),
            corners: subpath.corners.clone(),
            closed: subpath.closed,
            segments: build_stroke_segment_records(&subpath.points, subpath.closed, half_width),
            degenerate_point: (subpath.points.len() == 1).then_some(subpath.points[0]),
        })
        .collect()
}

fn build_stroke_segment_records(
    points: &[Point],
    closed: bool,
    half_width: f32,
) -> Vec<StrokeSegmentRecord> {
    let mut segments = Vec::new();
    for index in 0..points.len().saturating_sub(1) {
        append_stroke_segment(&mut segments, points[index], points[index + 1], half_width);
    }
    if closed && points.len() > 2 {
        append_stroke_segment(
            &mut segments,
            points[points.len() - 1],
            points[0],
            half_width,
        );
    }
    segments
}

fn append_stroke_segment(
    segments: &mut Vec<StrokeSegmentRecord>,
    start: Point,
    end: Point,
    half_width: f32,
) {
    let Some(direction) = normalize(subtract(end, start)) else {
        return;
    };
    let normal = perpendicular(direction);
    segments.push(StrokeSegmentRecord {
        start,
        end,
        direction,
        normal,
        left_start: add(start, scale(normal, half_width)),
        right_start: add(start, scale(normal, -half_width)),
        left_end: add(end, scale(normal, half_width)),
        right_end: add(end, scale(normal, -half_width)),
    });
}

fn apply_dash_pattern(
    subpaths: Vec<FlattenedSubpath>,
    path: &PathDrawCommand,
) -> Vec<FlattenedSubpath> {
    let Some(dash_array) = normalize_dash_array(&path.dash_array) else {
        return subpaths;
    };
    let mut dashed = Vec::new();
    for subpath in subpaths {
        dashed.extend(build_dashed_polyline(
            &subpath.points,
            &subpath.corners,
            subpath.closed,
            &dash_array,
            path.dash_offset,
        ));
    }
    dashed
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

fn build_dashed_polyline(
    points: &[Point],
    corners: &[bool],
    closed: bool,
    dash_array: &[f32],
    dash_offset: f32,
) -> Vec<FlattenedSubpath> {
    if points.len() < 2 {
        return Vec::new();
    }

    let total_pattern_length = dash_array.iter().sum::<f32>();
    if total_pattern_length <= EPSILON {
        return Vec::new();
    }

    let mut offset = dash_offset.rem_euclid(total_pattern_length);
    let mut dash_index = 0usize;
    while offset > dash_array[dash_index] {
        offset -= dash_array[dash_index];
        dash_index = (dash_index + 1) % dash_array.len();
    }
    let mut dash_remaining = dash_array[dash_index] - offset;
    let mut drawing = dash_index % 2 == 0;

    let mut segments = Vec::new();
    let point_count = if closed {
        points.len() + 1
    } else {
        points.len()
    };
    for index in 1..point_count {
        let start_index = (index - 1) % points.len();
        let end_index = index % points.len();
        let mut start = points[(index - 1) % points.len()];
        let end = points[index % points.len()];
        let mut remaining = distance(start, end);
        if remaining <= EPSILON {
            continue;
        }
        let original_segment_length = remaining;
        let mut advanced = 0.0;
        while remaining > EPSILON {
            let step = remaining.min(dash_remaining);
            let split = lerp(start, end, step / remaining);
            if drawing {
                let start_corner =
                    advanced <= EPSILON && corners.get(start_index).copied().unwrap_or(false);
                let end_corner = (advanced + step) >= original_segment_length - EPSILON
                    && corners.get(end_index).copied().unwrap_or(false);
                segments.push((start, start_corner, split, end_corner));
            }
            start = split;
            remaining -= step;
            advanced += step;
            dash_remaining -= step;
            if dash_remaining <= EPSILON {
                dash_index = (dash_index + 1) % dash_array.len();
                dash_remaining = dash_array[dash_index];
                drawing = dash_index % 2 == 0;
            }
        }
    }

    let mut dashed = Vec::new();
    let mut current = Vec::new();
    let mut current_corners = Vec::new();
    for (start, start_corner, end, end_corner) in segments {
        if current.is_empty() {
            current.push(start);
            current_corners.push(start_corner);
            current.push(end);
            current_corners.push(end_corner);
            continue;
        }
        if points_equal(*current.last().unwrap(), start) {
            if let Some(last_corner) = current_corners.last_mut() {
                *last_corner = *last_corner || start_corner;
            }
            current.push(end);
            current_corners.push(end_corner);
            continue;
        }
        let (normalized_points, normalized_corners) = normalize_subpath_points(
            std::mem::take(&mut current),
            std::mem::take(&mut current_corners),
        );
        dashed.push(FlattenedSubpath {
            points: normalized_points,
            corners: normalized_corners,
            closed: false,
        });
        current.push(start);
        current_corners.push(start_corner);
        current.push(end);
        current_corners.push(end_corner);
    }
    if !current.is_empty() {
        let (normalized_points, normalized_corners) =
            normalize_subpath_points(current, current_corners);
        dashed.push(FlattenedSubpath {
            points: normalized_points,
            corners: normalized_corners,
            closed: false,
        });
    }
    dashed
}

fn resolve_stroke_style(path: &PathDrawCommand) -> StrokeStyle {
    let stroke_width = path.stroke_width.max(EPSILON);
    let half_width = stroke_width.max(0.5) * 0.5;
    let join_limit = match path.stroke_join {
        PathStrokeJoin2D::Round => -1.0,
        PathStrokeJoin2D::Bevel => 0.0,
        PathStrokeJoin2D::Miter => DEFAULT_MITER_LIMIT.max(1.0),
    };
    StrokeStyle {
        half_width,
        join_limit,
        cap: path.stroke_cap,
    }
}

fn append_triangle(triangles: &mut Vec<Point>, a: Point, b: Point, c: Point) {
    triangles.extend([a, b, c]);
}

fn append_quad(triangles: &mut Vec<Point>, a: Point, b: Point, c: Point, d: Point) {
    triangles.extend([a, b, c, a, c, d]);
}

fn append_round_fan(
    triangles: &mut Vec<Point>,
    center: Point,
    start: Point,
    end: Point,
    approx_stroke_radius: f32,
) {
    let start_angle = (start[1] - center[1]).atan2(start[0] - center[0]);
    let mut span = (end[1] - center[1]).atan2(end[0] - center[0]) - start_angle;
    while span <= -PI {
        span += PI * 2.0;
    }
    while span > PI {
        span -= PI * 2.0;
    }
    if span.abs() <= EPSILON {
        span = PI * 2.0;
    }
    let steps = (span * calc_num_radial_segments_per_radian(approx_stroke_radius))
        .abs()
        .ceil()
        .max(2.0) as usize;
    let radius = distance(center, start);
    let mut previous = start;
    for index in 1..=steps {
        let angle = start_angle + span * index as f32 / steps as f32;
        let next = [
            center[0] + angle.cos() * radius,
            center[1] + angle.sin() * radius,
        ];
        append_triangle(triangles, center, previous, next);
        previous = next;
    }
}

fn append_stroke_cap(
    triangles: &mut Vec<Point>,
    point: Point,
    direction: Point,
    normal: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
    at_start: bool,
) {
    let signed_direction = if at_start {
        scale(direction, -1.0)
    } else {
        direction
    };
    let left = add(point, scale(normal, half_width));
    let right = add(point, scale(normal, -half_width));
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Square => {
            let extension = scale(signed_direction, half_width);
            append_quad(
                triangles,
                add(left, extension),
                add(right, extension),
                right,
                left,
            );
        }
        PathStrokeCap2D::Round => {
            let start = if at_start { right } else { left };
            let end = if at_start { left } else { right };
            append_round_fan(triangles, point, start, end, half_width);
        }
    }
}

fn append_degenerate_stroke_cap(
    triangles: &mut Vec<Point>,
    point: Point,
    half_width: f32,
    cap: PathStrokeCap2D,
) {
    match cap {
        PathStrokeCap2D::Butt => {}
        PathStrokeCap2D::Square => {
            append_quad(
                triangles,
                [point[0] - half_width, point[1] - half_width],
                [point[0] + half_width, point[1] - half_width],
                [point[0] + half_width, point[1] + half_width],
                [point[0] - half_width, point[1] + half_width],
            );
        }
        PathStrokeCap2D::Round => {
            let start = [point[0] + half_width, point[1]];
            append_round_fan(triangles, point, start, start, half_width);
        }
    }
}

fn append_stroke_join(
    triangles: &mut Vec<Point>,
    point: Point,
    in_direction: Point,
    out_direction: Point,
    half_width: f32,
    join: PathStrokeJoin2D,
    miter_limit: f32,
) {
    let in_normal = perpendicular(in_direction);
    let out_normal = perpendicular(out_direction);
    let turn = cross(in_direction, out_direction);
    if turn.abs() <= EPSILON {
        return;
    }
    let outer_sign = if turn > 0.0 { 1.0 } else { -1.0 };
    let outer_start = add(point, scale(in_normal, half_width * outer_sign));
    let outer_end = add(point, scale(out_normal, half_width * outer_sign));

    match join {
        PathStrokeJoin2D::Round => {
            append_round_fan(triangles, point, outer_start, outer_end, half_width);
        }
        PathStrokeJoin2D::Miter => {
            if let Some(miter_point) =
                line_intersection(outer_start, in_direction, outer_end, out_direction)
            {
                let miter_length = distance(miter_point, point) / half_width.max(EPSILON);
                if miter_length <= miter_limit {
                    append_triangle(triangles, point, outer_start, miter_point);
                    append_triangle(triangles, point, miter_point, outer_end);
                    return;
                }
            }
            append_triangle(triangles, point, outer_start, outer_end);
        }
        PathStrokeJoin2D::Bevel => {
            append_triangle(triangles, point, outer_start, outer_end);
        }
    }
}

fn append_stroke_subdivision_body(
    triangles: &mut Vec<Point>,
    incoming: StrokeSegmentRecord,
    outgoing: StrokeSegmentRecord,
) {
    let left_join = line_intersection(
        incoming.left_end,
        incoming.direction,
        outgoing.left_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.left_end, outgoing.left_start));
    let right_join = line_intersection(
        incoming.right_end,
        incoming.direction,
        outgoing.right_start,
        outgoing.direction,
    )
    .unwrap_or_else(|| midpoint(incoming.right_end, outgoing.right_start));

    append_triangle(triangles, outgoing.start, incoming.left_end, left_join);
    append_triangle(triangles, outgoing.start, left_join, outgoing.left_start);
    append_triangle(triangles, outgoing.start, right_join, incoming.right_end);
    append_triangle(triangles, outgoing.start, outgoing.right_start, right_join);
}

fn flatten_conic(
    from: Point,
    control: Point,
    to: Point,
    weight: f32,
    tolerance: f32,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let steps = 1usize << conic_quad_pow2(from, control, to, weight, tolerance);
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        push_unique_point(
            out,
            corners,
            evaluate_conic(from, control, to, weight, t),
            step == steps,
        );
    }
}

fn conic_tolerance_for_transform(transform: [f32; 6]) -> f32 {
    GRAPHITE_CONIC_TOLERANCE / max_scale_factor(transform).max(EPSILON)
}

fn conic_quad_pow2(from: Point, control: Point, to: Point, weight: f32, tolerance: f32) -> u32 {
    if tolerance < 0.0 || !tolerance.is_finite() || weight < 0.0 || !weight.is_finite() {
        return 0;
    }

    let a = weight - 1.0;
    let denom = 4.0 * (2.0 + a);
    if denom.abs() <= EPSILON || !denom.is_finite() {
        return 0;
    }

    let k = a / denom;
    let dx = from[0] - (2.0 * control[0]) + to[0];
    let dy = from[1] - (2.0 * control[1]) + to[1];
    let mut error = (k * dx).hypot(k * dy);
    let mut pow2 = 0u32;
    while pow2 < MAX_CONIC_TO_QUAD_POW2 && error > tolerance {
        error *= 0.25;
        pow2 += 1;
    }
    pow2
}

fn evaluate_conic(from: Point, control: Point, to: Point, weight: f32, t: f32) -> Point {
    let omt = 1.0 - t;
    let denom = omt * omt + 2.0 * weight * omt * t + t * t;
    if denom.abs() <= EPSILON {
        return to;
    }
    [
        ((omt * omt * from[0]) + (2.0 * weight * omt * t * control[0]) + (t * t * to[0])) / denom,
        ((omt * omt * from[1]) + (2.0 * weight * omt * t * control[1]) + (t * t * to[1])) / denom,
    ]
}

fn flatten_arc(
    center: Point,
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
    out: &mut Vec<Point>,
    corners: &mut Vec<bool>,
) {
    let sweep = normalized_arc_sweep(start_angle, end_angle, counter_clockwise);
    let steps = ((sweep.abs() / (PI / 16.0)).ceil() as usize).max(1);
    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        let angle = start_angle + sweep * t;
        push_unique_point(
            out,
            corners,
            [
                center[0] + radius * angle.cos(),
                center[1] + radius * angle.sin(),
            ],
            step == steps,
        );
    }
}

fn arc_endpoint(
    center: Point,
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> Point {
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
            sweep += PI * 2.0;
        }
    } else {
        while sweep >= 0.0 {
            sweep -= PI * 2.0;
        }
    }
    sweep
}

fn midpoint(a: Point, b: Point) -> Point {
    [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5]
}

fn points_equal(left: Point, right: Point) -> bool {
    (left[0] - right[0]).abs() <= EPSILON && (left[1] - right[1]).abs() <= EPSILON
}

fn push_unique_point(points: &mut Vec<Point>, corners: &mut Vec<bool>, point: Point, corner: bool) {
    if points
        .last()
        .copied()
        .is_some_and(|last| points_equal(last, point))
    {
        if let Some(last_corner) = corners.last_mut() {
            *last_corner = *last_corner || corner;
        }
        return;
    }
    points.push(point);
    corners.push(corner);
}

fn subtract(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}

fn scale(point: Point, factor: f32) -> Point {
    [point[0] * factor, point[1] * factor]
}

fn lerp(a: Point, b: Point, t: f32) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

fn perpendicular(point: Point) -> Point {
    [-point[1], point[0]]
}

fn magnitude(point: Point) -> f32 {
    (point[0] * point[0] + point[1] * point[1]).sqrt()
}

fn normalize(point: Point) -> Option<Point> {
    let length = magnitude(point);
    (length > EPSILON).then_some([point[0] / length, point[1] / length])
}

fn distance(a: Point, b: Point) -> f32 {
    magnitude(subtract(a, b))
}

fn cross(a: Point, b: Point) -> f32 {
    a[0] * b[1] - a[1] * b[0]
}

fn calc_num_radial_segments_per_radian(approx_stroke_radius: f32) -> f32 {
    let approx_stroke_radius = approx_stroke_radius.max(1.0);
    let cos_theta = 1.0 - (1.0 / 4.0) / approx_stroke_radius;
    0.5 / cos_theta.max(-1.0).acos()
}

fn line_intersection(p0: Point, d0: Point, p1: Point, d1: Point) -> Option<Point> {
    let det = d0[0] * d1[1] - d0[1] * d1[0];
    if det.abs() <= EPSILON {
        return None;
    }
    let delta = subtract(p1, p0);
    let t = (delta[0] * d1[1] - delta[1] * d1[0]) / det;
    Some(add(p0, scale(d0, t)))
}

fn transform_point(point: Point, transform: [f32; 6]) -> Point {
    [
        (transform[0] * point[0]) + (transform[2] * point[1]) + transform[4],
        (transform[1] * point[0]) + (transform[3] * point[1]) + transform[5],
    ]
}

fn local_to_device_transform(path: &PathDrawCommand) -> [f32; 6] {
    [
        path.transform[0],
        path.transform[1],
        path.transform[2],
        path.transform[3],
        (path.transform[0] * path.x) + (path.transform[2] * path.y) + path.transform[4],
        (path.transform[1] * path.x) + (path.transform[3] * path.y) + path.transform[5],
    ]
}

fn intersect_mask_bounds(
    bounds: FloatBounds,
    surface_width: u32,
    surface_height: u32,
) -> Option<DeviceMaskBounds> {
    let left = bounds.left.floor().max(0.0) as i32;
    let top = bounds.top.floor().max(0.0) as i32;
    let right = bounds.right.ceil().min(surface_width as f32) as i32;
    let bottom = bounds.bottom.ceil().min(surface_height as f32) as i32;
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

fn build_path_mask_key(
    path: &PathDrawCommand,
    local_to_device: &[f32; 6],
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

fn hash_transform_key(transform: &[f32; 6], hasher: &mut impl Hasher) {
    hash_f32_bits(transform[0], hasher);
    hash_f32_bits(transform[1], hasher);
    hash_f32_bits(transform[2], hasher);
    hash_f32_bits(transform[3], hasher);
    fractional_translation_bucket(transform[4]).hash(hasher);
    fractional_translation_bucket(transform[5]).hash(hasher);
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
    use super::PathDrawCommand;
    use super::{build_path_mask_key, local_to_device_transform, PreparedMaskShape};
    use crate::scene::{
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

    #[test]
    fn fill_mask_rasterizer_covers_triangle_center() {
        let path = fill_path(0.0);
        let prepared = PreparedMaskShape::from_path(&path, 128, 128).expect("prepared fill path");
        let mask = prepared.rasterize();

        assert_eq!(mask.width, 40);
        assert_eq!(mask.height, 40);
        assert!(mask.pixels[(10 * mask.width + 30) as usize] > 200);
    }
}
