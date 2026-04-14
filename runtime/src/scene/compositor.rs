use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use super::frame::{
    AggregatedFrame, AggregatedQuad, AggregatedRenderPass, ColorLoadOp, CompositorFrame,
    CompositorQuad, CompositorRenderPass, RenderContent, SurfaceId,
};
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
struct RootFrameCacheKey {
    composition_revision: u64,
    passes: Vec<RootPassCacheKey>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AggregatedFrameCacheKey {
    root: RootFrameCacheKey,
    surface_revisions: Vec<(SurfaceId, u64)>,
}

struct SurfaceFrameCacheEntry {
    content_revision: u64,
    frame: Arc<CompositorFrame>,
}

#[derive(Default)]
pub(crate) struct CompositorState {
    surface_frame_cache: HashMap<SurfaceId, SurfaceFrameCacheEntry>,
    root_frame_cache: Option<(RootFrameCacheKey, Arc<CompositorFrame>)>,
    aggregated_frame_cache: Option<(AggregatedFrameCacheKey, Arc<AggregatedFrame>)>,
}

impl CompositorState {
    pub(crate) fn composite(
        &mut self,
        model: &RenderModel,
    ) -> Result<Arc<AggregatedFrame>> {
        let (root_key, root_frame) = self.ensure_root_frame(model)?;
        let surface_revisions = self.collect_surface_revisions(root_frame.as_ref())?;
        let aggregated_key = AggregatedFrameCacheKey {
            root: root_key,
            surface_revisions,
        };

        if let Some((cached_key, cached_frame)) = &self.aggregated_frame_cache {
            if *cached_key == aggregated_key {
                return Ok(cached_frame.clone());
            }
        }

        let mut passes = Vec::new();
        for pass in root_frame.passes() {
            self.append_aggregated_pass(pass, &mut passes)?;
        }
        let aggregated_frame = Arc::new(AggregatedFrame::from_passes(passes));
        self.aggregated_frame_cache = Some((aggregated_key, aggregated_frame.clone()));
        Ok(aggregated_frame)
    }

    fn ensure_root_frame(
        &mut self,
        model: &RenderModel,
    ) -> Result<(RootFrameCacheKey, Arc<CompositorFrame>)> {
        let mut passes = Vec::new();
        let mut pass_keys = Vec::new();

        match model.presented_root.as_ref() {
            Some(root) => self.append_root_passes(
                &mut passes,
                &mut pass_keys,
                root,
                model,
            )?,
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
                let surface_frame = self.ensure_scene_2d_surface(*scene_id, scene.revision)?;
                let color_load_op = if *clear {
                    ColorLoadOp::Clear(scene.clear_color)
                } else {
                    ColorLoadOp::Load
                };
                pass_keys.push(RootPassCacheKey {
                    surface_id,
                    color_load_op: match color_load_op {
                        ColorLoadOp::Load => RootPassColorLoadOp::Load,
                        ColorLoadOp::Clear(color) => RootPassColorLoadOp::Clear([
                            color.r.to_bits(),
                            color.g.to_bits(),
                            color.b.to_bits(),
                            color.a.to_bits(),
                        ]),
                    },
                });
                passes.push(CompositorRenderPass {
                    color_load_op,
                    quad: if surface_frame.passes().is_empty() {
                        CompositorQuad::Empty
                    } else {
                        CompositorQuad::Surface(surface_id)
                    },
                });
            }
            CompositionNode::Scene3D { scene_id, clear } => {
                let scene = model
                    .scenes_3d
                    .get(scene_id)
                    .ok_or_else(|| anyhow!("missing presented 3D scene {scene_id}"))?;
                let surface_id = SurfaceId::Scene3D(*scene_id);
                let surface_frame = self.ensure_scene_3d_surface(*scene_id, scene.revision)?;
                let color_load_op = if *clear {
                    ColorLoadOp::Clear(scene.clear_color)
                } else {
                    ColorLoadOp::Load
                };
                pass_keys.push(RootPassCacheKey {
                    surface_id,
                    color_load_op: match color_load_op {
                        ColorLoadOp::Load => RootPassColorLoadOp::Load,
                        ColorLoadOp::Clear(color) => RootPassColorLoadOp::Clear([
                            color.r.to_bits(),
                            color.g.to_bits(),
                            color.b.to_bits(),
                            color.a.to_bits(),
                        ]),
                    },
                });
                passes.push(CompositorRenderPass {
                    color_load_op,
                    quad: if surface_frame.passes().is_empty() {
                        CompositorQuad::Empty
                    } else {
                        CompositorQuad::Surface(surface_id)
                    },
                });
            }
        }

        Ok(())
    }

