use std::sync::Arc;

use anyhow::Result;

use super::composition::RootFrameCacheKey;
use super::frame::{
    AggregatedFrame, AggregatedQuad, AggregatedRenderPass, ColorLoadOp, CompositorFrame,
    CompositorQuad, CompositorRenderPass, SurfaceId,
};
use super::surfaces::SurfaceStore;

#[derive(Clone, Debug, PartialEq, Eq)]
struct AggregatedFrameCacheKey {
    root: RootFrameCacheKey,
    surface_revisions: Vec<(SurfaceId, u64)>,
}

#[derive(Default)]
pub(crate) struct FrameAggregator {
    aggregated_frame_cache: Option<(AggregatedFrameCacheKey, Arc<AggregatedFrame>)>,
}

impl FrameAggregator {
    pub(crate) fn aggregate(
        &mut self,
        root_key: RootFrameCacheKey,
        root_frame: Arc<CompositorFrame>,
        surfaces: &SurfaceStore,
    ) -> Result<Arc<AggregatedFrame>> {
        let surface_revisions = surfaces.collect_revisions(root_frame.as_ref())?;
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
            append_aggregated_pass(pass, surfaces, &mut passes)?;
        }
        let aggregated_frame = Arc::new(AggregatedFrame::from_passes(passes));
        self.aggregated_frame_cache = Some((aggregated_key, aggregated_frame.clone()));
        Ok(aggregated_frame)
    }
}

fn append_aggregated_pass(
    pass: &CompositorRenderPass,
    surfaces: &SurfaceStore,
    output: &mut Vec<AggregatedRenderPass>,
) -> Result<()> {
    match &pass.quad {
        CompositorQuad::Empty => output.push(AggregatedRenderPass {
            color_load_op: pass.color_load_op,
            quad: AggregatedQuad::Empty,
        }),
        CompositorQuad::RetainedSurface(quad) => output.push(AggregatedRenderPass {
            color_load_op: pass.color_load_op,
            quad: AggregatedQuad::RetainedSurface(*quad),
        }),
        CompositorQuad::Content(content) => output.push(AggregatedRenderPass {
            color_load_op: pass.color_load_op,
            quad: AggregatedQuad::Content(*content),
        }),
        CompositorQuad::SurfaceRef(surface_id) => {
            let surface_frame = surfaces.get(*surface_id)?;
            append_surface_frame(
                surface_frame.frame.as_ref(),
                pass.color_load_op,
                surfaces,
                output,
            )?;
        }
    }

    Ok(())
}

fn append_surface_frame(
    frame: &CompositorFrame,
    inherited_load_op: ColorLoadOp,
    surfaces: &SurfaceStore,
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
            CompositorQuad::RetainedSurface(quad) => output.push(AggregatedRenderPass {
                color_load_op,
                quad: AggregatedQuad::RetainedSurface(*quad),
            }),
            CompositorQuad::Content(content) => output.push(AggregatedRenderPass {
                color_load_op,
                quad: AggregatedQuad::Content(*content),
            }),
            CompositorQuad::SurfaceRef(surface_id) => {
                let surface_frame = surfaces.get(*surface_id)?;
                append_surface_frame(
                    surface_frame.frame.as_ref(),
                    color_load_op,
                    surfaces,
                    output,
                )?;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::FrameAggregator;
    use crate::scene::composition::RootComposer;
    use crate::scene::frame::{AggregatedQuad, ColorLoadOp, RenderContent, SurfaceId};
    use crate::scene::surfaces::SurfaceStore;
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
            .scene_3d_create_triangle(
                scene_3d.id,
                Triangle3DOptions {
                    positions: [[0.0, 0.0, 0.0], [0.5, 0.0, 0.0], [0.0, 0.5, 0.0]],
                    color: blue,
                },
            )
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

        let mut root_composer = RootComposer::default();
        let mut surface_store = SurfaceStore::default();
        let mut frame_aggregator = FrameAggregator::default();
        surface_store
            .ensure_scene_2d_surface(&model, scene_2d.id, 1.0)
            .expect("scene 2d surface");
        surface_store
            .ensure_scene_3d_surface(&model, scene_3d.id)
            .expect("scene 3d surface");
        let (root_key, root_frame) = root_composer
            .compose(&model)
            .expect("root composition should succeed");
        let frame = frame_aggregator
            .aggregate(root_key, root_frame, &surface_store)
            .expect("aggregator should flatten surfaces");
        assert_eq!(frame.passes().len(), 2);
        assert!(matches!(
            frame.passes()[0].color_load_op,
            ColorLoadOp::Clear(color) if color == red
        ));
        assert!(matches!(
            frame.passes()[0].quad,
            AggregatedQuad::Content(RenderContent::SurfaceRecording {
                surface_id: SurfaceId::Scene2D(id),
                recording_index: 0,
            }) if id == scene_2d.id
        ));
        assert!(matches!(
            frame.passes()[1].quad,
            AggregatedQuad::Content(RenderContent::Scene3D(_))
        ));
    }
}
