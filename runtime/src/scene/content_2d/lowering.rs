use std::mem;

use super::{
    compute_recording_bounds, ClipRectCommand, DirectMaskTextDrawCommand, DrawingRecorder,
    DrawingRecording, PathDrawCommand, RecordingBounds, RectDrawCommand, SdfTextDrawCommand,
    TransformedMaskTextDrawCommand,
};
use crate::scene::frame::{
    ColorLoadOp, CompositorFrame, CompositorQuad, CompositorRenderPass, RenderContent,
    RetainedSurfaceQuad, SurfaceId,
};
use crate::scene::{
    PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D, RenderModel, Text2D,
};

pub(crate) trait RetainedSurfaceProvider {
    fn ensure_group_surface_bounds(
        &mut self,
        model: &RenderModel,
        group_id: u32,
        device_pixel_ratio: f32,
    ) -> Option<RecordingBounds>;
}

#[derive(Clone, Debug)]
pub(crate) struct LoweredSurface {
    pub frame: CompositorFrame,
    pub recordings: Vec<DrawingRecording>,
    pub bounds: Option<RecordingBounds>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RetentionMode {
    #[cfg(test)]
    Inline,
    Retained,
}

enum LoweredSurfaceFragment {
    Recording(DrawingRecording),
    RetainedSurface(RetainedSurfaceQuad),
}

struct LoweringState<'a> {
    recorder: DrawingRecorder,
    fragments: Vec<LoweredSurfaceFragment>,
    bounds: Option<RecordingBounds>,
    device_pixel_ratio: f32,
    retention_mode: RetentionMode,
    retained_surface_provider: Option<&'a mut dyn RetainedSurfaceProvider>,
}

impl<'a> LoweringState<'a> {
    fn new(
        device_pixel_ratio: f32,
        retention_mode: RetentionMode,
        retained_surface_provider: Option<&'a mut dyn RetainedSurfaceProvider>,
    ) -> Self {
        Self {
            recorder: DrawingRecorder::new(),
            fragments: Vec::new(),
            bounds: None,
            device_pixel_ratio,
            retention_mode,
            retained_surface_provider,
        }
    }

    fn flush_recording_fragment(&mut self) {
        let recorder = mem::replace(&mut self.recorder, DrawingRecorder::new());
        let recording = recorder.finish();
        if recording.is_empty() {
            return;
        }
        merge_bounds(&mut self.bounds, compute_recording_bounds(&recording));
        self.fragments
            .push(LoweredSurfaceFragment::Recording(recording));
    }

    fn push_retained_surface(&mut self, quad: RetainedSurfaceQuad) {
        self.flush_recording_fragment();
        merge_bounds(
            &mut self.bounds,
            transformed_rect_bounds(
                0.0,
                0.0,
                quad.viewport_size[0].max(0.0),
                quad.viewport_size[1].max(0.0),
                quad.transform,
            ),
        );
        self.fragments
            .push(LoweredSurfaceFragment::RetainedSurface(quad));
    }

    fn resolve_group_surface_bounds(
        &mut self,
        model: &RenderModel,
        group_id: u32,
    ) -> Option<RecordingBounds> {
        if let Some(provider) = self.retained_surface_provider.as_deref_mut() {
            return provider.ensure_group_surface_bounds(model, group_id, self.device_pixel_ratio);
        }
        measure_group_2d_surface_bounds(model, group_id, self.device_pixel_ratio, None)
    }

    fn finish(mut self, surface_id: SurfaceId) -> LoweredSurface {
        self.flush_recording_fragment();
        let mut recordings = Vec::new();
        let mut passes = Vec::new();
        for fragment in self.fragments {
            match fragment {
                LoweredSurfaceFragment::Recording(recording) => {
                    let recording_index = recordings.len() as u32;
                    recordings.push(recording);
                    passes.push(CompositorRenderPass {
                        color_load_op: ColorLoadOp::Load,
                        quad: CompositorQuad::Content(RenderContent::SurfaceRecording {
                            surface_id,
                            recording_index,
                        }),
                    });
                }
                LoweredSurfaceFragment::RetainedSurface(quad) => {
                    passes.push(CompositorRenderPass {
                        color_load_op: ColorLoadOp::Load,
                        quad: CompositorQuad::RetainedSurface(quad),
                    });
                }
            }
        }
        LoweredSurface {
            frame: CompositorFrame::from_passes(passes),
            recordings,
            bounds: self.bounds,
        }
    }
}

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

fn surface_root_transform(device_pixel_ratio: f32, origin: [f32; 2]) -> [f32; 6] {
    [
        device_pixel_ratio,
        0.0,
        0.0,
        device_pixel_ratio,
        -origin[0],
        -origin[1],
    ]
}

