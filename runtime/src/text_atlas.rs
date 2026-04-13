use std::collections::HashMap;

use crate::render::GlyphMask2D;

const BITMAP_ENTRY_PADDING: u32 = 1;
const SDF_ENTRY_PADDING: u32 = 0;
const DEFAULT_ATLAS_DIM: u32 = 2048;
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

#[derive(Clone, Debug)]
struct CacheEntry {
    page_index: usize,
    texture_origin: [u32; 2],
}

struct RasterTextAtlas {
    device: wgpu::Device,
    width: u32,
    height: u32,
    max_pages: usize,
    pages: Vec<AtlasPage>,
    cache: HashMap<String, CacheEntry>,
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
    keys: Vec<String>,
}

impl RasterTextAtlas {
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

    fn find_or_create_entries(
        &mut self,
        masks: &[&GlyphMask2D],
        padding: u32,
    ) -> Option<(u32, u32, Vec<TextAtlasPlacement>)> {
        let mut placements = Vec::with_capacity(masks.len());
        for mask in masks {
            let key = cache_key_for_mask(mask);
            if let Some(cached) = self.cache.get(&key) {
                let page = self.pages.get_mut(cached.page_index)?;
                page.in_use_this_frame = true;
                placements.push(TextAtlasPlacement {
                    page_index: cached.page_index,
                    texture_origin: cached.texture_origin,
                });
                continue;
            }

            let copy_width = glyph_copy_width(mask);
            if !self.fits_in_atlas(copy_width, mask.height, padding) {
                return None;
            }

            let (page_index, texture_origin) =
                self.allocate_entry(copy_width, mask.height, padding)?;
            let page = self.pages.get_mut(page_index)?;
            page.blit_mask(texture_origin, mask);
            page.in_use_this_frame = true;
            page.keys.push(key.clone());

            self.cache.insert(
                key,
                CacheEntry {
                    page_index,
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

    fn upload_pending(&mut self, queue: &wgpu::Queue) {
        for page in &mut self.pages {
            page.upload_if_dirty(queue);
        }
    }

    fn page_view(&self, page_index: usize) -> &wgpu::TextureView {
        &self.pages[page_index].view
    }

    fn fits_in_atlas(&self, width: u32, height: u32, padding: u32) -> bool {
        width.saturating_add(padding * 2) <= self.width
            && height.saturating_add(padding * 2) <= self.height
    }

    fn allocate_entry(
        &mut self,
        width: u32,
        height: u32,
        padding: u32,
    ) -> Option<(usize, [u32; 2])> {
        let padded_width = width.checked_add(padding * 2)?;
        let padded_height = height.checked_add(padding * 2)?;

        for page_index in 0..self.pages.len() {
            if let Some(texture_origin) =
                self.pages[page_index].allocate(padded_width, padded_height, padding)
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
            let texture_origin =
                self.pages[page_index].allocate(padded_width, padded_height, padding)?;
            return Some((page_index, texture_origin));
        }

        let page_index = (0..self.pages.len())
            .map(|offset| (self.next_evict_page + offset) % self.pages.len())
            .find(|&index| !self.pages[index].in_use_this_frame)?;
        self.next_evict_page = (page_index + 1) % self.pages.len();

        let keys = std::mem::take(&mut self.pages[page_index].keys);
        for key in keys {
            self.cache.remove(&key);
        }
        self.pages[page_index].reset();
        let texture_origin =
            self.pages[page_index].allocate(padded_width, padded_height, padding)?;
        Some((page_index, texture_origin))
    }
}

impl AtlasPage {
    fn new(device: &wgpu::Device, width: u32, height: u32, page_index: usize) -> Self {
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

    fn allocate(
        &mut self,
        padded_width: u32,
        padded_height: u32,
        padding: u32,
    ) -> Option<[u32; 2]> {
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
            self.cursor_x.checked_add(padding)?,
            self.cursor_y.checked_add(padding)?,
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

    fn blit_mask(&mut self, texture_origin: [u32; 2], mask: &GlyphMask2D) {
        let copy_width = glyph_copy_width(mask);
        for row in 0..mask.height {
            let src_offset = (row * mask.stride) as usize;
            let dst_offset = ((texture_origin[1] + row) * self.width + texture_origin[0]) as usize;
            self.pixels[dst_offset..dst_offset + copy_width as usize]
                .copy_from_slice(&mask.pixels[src_offset..src_offset + copy_width as usize]);
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
