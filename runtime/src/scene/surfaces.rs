use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::content_2d::{
    lower_group_2d_surface, lower_scene_2d_surface, lower_scroll_container_2d_surface,
    measure_group_2d_surface_bounds, measure_scroll_container_2d_surface_bounds,
    DrawingRecording, RecordingBounds, RetainedSurfaceProvider,
};
use super::frame::{
    ColorLoadOp, CompositorFrame, CompositorQuad, CompositorRenderPass, RenderContent, SurfaceId,
};
use super::model::RenderModel;

pub(crate) struct SurfaceFrameCacheEntry {
    pub(crate) frame_revision: u64,
    pub(crate) device_pixel_ratio_bits: u32,
    pub(crate) frame: Arc<CompositorFrame>,
    pub(crate) bounds: Option<RecordingBounds>,
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

        let lowered = lower_scene_2d_surface(model, scene_id, device_pixel_ratio, Some(self));
        let frame = Arc::new(lowered.frame);
        let bounds = lowered.bounds;
        let recordings = lowered.recordings.into_iter().map(Arc::new).collect();
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision: scene.frame_revision,
                device_pixel_ratio_bits,
                frame,
                bounds,
                raster_origin: [0.0, 0.0],
                raster_size: [0, 0],
                recordings,
            },
        );
        self.get(surface_id)
    }

    pub(crate) fn ensure_group_2d_surface(
        &mut self,
        model: &RenderModel,
        group_id: u32,
        device_pixel_ratio: f32,
    ) -> Result<&SurfaceFrameCacheEntry> {
        if !model.groups_2d.contains_key(&group_id) {
            return Err(anyhow!("missing 2D group {group_id}"));
        }
        let surface_id = SurfaceId::Group2D(group_id);
        let device_pixel_ratio_bits = device_pixel_ratio.to_bits();
        let frame_revision = group_surface_frame_revision(model, group_id)?;
        let is_current = self.surface_frame_cache.get(&surface_id).is_some_and(|entry| {
            entry.frame_revision == frame_revision
                && entry.device_pixel_ratio_bits == device_pixel_ratio_bits
        });
        if is_current {
            return self.get(surface_id);
        }

        let bounds = measure_group_2d_surface_bounds(model, group_id, device_pixel_ratio, Some(self));
        let (origin, raster_size) = raster_geometry(bounds);
        let lowered = lower_group_2d_surface(model, group_id, device_pixel_ratio, origin, Some(self));
        let frame = Arc::new(lowered.frame);
        let recordings = lowered.recordings.into_iter().map(Arc::new).collect();
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision,
                device_pixel_ratio_bits,
                frame,
                bounds,
                raster_origin: origin,
                raster_size,
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

        let bounds = measure_scroll_container_2d_surface_bounds(
            model,
            scroll_container_id,
            device_pixel_ratio,
            Some(self),
        );
        let (origin, raster_size) = raster_geometry(bounds);
        let lowered = lower_scroll_container_2d_surface(
            model,
            scroll_container_id,
            device_pixel_ratio,
            origin,
            Some(self),
        );
        let frame = Arc::new(lowered.frame);
        let recordings = lowered.recordings.into_iter().map(Arc::new).collect();
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                frame_revision,
                device_pixel_ratio_bits,
                frame,
                bounds,
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
                bounds: None,
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
    collect_descendant_visual_revisions(model, &scroll_container.child_item_ids, &mut revision);
    Ok(revision)
}

fn group_surface_frame_revision(model: &RenderModel, group_id: u32) -> Result<u64> {
    let group = model
        .groups_2d
        .get(&group_id)
        .ok_or_else(|| anyhow!("missing 2D group {group_id}"))?;
    let mut revision = group.content_revision;
    collect_descendant_visual_revisions(model, &group.child_item_ids, &mut revision);
    Ok(revision)
}

