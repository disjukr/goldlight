use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::frame::{
    ColorLoadOp, CompositorFrame, CompositorQuad, CompositorRenderPass, RenderContent, SurfaceId,
};

pub(crate) struct SurfaceFrameCacheEntry {
    pub(crate) content_revision: u64,
    pub(crate) frame: Arc<CompositorFrame>,
}

#[derive(Default)]
pub(crate) struct SurfaceStore {
    surface_frame_cache: HashMap<SurfaceId, SurfaceFrameCacheEntry>,
}

impl SurfaceStore {
    pub(crate) fn ensure_scene_2d_surface(
        &mut self,
        scene_id: u32,
        revision: u64,
    ) -> Arc<CompositorFrame> {
        let surface_id = SurfaceId::Scene2D(scene_id);
        if let Some(entry) = self.surface_frame_cache.get(&surface_id) {
            if entry.content_revision == revision {
                return entry.frame.clone();
            }
        }

        let frame = Arc::new(CompositorFrame::from_passes(vec![CompositorRenderPass {
            color_load_op: ColorLoadOp::Load,
            quad: CompositorQuad::Content(RenderContent::Scene2D(scene_id)),
        }]));
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                content_revision: revision,
                frame: frame.clone(),
            },
        );
        frame
    }

    pub(crate) fn ensure_scene_3d_surface(
        &mut self,
        scene_id: u32,
        revision: u64,
    ) -> Arc<CompositorFrame> {
        let surface_id = SurfaceId::Scene3D(scene_id);
        if let Some(entry) = self.surface_frame_cache.get(&surface_id) {
            if entry.content_revision == revision {
                return entry.frame.clone();
            }
        }

        let frame = Arc::new(CompositorFrame::from_passes(vec![CompositorRenderPass {
            color_load_op: ColorLoadOp::Load,
            quad: CompositorQuad::Content(RenderContent::Scene3D(scene_id)),
        }]));
        self.surface_frame_cache.insert(
            surface_id,
            SurfaceFrameCacheEntry {
                content_revision: revision,
                frame: frame.clone(),
            },
        );
        frame
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
            if let CompositorQuad::Surface(surface_id) = pass.quad {
                let entry = self.get(surface_id)?;
                surface_revisions.push((surface_id, entry.content_revision));
                self.collect_revisions_recursive(entry.frame.as_ref(), surface_revisions)?;
            }
        }
        Ok(())
    }
}
