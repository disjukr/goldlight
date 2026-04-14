use super::drawing::{
    DirectMaskTextDrawCommand, DrawingRecorder, DrawingRecording, PathDrawCommand, RectDrawCommand,
    SdfTextDrawCommand, TransformedMaskTextDrawCommand,
};
use super::{
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