    fn ensure_scene_2d_surface(
        &mut self,
        scene_id: u32,
        revision: u64,
    ) -> Result<Arc<CompositorFrame>> {
        let surface_id = SurfaceId::Scene2D(scene_id);
        if let Some(entry) = self.surface_frame_cache.get(&surface_id) {
            if entry.content_revision == revision {
                return Ok(entry.frame.clone());
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
        Ok(frame)
    }

    fn ensure_scene_3d_surface(
        &mut self,
        scene_id: u32,
        revision: u64,
    ) -> Result<Arc<CompositorFrame>> {
        let surface_id = SurfaceId::Scene3D(scene_id);
        if let Some(entry) = self.surface_frame_cache.get(&surface_id) {
            if entry.content_revision == revision {
                return Ok(entry.frame.clone());
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
        Ok(frame)
    }

    fn collect_surface_revisions(
        &self,
        frame: &CompositorFrame,
    ) -> Result<Vec<(SurfaceId, u64)>> {
        let mut surface_revisions = Vec::new();
        self.collect_surface_revisions_recursive(frame, &mut surface_revisions)?;
        Ok(surface_revisions)
    }

    fn collect_surface_revisions_recursive(
        &self,
        frame: &CompositorFrame,
        surface_revisions: &mut Vec<(SurfaceId, u64)>,
    ) -> Result<()> {
        for pass in frame.passes() {
            if let CompositorQuad::Surface(surface_id) = &pass.quad {
                let surface_frame = self
                    .surface_frame_cache
                    .get(surface_id)
                    .ok_or_else(|| anyhow!("missing cached surface frame for {surface_id:?}"))?;
                surface_revisions.push((*surface_id, surface_frame.content_revision));
                self.collect_surface_revisions_recursive(surface_frame.frame.as_ref(), surface_revisions)?;
            }
        }
        Ok(())
    }

    fn append_aggregated_pass(
        &self,
        pass: &CompositorRenderPass,
        output: &mut Vec<AggregatedRenderPass>,
    ) -> Result<()> {
        match &pass.quad {
            CompositorQuad::Empty => output.push(AggregatedRenderPass {
                color_load_op: pass.color_load_op,
                quad: AggregatedQuad::Empty,
            }),
            CompositorQuad::Content(content) => output.push(AggregatedRenderPass {
                color_load_op: pass.color_load_op,
                quad: AggregatedQuad::Content(*content),
            }),
            CompositorQuad::Surface(surface_id) => {
                let surface_frame = self
                    .surface_frame_cache
                    .get(surface_id)
                    .ok_or_else(|| anyhow!("missing cached surface frame for {surface_id:?}"))?;
                self.append_surface_frame(surface_frame.frame.as_ref(), pass.color_load_op, output)?;
            }
        }

        Ok(())
    }

    fn append_surface_frame(
        &self,
        frame: &CompositorFrame,
        inherited_load_op: ColorLoadOp,
        output: &mut Vec<AggregatedRenderPass>,
    ) -> Result<()> {
        if frame.passes().is_empty() {
            output.push(AggregatedRenderPass {
                color_load_op: inherited_load_op,
                quad: AggregatedQuad::Empty,
            });
            return Ok(());
        }

        let mut is_first_pass = true;
        for pass in frame.passes() {
            let color_load_op = if is_first_pass {
                inherited_load_op
            } else {
                pass.color_load_op
            };
            is_first_pass = false;

            match &pass.quad {
                CompositorQuad::Empty => output.push(AggregatedRenderPass {
                    color_load_op,
                    quad: AggregatedQuad::Empty,
                }),
                CompositorQuad::Content(content) => output.push(AggregatedRenderPass {
                    color_load_op,
                    quad: AggregatedQuad::Content(*content),
                }),
                CompositorQuad::Surface(surface_id) => {
                    let surface_frame =
                        self.surface_frame_cache.get(surface_id).ok_or_else(|| {
                            anyhow!("missing cached surface frame for {surface_id:?}")
                        })?;
                    self.append_surface_frame(
                        surface_frame.frame.as_ref(),
                        color_load_op,
                        output,
                    )?;
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::CompositorState;
    use crate::scene::frame::{AggregatedQuad, ColorLoadOp, RenderContent};
    use crate::scene::{
        Camera3DOptions, ColorValue, CompositionNode, Rect2DOptions, RenderModel, Scene2DOptions,
        Scene3DOptions, Triangle3DOptions,
    };

    #[test]
    fn recursive_composition_lowers_in_order() {
        let red = ColorValue {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0,
        };
        let blue = ColorValue {
            r: 0.0,
            g: 0.0,
            b: 1.0,
            a: 1.0,
        };

        let mut model = RenderModel::default();
        let scene_2d = model.create_scene_2d(Scene2DOptions { clear_color: red });
        let rect = model
            .scene_2d_create_rect(
                scene_2d.id,
                Rect2DOptions {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    color: red,
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("rect should be added");
        model
            .scene_2d_set_root_items(scene_2d.id, vec![rect.id])
            .expect("root item should be set");
        let scene_3d = model.create_scene_3d(Scene3DOptions {
            clear_color: blue,
            camera: Camera3DOptions::default(),
        });
        model
            .scene_3d_create_triangle(scene_3d.id, Triangle3DOptions {
                positions: [[0.0, 0.0, 0.0], [0.5, 0.0, 0.0], [0.0, 0.5, 0.0]],
                color: blue,
            })
            .expect("triangle should be added");
        model.presented_root = Some(CompositionNode::Stack {
            children: vec![
                CompositionNode::Scene2D {
                    scene_id: scene_2d.id,
                    clear: true,
                },
                CompositionNode::Scene3D {
                    scene_id: scene_3d.id,
                    clear: false,
                },
            ],
        });
        model.presented_root_revision = 1;

        let mut compositor = CompositorState::default();
        let frame = compositor
            .composite(&model)
            .expect("compositor should aggregate");
        assert_eq!(frame.passes().len(), 2);
        assert!(matches!(
            frame.passes()[0].color_load_op,
            ColorLoadOp::Clear(color) if color == red
        ));
        assert!(matches!(
            frame.passes()[0].quad,
            AggregatedQuad::Content(RenderContent::Scene2D(_))
        ));
        assert!(matches!(
            frame.passes()[1].quad,
            AggregatedQuad::Content(RenderContent::Scene3D(_))
        ));
    }
}