fn record_item_list_2d(
    state: &mut LoweringState<'_>,
    model: &RenderModel,
    item_ids: &[u32],
    inherited_transform: [f32; 6],
) {
    for item_id in item_ids {
        record_item_2d(state, model, *item_id, inherited_transform);
    }
}

fn record_item_2d(
    state: &mut LoweringState<'_>,
    model: &RenderModel,
    item_id: u32,
    inherited_transform: [f32; 6],
) {
    if let Some(rect) = model.rects_2d.get(&item_id) {
        state.recorder.fill_rect(RectDrawCommand {
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
        state.recorder.draw_path(PathDrawCommand {
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
        record_text_2d(&mut state.recorder, text, inherited_transform);
        return;
    }

    if let Some(group) = model.groups_2d.get(&item_id) {
        if state.retention_mode == RetentionMode::Retained {
            let Some(bounds) = state.resolve_group_surface_bounds(model, item_id) else {
                return;
            };
            let source_origin = [
                bounds.left / state.device_pixel_ratio,
                bounds.top / state.device_pixel_ratio,
            ];
            let viewport_size = [
                (bounds.right - bounds.left) / state.device_pixel_ratio,
                (bounds.bottom - bounds.top) / state.device_pixel_ratio,
            ];
            if viewport_size[0] <= 0.0 || viewport_size[1] <= 0.0 {
                return;
            }
            let group_transform = multiply_affine_transforms(inherited_transform, group.transform);
            let transform = multiply_affine_transforms(
                group_transform,
                [1.0, 0.0, 0.0, 1.0, source_origin[0], source_origin[1]],
            );
            state.push_retained_surface(RetainedSurfaceQuad {
                surface_id: SurfaceId::Group2D(item_id),
                transform,
                viewport_size,
                source_origin,
                scroll_offset: [0.0, 0.0],
            });
            return;
        }
        let next_transform = multiply_affine_transforms(inherited_transform, group.transform);
        record_item_list_2d(state, model, &group.child_item_ids, next_transform);
        return;
    }

    if let Some(scroll_container) = model.scroll_containers_2d.get(&item_id) {
        let viewport_transform =
            multiply_affine_transforms(inherited_transform, scroll_container.transform);
        if state.retention_mode == RetentionMode::Retained {
            state.push_retained_surface(RetainedSurfaceQuad {
                surface_id: SurfaceId::ScrollContainer2D(item_id),
                transform: viewport_transform,
                viewport_size: [
                    scroll_container.width.max(0.0),
                    scroll_container.height.max(0.0),
                ],
                source_origin: [0.0, 0.0],
                scroll_offset: [scroll_container.scroll_x, scroll_container.scroll_y],
            });
            return;
        }

        state.recorder.push_clip_rect(ClipRectCommand {
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
        record_item_list_2d(state, model, &scroll_container.child_item_ids, content_transform);
        state.recorder.pop_clip();
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

fn lower_item_list_to_surface(
    model: &RenderModel,
    surface_id: SurfaceId,
    item_ids: &[u32],
    device_pixel_ratio: f32,
    root_transform: [f32; 6],
    retention_mode: RetentionMode,
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> LoweredSurface {
    let mut state = LoweringState::new(device_pixel_ratio, retention_mode, retained_surface_provider);
    record_item_list_2d(&mut state, model, item_ids, root_transform);
    state.finish(surface_id)
}

fn transform_point(point: [f32; 2], transform: [f32; 6]) -> [f32; 2] {
    [
        (transform[0] * point[0]) + (transform[2] * point[1]) + transform[4],
        (transform[1] * point[0]) + (transform[3] * point[1]) + transform[5],
    ]
}

fn transformed_rect_bounds(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    transform: [f32; 6],
) -> Option<RecordingBounds> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let mut bounds = RecordingBounds {
        left: f32::INFINITY,
        top: f32::INFINITY,
        right: f32::NEG_INFINITY,
        bottom: f32::NEG_INFINITY,
    };
    for point in [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
    ] {
        let transformed = transform_point(point, transform);
        bounds.left = bounds.left.min(transformed[0]);
        bounds.top = bounds.top.min(transformed[1]);
        bounds.right = bounds.right.max(transformed[0]);
        bounds.bottom = bounds.bottom.max(transformed[1]);
    }
    is_valid_bounds(bounds).then_some(bounds)
}

fn merge_bounds(bounds: &mut Option<RecordingBounds>, next: Option<RecordingBounds>) {
    let Some(next) = next else {
        return;
    };
    match bounds {
        Some(existing) => {
            existing.left = existing.left.min(next.left);
            existing.top = existing.top.min(next.top);
            existing.right = existing.right.max(next.right);
            existing.bottom = existing.bottom.max(next.bottom);
        }
        None => *bounds = Some(next),
    }
}

fn is_valid_bounds(bounds: RecordingBounds) -> bool {
    bounds.left.is_finite()
        && bounds.top.is_finite()
        && bounds.right.is_finite()
        && bounds.bottom.is_finite()
        && bounds.right > bounds.left
        && bounds.bottom > bounds.top
}

pub(crate) fn lower_scene_2d_surface(
    model: &RenderModel,
    scene_id: u32,
    device_pixel_ratio: f32,
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> LoweredSurface {
    let scene = model
        .scenes_2d
        .get(&scene_id)
        .expect("scene checked before lowering");
    lower_item_list_to_surface(
        model,
        SurfaceId::Scene2D(scene_id),
        &scene.root_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, [0.0, 0.0]),
        RetentionMode::Retained,
        retained_surface_provider,
    )
}

pub(crate) fn measure_group_2d_surface_bounds(
    model: &RenderModel,
    group_id: u32,
    device_pixel_ratio: f32,
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> Option<RecordingBounds> {
    let group = model
        .groups_2d
        .get(&group_id)
        .expect("group checked before lowering");
    lower_item_list_to_surface(
        model,
        SurfaceId::Group2D(group_id),
        &group.child_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, [0.0, 0.0]),
        RetentionMode::Retained,
        retained_surface_provider,
    )
    .bounds
}

pub(crate) fn lower_group_2d_surface(
    model: &RenderModel,
    group_id: u32,
    device_pixel_ratio: f32,
    origin: [f32; 2],
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> LoweredSurface {
    let group = model
        .groups_2d
        .get(&group_id)
        .expect("group checked before lowering");
    lower_item_list_to_surface(
        model,
        SurfaceId::Group2D(group_id),
        &group.child_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, origin),
        RetentionMode::Retained,
        retained_surface_provider,
    )
}

pub(crate) fn measure_scroll_container_2d_surface_bounds(
    model: &RenderModel,
    scroll_container_id: u32,
    device_pixel_ratio: f32,
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> Option<RecordingBounds> {
    let scroll_container = model
        .scroll_containers_2d
        .get(&scroll_container_id)
        .expect("scroll container checked before lowering");
    lower_item_list_to_surface(
        model,
        SurfaceId::ScrollContainer2D(scroll_container_id),
        &scroll_container.child_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, [0.0, 0.0]),
        RetentionMode::Retained,
        retained_surface_provider,
    )
    .bounds
}

pub(crate) fn lower_scroll_container_2d_surface(
    model: &RenderModel,
    scroll_container_id: u32,
    device_pixel_ratio: f32,
    origin: [f32; 2],
    retained_surface_provider: Option<&mut dyn RetainedSurfaceProvider>,
) -> LoweredSurface {
    let scroll_container = model
        .scroll_containers_2d
        .get(&scroll_container_id)
        .expect("scroll container checked before lowering");
    lower_item_list_to_surface(
        model,
        SurfaceId::ScrollContainer2D(scroll_container_id),
        &scroll_container.child_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, origin),
        RetentionMode::Retained,
        retained_surface_provider,
    )
}

#[cfg(test)]
pub(crate) fn lower_scene_2d_to_recording(
    model: &RenderModel,
    root_item_ids: &[u32],
    device_pixel_ratio: f32,
) -> DrawingRecording {
    lower_item_list_to_surface(
        model,
        SurfaceId::Scene2D(0),
        root_item_ids,
        device_pixel_ratio,
        surface_root_transform(device_pixel_ratio, [0.0, 0.0]),
        RetentionMode::Inline,
        None,
    )
    .recordings
    .into_iter()
    .next()
    .unwrap_or_else(|| DrawingRecorder::new().finish())
}

#[cfg(test)]
mod tests {
    use super::{
        lower_scene_2d_surface, lower_scene_2d_to_recording, measure_scroll_container_2d_surface_bounds,
    };
    use crate::scene::content_2d::compute_recording_bounds;
    use crate::scene::frame::{CompositorQuad, RenderContent, RetainedSurfaceQuad, SurfaceId};
    use crate::scene::{
        ColorValue, Group2DOptions, Rect2DOptions, RenderModel, Scene2DOptions,
        ScrollContainer2DOptions,
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

    #[test]
    fn retained_scene_surface_splits_content_around_scroll_container() {
        let mut model = RenderModel::default();
        let scene = model.create_scene_2d(Scene2DOptions {
            clear_color: ColorValue::default(),
        });
        let before = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("before rect");
        let after = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 30.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("after rect");
        let scroll_container = model
            .scene_2d_create_scroll_container(
                scene.id,
                ScrollContainer2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 12.0, 0.0],
                    width: 16.0,
                    height: 16.0,
                    scroll_x: 5.0,
                    scroll_y: 0.0,
                },
            )
            .expect("scroll container");
        model
            .scene_2d_set_root_items(scene.id, vec![before.id, scroll_container.id, after.id])
            .expect("root items");

        let lowered = lower_scene_2d_surface(&model, scene.id, 1.0, None);
        assert_eq!(lowered.recordings.len(), 2);
        assert_eq!(lowered.frame.passes().len(), 3);
        assert!(matches!(
            lowered.frame.passes()[0].quad,
            CompositorQuad::Content(RenderContent::SurfaceRecording {
                surface_id: SurfaceId::Scene2D(id),
                recording_index: 0,
            }) if id == scene.id
        ));
        assert!(matches!(
            lowered.frame.passes()[1].quad,
            CompositorQuad::RetainedSurface(_)
        ));
        assert!(matches!(
            lowered.frame.passes()[2].quad,
            CompositorQuad::Content(RenderContent::SurfaceRecording {
                surface_id: SurfaceId::Scene2D(id),
                recording_index: 1,
            }) if id == scene.id
        ));
    }

    #[test]
    fn retained_scene_surface_splits_content_around_group() {
        let mut model = RenderModel::default();
        let scene = model.create_scene_2d(Scene2DOptions {
            clear_color: ColorValue::default(),
        });
        let before = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("before rect");
        let after = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 80.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("after rect");
        let inside = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 30.0,
                    y: 40.0,
                    width: 12.0,
                    height: 14.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("inside rect");
        let group = model
            .scene_2d_create_group(
                scene.id,
                Group2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 5.0, 7.0],
                },
            )
            .expect("group");
        model
            .group_2d_set_children(group.id, vec![inside.id])
            .expect("group children");
        model
            .scene_2d_set_root_items(scene.id, vec![before.id, group.id, after.id])
            .expect("root items");

        let lowered = lower_scene_2d_surface(&model, scene.id, 1.0, None);
        assert_eq!(lowered.recordings.len(), 2);
        assert_eq!(lowered.frame.passes().len(), 3);
        assert!(matches!(
            lowered.frame.passes()[0].quad,
            CompositorQuad::Content(RenderContent::SurfaceRecording {
                surface_id: SurfaceId::Scene2D(id),
                recording_index: 0,
            }) if id == scene.id
        ));
        assert!(matches!(
            lowered.frame.passes()[1].quad,
            CompositorQuad::RetainedSurface(RetainedSurfaceQuad {
                surface_id: SurfaceId::Group2D(id),
                transform,
                viewport_size,
                source_origin,
                scroll_offset,
            }) if id == group.id
                && transform == [1.0, 0.0, 0.0, 1.0, 35.0, 47.0]
                && viewport_size == [12.0, 14.0]
                && source_origin == [30.0, 40.0]
                && scroll_offset == [0.0, 0.0]
        ));
        assert!(matches!(
            lowered.frame.passes()[2].quad,
            CompositorQuad::Content(RenderContent::SurfaceRecording {
                surface_id: SurfaceId::Scene2D(id),
                recording_index: 1,
            }) if id == scene.id
        ));
    }

    #[test]
    fn measured_scroll_surface_bounds_include_children() {
        let mut model = RenderModel::default();
        let scene = model.create_scene_2d(Scene2DOptions {
            clear_color: ColorValue::default(),
        });
        let rect = model
            .scene_2d_create_rect(
                scene.id,
                Rect2DOptions {
                    x: 25.0,
                    y: 30.0,
                    width: 10.0,
                    height: 12.0,
                    color: ColorValue::default(),
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                },
            )
            .expect("rect");
        let scroll_container = model
            .scene_2d_create_scroll_container(
                scene.id,
                ScrollContainer2DOptions {
                    transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                    width: 16.0,
                    height: 16.0,
                    scroll_x: 0.0,
                    scroll_y: 0.0,
                },
            )
            .expect("scroll container");
        model
            .scroll_container_2d_set_children(scroll_container.id, vec![rect.id])
            .expect("children");

        let bounds =
            measure_scroll_container_2d_surface_bounds(&model, scroll_container.id, 1.0, None)
                .expect("bounds");
        assert_eq!(bounds.left, 25.0);
        assert_eq!(bounds.top, 30.0);
        assert_eq!(bounds.right, 35.0);
        assert_eq!(bounds.bottom, 42.0);
    }
}
