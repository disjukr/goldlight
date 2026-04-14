use glam::{Mat4, Vec4};

use super::color::to_linear_array;
use crate::scene::frame::ClipSpaceVertex;
use crate::scene::{RenderModel, Scene3D};

pub(crate) fn lower_scene_3d_to_geometry(
    model: &RenderModel,
    scene: &Scene3D,
) -> Vec<ClipSpaceVertex> {
    let view_projection = Mat4::from_cols_array(&scene.camera.view_projection_matrix);

    let mut vertices = Vec::new();
    for triangle_id in &scene.triangle_ids {
        let Some(triangle) = model.triangles_3d.get(triangle_id) else {
            continue;
        };
        let _ = triangle.scene_id;
        let color = to_linear_array(triangle.color);
        for position in triangle.positions {
            let clip = view_projection * Vec4::new(position[0], position[1], position[2], 1.0);
            vertices.push(ClipSpaceVertex {
                position: clip.to_array(),
                color,
            });
        }
    }
    vertices
}
