use anyhow::{anyhow, Result};

use super::frame_graph::{ColorLoadOp, DrawPass, DrawPayload, FrameGraph};
use super::lowering_3d::lower_scene_3d_to_geometry;
use super::render::ColorValue;
use super::{CompositionNode, RenderModel};

pub(crate) fn build_presented_frame_graph(
    model: &RenderModel,
    device_pixel_ratio: f32,
) -> Result<FrameGraph> {
    let mut frame_graph = FrameGraph::new();

    match model.presented_root.as_ref() {
        Some(root) => append_node_passes(&mut frame_graph, root, model, device_pixel_ratio)?,
        None => frame_graph.push_clear(ColorValue::default()),
    }

    Ok(frame_graph)
}

fn append_node_passes(
    frame_graph: &mut FrameGraph,
    node: &CompositionNode,
    model: &RenderModel,
    device_pixel_ratio: f32,
) -> Result<()> {
    match node {
        CompositionNode::Stack { children } => {
            for child in children {
                append_node_passes(frame_graph, child, model, device_pixel_ratio)?;
            }
        }
        CompositionNode::Scene2D { scene_id, clear } => {
            let scene = model
                .scenes_2d
                .get(scene_id)
                .ok_or_else(|| anyhow!("missing presented 2D scene {scene_id}"))?;
            let recording = model.scene_2d_recording(*scene_id, device_pixel_ratio)?;
            if *clear || !recording.is_empty() {
                frame_graph.push_draw(DrawPass {
                    color_load_op: if *clear {
                        ColorLoadOp::Clear(scene.clear_color)
                    } else {
                        ColorLoadOp::Load
                    },
                    payload: DrawPayload::VectorRecording(recording),
                });
            }
        }
        CompositionNode::Scene3D { scene_id, clear } => {
            let scene = model
                .scenes_3d
                .get(scene_id)
                .ok_or_else(|| anyhow!("missing presented 3D scene {scene_id}"))?;
            frame_graph.push_draw(DrawPass {
                color_load_op: if *clear {
                    ColorLoadOp::Clear(scene.clear_color)
                } else {
                    ColorLoadOp::Load
                },
                payload: DrawPayload::ClipSpaceGeometry(lower_scene_3d_to_geometry(model, scene)),
            });
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::frame_graph::DrawPass;
    use super::build_presented_frame_graph;
    use crate::scene::render::{Camera3DOptions, ColorValue, Scene2DOptions, Scene3DOptions};
    use crate::scene::{ColorLoadOp, CompositionNode, DrawPayload, FrameGraphPass, RenderModel};

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
        let scene_3d = model.create_scene_3d(Scene3DOptions {
            clear_color: blue,
            camera: Camera3DOptions::default(),
        });
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

        let frame_graph =
            build_presented_frame_graph(&model, 1.0).expect("frame graph should lower");
        assert_eq!(frame_graph.passes().len(), 2);
        match &frame_graph.passes()[0] {
            FrameGraphPass::Draw(pass) => {
                assert!(matches!(pass.color_load_op, ColorLoadOp::Clear(color) if color == red));
                assert!(matches!(pass.payload, DrawPayload::VectorRecording(_)));
            }
            other => panic!("expected vector draw pass, got {other:?}"),
        }
        assert!(matches!(
            &frame_graph.passes()[1],
            FrameGraphPass::Draw(DrawPass {
                color_load_op: ColorLoadOp::Load,
                payload: DrawPayload::ClipSpaceGeometry(_),
            })
        ));
    }
}