fn collect_descendant_visual_revisions(
    model: &RenderModel,
    item_ids: &[u32],
    revision: &mut u64,
) {
    for item_id in item_ids {
        if let Some(item_revision) = model.item_2d_revision(*item_id) {
            *revision = (*revision).max(item_revision);
        }
        if let Some(group) = model.groups_2d.get(item_id) {
            *revision = (*revision).max(group.frame_revision);
            collect_descendant_visual_revisions(model, &group.child_item_ids, revision);
            continue;
        }
        if let Some(scroll_container) = model.scroll_containers_2d.get(item_id) {
            *revision = (*revision).max(scroll_container.frame_revision);
            collect_descendant_visual_revisions(model, &scroll_container.child_item_ids, revision);
        }
    }
}

impl RetainedSurfaceProvider for SurfaceStore {
    fn ensure_group_surface_bounds(
        &mut self,
        model: &RenderModel,
        group_id: u32,
        device_pixel_ratio: f32,
    ) -> Option<RecordingBounds> {
        self.ensure_group_2d_surface(model, group_id, device_pixel_ratio)
            .expect("group surface should be available for retained lowering")
            .bounds
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::SurfaceStore;
    use crate::scene::frame::{CompositorQuad, RetainedSurfaceQuad, SurfaceId};
    use crate::scene::{
        ColorValue, Group2DOptions, Rect2DOptions, RenderModel, Scene2DOptions,
    };

    #[test]
    fn group_surface_reuses_cache_across_transform_only_updates() {
        let mut model = RenderModel::default();
        let scene = model.create_scene_2d(Scene2DOptions {
            clear_color: ColorValue::default(),
        });
        let rect = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 20.0,
                    y: 30.0,
                    width: 10.0,
                    height: 12.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("rect");
        let group = model
            .scene_2d_create_group(
                scene.id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 5.0, 7.0],
                },
            )
            .expect("group");
        model
            .group_2d_set_children(group.id, vec![rect.id])
            .expect("group children");
        model
            .scene_2d_set_root_items(scene.id, vec![group.id])
            .expect("root items");

        let mut surfaces = SurfaceStore::default();
        let first_group_entry = surfaces
            .ensure_group_2d_surface(&model, group.id, 1.0)
            .expect("first group surface");
        let first_group_revision = first_group_entry.frame_revision;
        let first_group_frame = first_group_entry.frame.clone();
        let first_bounds = first_group_entry.bounds.expect("group bounds");
        assert_eq!(first_bounds.left, 20.0);
        assert_eq!(first_bounds.top, 30.0);
        assert_eq!(first_bounds.right, 30.0);
        assert_eq!(first_bounds.bottom, 42.0);

        let first_scene_frame = surfaces
            .ensure_scene_2d_surface(&model, scene.id, 1.0)
            .expect("first scene surface")
            .frame
            .clone();

        model
            .group_2d_update(
                group.id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 40.0, 50.0],
                },
            )
            .expect("group transform update");

        let second_group_entry = surfaces
            .ensure_group_2d_surface(&model, group.id, 1.0)
            .expect("second group surface");
        assert_eq!(second_group_entry.frame_revision, first_group_revision);
        assert!(Arc::ptr_eq(&second_group_entry.frame, &first_group_frame));

        let second_scene_entry = surfaces
            .ensure_scene_2d_surface(&model, scene.id, 1.0)
            .expect("second scene surface");
        assert!(!Arc::ptr_eq(&second_scene_entry.frame, &first_scene_frame));
        assert_eq!(second_scene_entry.frame.passes().len(), 1);
        assert!(matches!(
            second_scene_entry.frame.passes()[0].quad,
            CompositorQuad::RetainedSurface(RetainedSurfaceQuad {
                surface_id: SurfaceId::Group2D(id),
                transform,
                viewport_size,
                source_origin,
                scroll_offset,
            }) if id == group.id
                && transform == [1.0, 0.0, 0.0, 1.0, 60.0, 80.0]
                && viewport_size == [10.0, 12.0]
                && source_origin == [20.0, 30.0]
                && scroll_offset == [0.0, 0.0]
        ));
    }
}
