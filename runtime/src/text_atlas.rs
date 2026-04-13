use std::collections::HashMap;

use crate::render::GlyphMask2D;

const BITMAP_ENTRY_PADDING: u32 = 1;
const SDF_ENTRY_PADDING: u32 = 0;
const DEFAULT_ATLAS_DIM: u32 = 2048;
const DEFAULT_PLOT_DIM: u32 = 512;
const MAX_ATLAS_PAGES: usize = 4;

#[derive(Clone, Copy, Debug)]
pub struct TextAtlasPlacement {
    pub page_index: usize,
    pub texture_origin: [u32; 2],
}

pub struct TextAtlasProvider {
    atlas: RasterTextAtlas,
}

impl TextAtlasProvider {
    pub fn new(device: &wgpu::Device) -> Self {
        Self {
            atlas: RasterTextAtlas::new(
                device,
                DEFAULT_ATLAS_DIM,
                DEFAULT_ATLAS_DIM,
                DEFAULT_PLOT_DIM,
                DEFAULT_PLOT_DIM,
                MAX_ATLAS_PAGES,
            ),
        }
    }

    pub fn begin_frame(&mut self) {
        self.atlas.begin_frame();
    }

    pub fn find_or_create_bitmap_entries(
        &mut self,
        masks: &[&GlyphMask2D],
    ) -> Option<(u32, u32, Vec<TextAtlasPlacement>)> {
        self.atlas
            .find_or_create_entries(masks, BITMAP_ENTRY_PADDING)
    }

    pub fn find_or_create_sdf_entries(
        &mut self,
        masks: &[&GlyphMask2D],
    ) -> Option<(u32, u32, Vec<TextAtlasPlacement>)> {
        self.atlas.find_or_create_entries(masks, SDF_ENTRY_PADDING)
    }

    pub fn upload_pending(&mut self, queue: &wgpu::Queue) {
        self.atlas.upload_pending(queue);
    }

    pub fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        self.atlas.page_view(page_index)
    }
}

#[derive(Clone, Copy, Debug)]
struct CacheEntry {
    page_index: usize,
    plot_index: usize,
    texture_origin: [u32; 2],
}

struct RasterTextAtlas {
    device: wgpu::Device,
    width: u32,
    height: u32,
    plot_width: u32,
    plot_height: u32,
    plots_per_page: usize,
    max_pages: usize,
    pages: Vec<AtlasPage>,
    cache: HashMap<String, CacheEntry>,
    next_evict_plot: usize,
}

struct AtlasPage {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    plots: Vec<AtlasPlot>,
}

struct AtlasPlot {
    offset: [u32; 2],
    width: u32,
    pixels: Vec<u8>,
    allocator: SkylineRectanizer,
    dirty_rect: DirtyRect,
    in_use_this_frame: bool,
    keys: Vec<String>,
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
    area_so_far: u32,
}

impl SkylineRectanizer {
    fn new(width: u32, height: u32) -> Self {
        let mut rectanizer = Self {
            width,
            height,
            skyline: Vec::new(),
            area_so_far: 0,
        };
        rectanizer.reset();
        rectanizer
    }

