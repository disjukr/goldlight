use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::content_2d::{
    lower_scene_2d_surface, lower_scroll_container_2d_surface,
    measure_scroll_container_2d_surface_bounds, DrawingRecording, RecordingBounds,
};
use super::frame::{
    ColorLoadOp, CompositorFrame, CompositorQuad, CompositorRenderPass, RenderContent, SurfaceId,
};
use super::model::RenderModel;

pub(crate) struct SurfaceFrameCacheEntry {
    pub(crate) frame_revision: u64,
    pub(crate) device_pixel_ratio_bits: u32,
    pub(crate) frame: Arc<CompositorFrame>,
    pub(crate) raster_origin: [f32; 2],
    pub(crate) raster_size: [u32; 2],
    recordings: Vec<Arc<DrawingRecording>>,
}

impl SurfaceFrameCacheEntry {
    pub(crate) fn recording(&self, recording_index: u32) -> Result<&Arc<DrawingRecording>> {
        self.recordings
            .get(recording_index as usize)
            .ok_or_else(|| anyhow!("missing cached recording index {recording_index}"))
    }
}

#[derive(Default)]
pub(crate) struct SurfaceStore {
    surface_frame_cache: HashMap<SurfaceId, SurfaceFrameCacheEntry>,
}

impl SurfaceStore {
    pub(crate) fn ensure_scene_2d_surface(
        &mut self,
        model: &RenderModel,
        scene_id: u32,
        device_pixel_ratio: f32,
    ) -> Result<&SurfaceFrameCacheEntry> {
        let scene = model
            .scenes_2d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("missing 2D scene {scene_id}"))?;
        let surface_id = SurfaceId::Scene2D(scene_id);
        let device_pixel_ratio_bits = device_pixel_ratio.to_bits();
        let is_current = self.surface_frame_cache.get(&surface_id).is_some_and(|entry| {
            entry.frame_revision == scene.frame_revision
                && entry.device_pixel_ratio_bits == device_pixel_ratio_bits
        });
        if is_current {
            return self.get(surface_id);
        }

