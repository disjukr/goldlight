use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::frame::{ColorLoadOp, CompositorFrame, CompositorQuad, CompositorRenderPass, SurfaceId};
use super::{ColorValue, CompositionNode, RenderModel};

#[derive(Clone, Debug, PartialEq, Eq)]
struct RootPassCacheKey {
    surface_id: SurfaceId,
    color_load_op: RootPassColorLoadOp,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RootPassColorLoadOp {
    Load,
    Clear([u32; 4]),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RootFrameCacheKey {
    composition_revision: u64,
    passes: Vec<RootPassCacheKey>,
}

#[derive(Default)]
pub(crate) struct RootComposer {
    root_frame_cache: Option<(RootFrameCacheKey, Arc<CompositorFrame>)>,
}

impl RootComposer {
    pub(crate) fn compose(&mut self, model: &RenderModel) -> Result<(RootFrameCacheKey, Arc<CompositorFrame>)> {
        let mut passes = Vec::new();
        let mut pass_keys = Vec::new();

        match model.presented_root.as_ref() {
            Some(root) => self.append_root_passes(&mut passes, &mut pass_keys, root, model)?,
            None => passes.push(CompositorRenderPass {
                color_load_op: ColorLoadOp::Clear(ColorValue::default()),
                quad: CompositorQuad::Empty,
            }),
        }

        let key = RootFrameCacheKey {
            composition_revision: model.presented_root_revision,
            passes: pass_keys,
        };
        if let Some((cached_key, cached_frame)) = &self.root_frame_cache {
            if *cached_key == key {
                return Ok((key, cached_frame.clone()));
            }
        }

        let root_frame = Arc::new(CompositorFrame::from_passes(passes));
        self.root_frame_cache = Some((key.clone(), root_frame.clone()));
        Ok((key, root_frame))
    }

    fn append_root_passes(
        &mut self,
        passes: &mut Vec<CompositorRenderPass>,
        pass_keys: &mut Vec<RootPassCacheKey>,
        node: &CompositionNode,
        model: &RenderModel,
    ) -> Result<()> {
        match node {
            CompositionNode::Stack { children } => {
                for child in children {
                    self.append_root_passes(passes, pass_keys, child, model)?;
                }
            }
            CompositionNode::Scene2D { scene_id, clear } => {
                let scene = model
                    .scenes_2d
                    .get(scene_id)
                    .ok_or_else(|| anyhow!("missing presented 2D scene {scene_id}"))?;
                let surface_id = SurfaceId::Scene2D(*scene_id);
                let color_load_op = if *clear {
                    ColorLoadOp::Clear(scene.clear_color)
                } else {
                    ColorLoadOp::Load
                };
                pass_keys.push(RootPassCacheKey {
                    surface_id,
                    color_load_op: root_pass_color_load_op(color_load_op),
                });
                passes.push(CompositorRenderPass {
                    color_load_op,
                    quad: CompositorQuad::SurfaceRef(surface_id),
                });
            }
            CompositionNode::Scene3D { scene_id, clear } => {
                let scene = model
                    .scenes_3d
                    .get(scene_id)
                    .ok_or_else(|| anyhow!("missing presented 3D scene {scene_id}"))?;
                let surface_id = SurfaceId::Scene3D(*scene_id);
                let color_load_op = if *clear {
                    ColorLoadOp::Clear(scene.clear_color)
                } else {
                    ColorLoadOp::Load
                };
                pass_keys.push(RootPassCacheKey {
                    surface_id,
                    color_load_op: root_pass_color_load_op(color_load_op),
                });
                passes.push(CompositorRenderPass {
                    color_load_op,
                    quad: CompositorQuad::SurfaceRef(surface_id),
                });
            }
        }

        Ok(())
    }
}

fn root_pass_color_load_op(color_load_op: ColorLoadOp) -> RootPassColorLoadOp {
    match color_load_op {
        ColorLoadOp::Load => RootPassColorLoadOp::Load,
        ColorLoadOp::Clear(color) => RootPassColorLoadOp::Clear([
            color.r.to_bits(),
            color.g.to_bits(),
            color.b.to_bits(),
            color.a.to_bits(),
        ]),
    }
}