    fn reset(&mut self) {
        self.area_so_far = 0;
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
        self.area_so_far = self
            .area_so_far
            .saturating_add(width.saturating_mul(height));
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

impl RasterTextAtlas {
    fn new(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        plot_width: u32,
        plot_height: u32,
        max_pages: usize,
    ) -> Self {
        let plots_per_page = ((width / plot_width) * (height / plot_height)) as usize;
        Self {
            device: device.clone(),
            width,
            height,
            plot_width,
            plot_height,
            plots_per_page,
            max_pages,
            pages: vec![AtlasPage::new(
                device,
                width,
                height,
                plot_width,
                plot_height,
                0,
            )],
            cache: HashMap::new(),
            next_evict_plot: 0,
        }
    }

    fn begin_frame(&mut self) {
        for page in &mut self.pages {
            for plot in &mut page.plots {
                plot.in_use_this_frame = false;
            }
        }
    }

    fn find_or_create_entries(
        &mut self,
        masks: &[&GlyphMask2D],
        padding: u32,
    ) -> Option<(u32, u32, Vec<TextAtlasPlacement>)> {
        let mut placements = Vec::with_capacity(masks.len());
        for mask in masks {
            let key = cache_key_for_mask(mask);
            if let Some(placement) = self.lookup_cached_entry(&key) {
                placements.push(placement);
                continue;
            }

            let copy_width = glyph_copy_width(mask);
            if !self.fits_in_plot(copy_width, mask.height, padding) {
                return None;
            }

            let (page_index, plot_index, outer_origin) =
                self.allocate_entry(copy_width, mask.height, padding)?;
            let plot = &mut self.pages[page_index].plots[plot_index];
            let local_texture_origin = [
                outer_origin[0].saturating_add(padding),
                outer_origin[1].saturating_add(padding),
            ];
            plot.blit_mask(local_texture_origin, mask);
            plot.in_use_this_frame = true;
            plot.keys.push(key.clone());

            let texture_origin = [
                plot.offset[0].saturating_add(local_texture_origin[0]),
                plot.offset[1].saturating_add(local_texture_origin[1]),
            ];
            self.cache.insert(
                key,
                CacheEntry {
                    page_index,
                    plot_index,
                    texture_origin,
                },
            );
            placements.push(TextAtlasPlacement {
                page_index,
                texture_origin,
            });
        }

        Some((self.width, self.height, placements))
    }

    fn lookup_cached_entry(&mut self, key: &str) -> Option<TextAtlasPlacement> {
        let cached = *self.cache.get(key)?;
        let plot = self
            .pages
            .get_mut(cached.page_index)?
            .plots
            .get_mut(cached.plot_index)?;
        plot.in_use_this_frame = true;
        Some(TextAtlasPlacement {
            page_index: cached.page_index,
            texture_origin: cached.texture_origin,
        })
    }

    fn upload_pending(&mut self, queue: &wgpu::Queue) {
        for page in &mut self.pages {
            page.upload_dirty_plots(queue);
        }
    }

    fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        &self.pages[page_index].view
    }

    fn fits_in_plot(&self, width: u32, height: u32, padding: u32) -> bool {
        width.saturating_add(padding.saturating_mul(2)) <= self.plot_width
            && height.saturating_add(padding.saturating_mul(2)) <= self.plot_height
    }

    fn allocate_entry(
        &mut self,
        width: u32,
        height: u32,
        padding: u32,
    ) -> Option<(usize, usize, [u32; 2])> {
        let padded_width = width.checked_add(padding.checked_mul(2)?)?;
        let padded_height = height.checked_add(padding.checked_mul(2)?)?;

        for page_index in 0..self.pages.len() {
            if let Some((plot_index, outer_origin)) =
                self.pages[page_index].allocate(padded_width, padded_height)
            {
                return Some((page_index, plot_index, outer_origin));
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
            let (plot_index, outer_origin) =
                self.pages[page_index].allocate(padded_width, padded_height)?;
            return Some((page_index, plot_index, outer_origin));
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
            let outer_origin =
                self.pages[page_index].plots[plot_index].allocate(padded_width, padded_height)?;
            self.next_evict_plot = (candidate + 1) % total_plots;
            return Some((page_index, plot_index, outer_origin));
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
            label: Some(&format!("goldlight text atlas page {page_index}")),
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
            pixels: vec![0; (width * height) as usize],
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

    fn blit_mask(&mut self, texture_origin: [u32; 2], mask: &GlyphMask2D) {
        let copy_width = glyph_copy_width(mask);
        for row in 0..mask.height {
            let src_offset = (row * mask.stride) as usize;
            let dst_offset = ((texture_origin[1] + row) * self.width + texture_origin[0]) as usize;
            self.pixels[dst_offset..dst_offset + copy_width as usize]
                .copy_from_slice(&mask.pixels[src_offset..src_offset + copy_width as usize]);
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
                bytes_per_row: Some(self.width),
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

        let mut dirty_rect = self.dirty_rect;
        let clear_bits = 0x3;
        dirty_rect.left &= !clear_bits;
        dirty_rect.right = dirty_rect.right.saturating_add(clear_bits) & !clear_bits;
        dirty_rect.right = dirty_rect.right.min(self.width);

        let data_offset = (dirty_rect.top * self.width + dirty_rect.left) as usize;
        self.dirty_rect.clear();
        Some((data_offset, dirty_rect))
    }
}

fn glyph_copy_width(mask: &GlyphMask2D) -> u32 {
    mask.width.min(mask.stride)
}

fn cache_key_for_mask(mask: &GlyphMask2D) -> String {
    if !mask._cache_key.is_empty() {
        return mask._cache_key.clone();
    }
    let mut hash: u32 = 2166136261;
    hash ^= mask.width;
    hash = hash.wrapping_mul(16777619);
    hash ^= mask.height;
    hash = hash.wrapping_mul(16777619);
    hash ^= mask.stride;
    hash = hash.wrapping_mul(16777619);
    for row in 0..mask.height {
        let row_start = (row * mask.stride) as usize;
        let row_end = row_start + mask.stride as usize;
        for &value in &mask.pixels[row_start..row_end.min(mask.pixels.len())] {
            hash ^= value as u32;
            hash = hash.wrapping_mul(16777619);
        }
    }
    format!("{}x{}:{hash}", mask.width, mask.height)
}
