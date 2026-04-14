use super::{
    ClipRectCommand, DirectMaskTextDrawCommand, DrawingRecorder, DrawingRecording, PathDrawCommand,
    RectDrawCommand, SdfTextDrawCommand, TransformedMaskTextDrawCommand,
};
use crate::scene::{
    PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, RenderModel, Text2D,
};

fn multiply_affine_transforms(left: [f32; 6], right: [f32; 6]) -> [f32; 6] {
    [
        (left[0] * right[0]) + (left[2] * right[1]),
        (left[1] * right[0]) + (left[3] * right[1]),
        (left[0] * right[2]) + (left[2] * right[3]),
        (left[1] * right[2]) + (left[3] * right[3]),
        (left[0] * right[4]) + (left[2] * right[5]) + left[4],
        (left[1] * right[4]) + (left[3] * right[5]) + left[5],
    ]
}

fn record_item_list_2d(
    recorder: &mut DrawingRecorder,
    model: &RenderModel,
    item_ids: &[u32],
    inherited_transform: [f32; 6],
) {
    for item_id in item_ids {
        record_item_2d(recorder, model, *item_id, inherited_transform);
    }
}

fn record_item_2d(
    recorder: &mut DrawingRecorder,
    model: &RenderModel,
    item_id: u32,
    inherited_transform: [f32; 6],
) {
    if let Some(rect) = model.rects_2d.get(&item_id) {
        recorder.fill_rect(RectDrawCommand {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            color: rect.color,
            transform: multiply_affine_transforms(inherited_transform, rect.transform),
        });
        return;
    }

    if let Some(path) = model.paths_2d.get(&item_id) {
        recorder.draw_path(PathDrawCommand {
            x: path.x,
            y: path.y,
            verbs: path.verbs.clone(),
            fill_rule: path.fill_rule,
            style: path.style,
            color: path.color,
            shader: path.shader.clone(),
            stroke_width: path.stroke_width,
            stroke_join: path.stroke_join,
            stroke_cap: path.stroke_cap,
            dash_array: path.dash_array.clone(),
            dash_offset: path.dash_offset,
            transform: multiply_affine_transforms(inherited_transform, path.transform),
        });
        return;
    }

    if let Some(text) = model.texts_2d.get(&item_id) {
        record_text_2d(recorder, text, inherited_transform);
        return;
    }

    if let Some(group) = model.groups_2d.get(&item_id) {
        let next_transform = multiply_affine_transforms(inherited_transform, group.transform);
        record_item_list_2d(recorder, model, &group.child_item_ids, next_transform);
        return;
    }

    if let Some(scroll_container) = model.scroll_containers_2d.get(&item_id) {
        let viewport_transform =
            multiply_affine_transforms(inherited_transform, scroll_container.transform);
        recorder.push_clip_rect(ClipRectCommand {
            x: 0.0,
            y: 0.0,
            width: scroll_container.width.max(0.0),
            height: scroll_container.height.max(0.0),
            transform: viewport_transform,
        });
        let content_transform = multiply_affine_transforms(
            viewport_transform,
            [
                1.0,
                0.0,
                0.0,
                1.0,
                -scroll_container.scroll_x,
                -scroll_container.scroll_y,
            ],
        );
        record_item_list_2d(
            recorder,
            model,
            &scroll_container.child_item_ids,
            content_transform,
        );
        recorder.pop_clip();
    }
}

fn record_text_2d(recorder: &mut DrawingRecorder, text: &Text2D, inherited_transform: [f32; 6]) {
    match text {
        Text2D::DirectMask {
            x,
            y,
            color,
            glyphs,
            transform,
            ..
        } => recorder.draw_direct_mask_text(DirectMaskTextDrawCommand {
            x: *x,
            y: *y,
            color: *color,
            glyphs: glyphs.clone(),
            transform: multiply_affine_transforms(inherited_transform, *transform),
        }),
        Text2D::TransformedMask {
            x,
            y,
            color,
            glyphs,
            transform,
            ..
        } => recorder.draw_transformed_mask_text(TransformedMaskTextDrawCommand {
            x: *x,
            y: *y,
            color: *color,
            glyphs: glyphs.clone(),
            transform: multiply_affine_transforms(inherited_transform, *transform),
        }),
        Text2D::Sdf {
            x,
            y,
            color,
            glyphs,
            transform,
            ..
        } => recorder.draw_sdf_text(SdfTextDrawCommand {
            x: *x,
            y: *y,
            color: *color,
            glyphs: glyphs.clone(),
            transform: multiply_affine_transforms(inherited_transform, *transform),
        }),
        Text2D::Path {
            x,
            y,
            color,
            glyphs,
            transform,
            ..
        } => {
            for glyph in glyphs {
                recorder.draw_path(PathDrawCommand {
                    x: *x + glyph.x,
                    y: *y + glyph.y,
                    verbs: glyph.verbs.clone(),
                    fill_rule: PathFillRule2D::Nonzero,
                    style: PathStyle2D::Fill,
                    color: *color,
                    shader: None,
                    stroke_width: 1.0,
                    stroke_join: PathStrokeJoin2D::Miter,
                    stroke_cap: PathStrokeCap2D::Butt,
                    dash_array: Vec::new(),
                    dash_offset: 0.0,
                    transform: multiply_affine_transforms(inherited_transform, *transform),
                });
            }
        }
        Text2D::Composite { runs, .. } => {
            for run in runs {
                record_text_2d(recorder, run, inherited_transform);
            }
        }
    }
}

pub(crate) fn lower_scene_2d_to_recording(
    model: &RenderModel,
    root_item_ids: &[u32],
    device_pixel_ratio: f32,
) -> DrawingRecording {
    let mut recorder = DrawingRecorder::new();
    let root_transform = [device_pixel_ratio, 0.0, 0.0, device_pixel_ratio, 0.0, 0.0];
    record_item_list_2d(&mut recorder, model, root_item_ids, root_transform);
    recorder.finish()
}

#[cfg(test)]
mod tests {
    use super::lower_scene_2d_to_recording;
    use crate::scene::content_2d::compute_recording_bounds;
    use crate::scene::{
        ColorValue, Rect2DOptions, RenderModel, Scene2DOptions, ScrollContainer2DOptions,
    };

    #[test]
    fn scroll_container_applies_viewport_clip_and_scroll_offset() {
        let mut model = RenderModel::default();
        let scene = model.create_scene_2d(Scene2DOptions {
            clear_color: ColorValue::default(),
        });
        let rect = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 1.0,
                    y: 2.0,
                    width: 20.0,
                    height: 20.0,
                    color: ColorValue {
                        r: 1.0,
                        g: 0.0,
                        b: 0.0,
                        a: 1.0,
                    },
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("create rect");
        let scroll_container = model
            .scene_2d_create_scroll_container(
                scene.id,
                ScrollContainer2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 5.0, 7.0],
                    width: 10.0,
                    height: 10.0,
                    scroll_x: 3.0,
                    scroll_y: 4.0,
                },
            )
            .expect("create scroll container");
        model
            .scroll_container_2d_set_children(scroll_container.id, vec![rect.id])
            .expect("set scroll container children");

        let recording = lower_scene_2d_to_recording(&model, &[scroll_container.id], 1.0);
        let bounds = compute_recording_bounds(&recording).expect("recording bounds");
        assert_eq!(bounds.left, 5.0);
        assert_eq!(bounds.top, 7.0);
        assert_eq!(bounds.right, 15.0);
        assert_eq!(bounds.bottom, 17.0);
    }
}
