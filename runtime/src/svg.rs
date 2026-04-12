use anyhow::Result;
use serde::Serialize;
use usvg::{FillRule, Node, Paint, Tree};

use crate::render::{
    ColorValue, Path2DOptions, PathFillRule2D, PathStrokeCap2D, PathStrokeJoin2D, PathStyle2D,
    PathVerb2D,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgSizeValue {
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgSceneValue {
    pub size: SvgSizeValue,
    pub paths: Vec<Path2DOptions>,
}

pub fn parse_svg(svg: &str) -> Result<SvgSceneValue> {
    let options = usvg::Options::default();
    let tree = Tree::from_str(svg, &options)?;
    let mut paths = Vec::new();
    collect_group_paths(tree.root(), &mut paths)?;
    let size = tree.size();
    Ok(SvgSceneValue {
        size: SvgSizeValue {
            width: size.width(),
            height: size.height(),
        },
        paths,
    })
}

fn collect_group_paths(group: &usvg::Group, output: &mut Vec<Path2DOptions>) -> Result<()> {
    for child in group.children() {
        match child {
            Node::Group(group) => collect_group_paths(group, output)?,
            Node::Path(path) => append_path(path, output)?,
            _ => {}
        }
    }
    Ok(())
}

fn append_path(path: &usvg::Path, output: &mut Vec<Path2DOptions>) -> Result<()> {
    let verbs = path
        .data()
        .segments()
        .map(|segment| match segment {
            usvg::tiny_skia_path::PathSegment::MoveTo(point) => PathVerb2D::MoveTo {
                to: [point.x, point.y],
            },
            usvg::tiny_skia_path::PathSegment::LineTo(point) => PathVerb2D::LineTo {
                to: [point.x, point.y],
            },
            usvg::tiny_skia_path::PathSegment::QuadTo(control, point) => PathVerb2D::QuadTo {
                control: [control.x, control.y],
                to: [point.x, point.y],
            },
            usvg::tiny_skia_path::PathSegment::CubicTo(control1, control2, point) => {
                PathVerb2D::CubicTo {
                    control1: [control1.x, control1.y],
                    control2: [control2.x, control2.y],
                    to: [point.x, point.y],
                }
            }
            usvg::tiny_skia_path::PathSegment::Close => PathVerb2D::Close,
        })
        .collect::<Vec<_>>();

    if verbs.is_empty() {
        return Ok(());
    }

    let transformed_verbs = transform_verbs(&verbs, path.abs_transform());

    if let Some(fill) = path.fill() {
        if let Some(color) = resolve_paint_color(fill.paint(), fill.opacity().get()) {
            output.push(Path2DOptions {
                x: 0.0,
                y: 0.0,
                verbs: transformed_verbs.clone(),
                fill_rule: match fill.rule() {
                    FillRule::NonZero => PathFillRule2D::Nonzero,
                    FillRule::EvenOdd => PathFillRule2D::Evenodd,
                },
                style: PathStyle2D::Fill,
                color,
                shader: None,
                stroke_width: 1.0,
                stroke_join: PathStrokeJoin2D::Miter,
                stroke_cap: PathStrokeCap2D::Butt,
                dash_array: Vec::new(),
                dash_offset: 0.0,
            });
        }
    }

    if let Some(stroke) = path.stroke() {
        if let Some(color) = resolve_paint_color(stroke.paint(), stroke.opacity().get()) {
            let scale = transform_stroke_scale(path.abs_transform());
            output.push(Path2DOptions {
                x: 0.0,
                y: 0.0,
                verbs: transformed_verbs,
                fill_rule: PathFillRule2D::Nonzero,
                style: PathStyle2D::Stroke,
                color,
                shader: None,
                stroke_width: stroke.width().get() * scale,
                stroke_join: match stroke.linejoin() {
                    usvg::LineJoin::Miter => PathStrokeJoin2D::Miter,
                    usvg::LineJoin::MiterClip => PathStrokeJoin2D::Miter,
                    usvg::LineJoin::Round => PathStrokeJoin2D::Round,
                    usvg::LineJoin::Bevel => PathStrokeJoin2D::Bevel,
                },
                stroke_cap: match stroke.linecap() {
                    usvg::LineCap::Butt => PathStrokeCap2D::Butt,
                    usvg::LineCap::Round => PathStrokeCap2D::Round,
                    usvg::LineCap::Square => PathStrokeCap2D::Square,
                },
                dash_array: stroke
                    .dasharray()
                    .map(|dash_array| dash_array.iter().map(|value| *value * scale).collect())
                    .unwrap_or_default(),
                dash_offset: stroke.dashoffset() * scale,
            });
        }
    }

    Ok(())
}

fn resolve_paint_color(paint: &Paint, opacity: f32) -> Option<ColorValue> {
    match paint {
        Paint::Color(color) => Some(ColorValue {
            r: f32::from(color.red) / 255.0,
            g: f32::from(color.green) / 255.0,
            b: f32::from(color.blue) / 255.0,
            a: opacity,
        }),
        _ => None,
    }
}

fn transform_verbs(verbs: &[PathVerb2D], transform: usvg::tiny_skia_path::Transform) -> Vec<PathVerb2D> {
    let mut transformed = Vec::new();
    for verb in verbs {
        append_transformed_verb(&mut transformed, verb, transform);
    }
    transformed
}

fn append_transformed_verb(
    output: &mut Vec<PathVerb2D>,
    verb: &PathVerb2D,
    transform: usvg::tiny_skia_path::Transform,
) {
    let transformed = match verb {
        PathVerb2D::MoveTo { to } => PathVerb2D::MoveTo {
            to: map_point(*to, transform),
        },
        PathVerb2D::LineTo { to } => PathVerb2D::LineTo {
            to: map_point(*to, transform),
        },
        PathVerb2D::QuadTo { control, to } => PathVerb2D::QuadTo {
            control: map_point(*control, transform),
            to: map_point(*to, transform),
        },
        PathVerb2D::ConicTo {
            control,
            to,
            weight,
        } => PathVerb2D::ConicTo {
            control: map_point(*control, transform),
            to: map_point(*to, transform),
            weight: *weight,
        },
        PathVerb2D::CubicTo {
            control1,
            control2,
            to,
        } => PathVerb2D::CubicTo {
            control1: map_point(*control1, transform),
            control2: map_point(*control2, transform),
            to: map_point(*to, transform),
        },
        PathVerb2D::ArcTo {
            center,
            radius,
            start_angle,
            end_angle,
            counter_clockwise,
        } => {
            for segment in arc_to_conic_verbs(
                *center,
                *radius,
                *start_angle,
                *end_angle,
                *counter_clockwise,
            ) {
                append_transformed_verb(output, &segment, transform);
            }
            return;
        }
        PathVerb2D::Close => PathVerb2D::Close,
    };
    output.push(transformed);
}

fn arc_to_conic_verbs(
    center: [f32; 2],
    radius: f32,
    start_angle: f32,
    end_angle: f32,
    counter_clockwise: bool,
) -> Vec<PathVerb2D> {
    let turn = std::f32::consts::PI * 2.0;
    let mut sweep = end_angle - start_angle;
    if counter_clockwise {
        while sweep <= 0.0 {
            sweep += turn;
        }
    } else {
        while sweep >= 0.0 {
            sweep -= turn;
        }
    }

    let segment_count = ((sweep.abs() / (std::f32::consts::PI / 2.0)).ceil() as usize).max(1);
    let segment_sweep = sweep / segment_count as f32;
    let mut verbs = Vec::with_capacity(segment_count);
    for index in 0..segment_count {
        let theta0 = start_angle + segment_sweep * index as f32;
        let theta1 = theta0 + segment_sweep;
        let theta_mid = (theta0 + theta1) * 0.5;
        let half_sweep = segment_sweep * 0.5;
        let weight = half_sweep.cos();
        let end = [
            center[0] + theta1.cos() * radius,
            center[1] + theta1.sin() * radius,
        ];
        let control_distance = radius / weight.max(f32::EPSILON);
        let control = [
            center[0] + theta_mid.cos() * control_distance,
            center[1] + theta_mid.sin() * control_distance,
        ];
        let _start = [
            center[0] + theta0.cos() * radius,
            center[1] + theta0.sin() * radius,
        ];
        verbs.push(PathVerb2D::ConicTo {
            control,
            to: end,
            weight,
        });
    }
    verbs
}

fn map_point(point: [f32; 2], transform: usvg::tiny_skia_path::Transform) -> [f32; 2] {
    let mut mapped = usvg::tiny_skia_path::Point::from_xy(point[0], point[1]);
    transform.map_point(&mut mapped);
    [mapped.x, mapped.y]
}

fn transform_stroke_scale(transform: usvg::tiny_skia_path::Transform) -> f32 {
    let scale_x = (transform.sx.powi(2) + transform.ky.powi(2)).sqrt();
    let scale_y = (transform.kx.powi(2) + transform.sy.powi(2)).sqrt();
    let scale = (scale_x + scale_y) * 0.5;
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}