        let lowered = lower_scene_2d_surface(model, scene_id, device_pixel_ratio);
        let frame = Arc::new(lowered.frame);
        let recordings = lowered.recordings.into_iter().map(Arc::new).collect();
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision: scene.frame_revision,
                device_pixel_ratio_bits,
                frame,
                raster_origin: [0.0, 0.0],
                raster_size: [0, 0],
                recordings,
            },
        );
        self.get(surface_id)
    }

    pub(crate) fn ensure_scroll_container_2d_surface(
        &mut self,
        model: &RenderModel,
        scroll_container_id: u32,
        device_pixel_ratio: f32,
    ) -> Result<&SurfaceFrameCacheEntry> {
        if !model.scroll_containers_2d.contains_key(&scroll_container_id) {
            return Err(anyhow!(
                "missing 2D scroll container {scroll_container_id}"
            ));
        }
        let surface_id = SurfaceId::ScrollContainer2D(scroll_container_id);
        let device_pixel_ratio_bits = device_pixel_ratio.to_bits();
        let frame_revision = scroll_surface_frame_revision(model, scroll_container_id)?;
        let is_current = self.surface_frame_cache.get(&surface_id).is_some_and(|entry| {
            entry.frame_revision == frame_revision
                && entry.device_pixel_ratio_bits == device_pixel_ratio_bits
        });
        if is_current {
            return self.get(surface_id);
        }

        let bounds =
            measure_scroll_container_2d_surface_bounds(model, scroll_container_id, device_pixel_ratio);
        let (origin, raster_size) = raster_geometry(bounds);
        let lowered =
            lower_scroll_container_2d_surface(model, scroll_container_id, device_pixel_ratio, origin);
        let frame = Arc::new(lowered.frame);
        let recordings = lowered.recordings.into_iter().map(Arc::new).collect();
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision,
                device_pixel_ratio_bits,
                frame,
                raster_origin: origin,
                raster_size,
                recordings,
            },
        );
        self.get(surface_id)
    }

    pub(crate) fn ensure_scene_3d_surface(&mut self, model: &RenderModel, scene_id: u32) -> Result<&SurfaceFrameCacheEntry> {
        let scene = model
            .scenes_3d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("missing 3D scene {scene_id}"))?;
        let surface_id = SurfaceId::Scene3D(scene_id);
        if self
            .surface_frame_cache
            .get(&surface_id)
            .is_some_and(|entry| entry.frame_revision == scene.revision)
        {
            return self.get(surface_id);
        }

        let frame = Arc::new(CompositorFrame::from_passes(vec![CompositorRenderPass {
            color_load_op: ColorLoadOp::Load,
            quad: CompositorQuad::Content(RenderContent::Scene3D(scene_id)),
        }]));
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision: scene.revision,
                device_pixel_ratio_bits: 0,
                frame,
                raster_origin: [0.0, 0.0],
                raster_size: [0, 0],
                recordings: Vec::new(),
            },
        );
        self.get(surface_id)
    }

    pub(crate) fn get(&self, surface_id: SurfaceId) -> Result<&SurfaceFrameCacheEntry> {
        self.surface_frame_cache
            .get(&surface_id)
            .ok_or_else(|| anyhow!("missing cached surface frame for {surface_id:?}"))
    }

    pub(crate) fn collect_revisions(
        &self,
        frame: &CompositorFrame,
    ) -> Result<Vec<(SurfaceId, u64)>> {
        let mut surface_revisions = Vec::new();
        self.collect_revisions_recursive(frame, &mut surface_revisions)?;
        Ok(surface_revisions)
    }

    fn collect_revisions_recursive(
        &self,
        frame: &CompositorFrame,
        surface_revisions: &mut Vec<(SurfaceId, u64)>,
    ) -> Result<()> {
        for pass in frame.passes() {
            if let CompositorQuad::SurfaceRef(surface_id) = pass.quad {
                let entry = self.get(surface_id)?;
                surface_revisions.push((surface_id, entry.frame_revision));
                self.collect_revisions_recursive(entry.frame.as_ref(), surface_revisions)?;
            }
        }
        Ok(())
    }
}

fn raster_geometry(bounds: Option<RecordingBounds>) -> ([f32; 2], [u32; 2]) {
    let Some(bounds) = bounds else {
        return ([0.0, 0.0], [1, 1]);
    };
    let origin = [bounds.left.floor(), bounds.top.floor()];
    let width = (bounds.right.ceil() - origin[0]).max(1.0) as u32;
    let height = (bounds.bottom.ceil() - origin[1]).max(1.0) as u32;
    (origin, [width, height])
}

fn scroll_surface_frame_revision(
    model: &RenderModel,
    scroll_container_id: u32,
) -> Result<u64> {
    let mut revision = model
        .item_2d_revision(scroll_container_id)
        .ok_or_else(|| anyhow!("missing 2D item revision for scroll container {scroll_container_id}"))?;
    let scroll_container = model
        .scroll_containers_2d
        .get(&scroll_container_id)
        .ok_or_else(|| anyhow!("missing 2D scroll container {scroll_container_id}"))?;
    collect_descendant_item_revisions(model, &scroll_container.child_item_ids, &mut revision);
    Ok(revision)
}

fn collect_descendant_item_revisions(
    model: &RenderModel,
    item_ids: &[u32],
    revision: &mut u64,
) {
    for item_id in item_ids {
        if let Some(item_revision) = model.item_2d_revision(*item_id) {
            *revision = (*revision).max(item_revision);
        }
        if let Some(group) = model.groups_2d.get(item_id) {
            collect_descendant_item_revisions(model, &group.child_item_ids, revision);
            continue;
        }
        if let Some(scroll_container) = model.scroll_containers_2d.get(item_id) {
            *revision = (*revision).max(scroll_container.frame_revision);
            collect_descendant_item_revisions(model, &scroll_container.child_item_ids, revision);
        }
    }
}
