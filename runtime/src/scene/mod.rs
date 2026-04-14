mod compositor;
pub(crate) mod drawing;
mod frame_graph;
mod lowering_2d;
mod lowering_3d;
pub(crate) mod render;

pub(crate) use self::compositor::build_presented_frame_graph;
pub(crate) use self::frame_graph::{ClipSpaceVertex, ColorLoadOp, DrawPayload, FrameGraphPass};

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use serde::Deserialize;

use self::drawing::DrawingRecording;
use self::lowering_2d::lower_scene_2d_to_recording;
use self::render::{
    ColorValue, GlyphMask2DOptions, Group2DHandle, Group2DOptions, Group2DUpdate, Path2DHandle,
    Path2DOptions, Path2DUpdate, PathFillRule2D, PathShader2D, PathStrokeCap2D, PathStrokeJoin2D,
    PathStyle2D, PathVerb2D, Rect2DHandle, Rect2DOptions, Rect2DUpdate, Scene2DHandle,
    Scene2DOptions, Scene3DHandle, Scene3DOptions, SceneCameraUpdate, SceneClearColorOptions,
    Text2DHandle, Text2DOptions, Text2DUpdate, Triangle3DHandle, Triangle3DOptions,
    Triangle3DUpdate,
};

#[derive(Clone, Debug)]
pub(crate) struct Rect2D {
    pub _scene_id: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub color: ColorValue,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub(crate) struct Path2D {
    pub _scene_id: u32,
    pub x: f32,
    pub y: f32,
    pub verbs: Vec<PathVerb2D>,
    pub fill_rule: PathFillRule2D,
    pub style: PathStyle2D,
    pub color: ColorValue,
    pub shader: Option<PathShader2D>,
    pub stroke_width: f32,
    pub stroke_join: PathStrokeJoin2D,
    pub stroke_cap: PathStrokeCap2D,
    pub dash_array: Vec<f32>,
    pub dash_offset: f32,
    pub transform: [f32; 6],
}

#[derive(Clone, Debug)]
pub(crate) struct GlyphMask2D {
    pub _cache_key: String,
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub _format: String,
    pub offset_x: i32,
    pub offset_y: i32,
    pub pixels: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct DirectMaskGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub mask: Option<GlyphMask2D>,
}

#[derive(Clone, Debug)]
pub(crate) struct TransformedMaskGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub mask: Option<GlyphMask2D>,
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct SdfGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub _mask: Option<GlyphMask2D>,
    pub sdf: Option<GlyphMask2D>,
    pub sdf_inset: u32,
    pub _sdf_radius: f32,
    pub strike_to_source_scale: f32,
}

#[derive(Clone, Debug)]
pub(crate) struct PathTextGlyph2D {
    pub _glyph_id: u32,
    pub x: f32,
    pub y: f32,
    pub verbs: Vec<PathVerb2D>,
}

#[derive(Clone, Debug)]
pub(crate) enum Text2D {
    DirectMask {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<DirectMaskGlyph2D>,
        transform: [f32; 6],
    },
    TransformedMask {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<TransformedMaskGlyph2D>,
        transform: [f32; 6],
    },
    Sdf {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<SdfGlyph2D>,
        transform: [f32; 6],
    },
    Path {
        _scene_id: u32,
        x: f32,
        y: f32,
        color: ColorValue,
        glyphs: Vec<PathTextGlyph2D>,
        transform: [f32; 6],
    },
    Composite {
        _scene_id: u32,
        runs: Vec<Text2D>,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct Group2D {
    pub scene_id: u32,
    pub transform: [f32; 6],
    pub child_item_ids: Vec<u32>,
}

#[derive(Clone, Debug)]
pub(crate) struct Triangle3D {
    pub scene_id: u32,
    pub positions: [[f32; 3]; 3],
    pub color: ColorValue,
}

#[derive(Debug)]
pub(crate) struct Scene2D {
    pub clear_color: ColorValue,
    pub root_item_ids: Vec<u32>,
    recording_cache: Mutex<Option<Scene2DRecordingCache>>,
}

#[derive(Clone, Debug)]
struct Scene2DRecordingCache {
    device_pixel_ratio_bits: u32,
    recording: Arc<DrawingRecording>,
}

impl Clone for Scene2D {
    fn clone(&self) -> Self {
        Self {
            clear_color: self.clear_color,
            root_item_ids: self.root_item_ids.clone(),
            recording_cache: Mutex::new(None),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct Camera3D {
    pub view_projection_matrix: [f32; 16],
}

#[derive(Clone, Debug)]
pub(crate) struct Scene3D {
    pub clear_color: ColorValue,
    pub camera: Camera3D,
    pub triangle_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CompositionNode {
    #[allow(dead_code)]
    Stack {
        children: Vec<CompositionNode>,
    },
    Scene2D {
        scene_id: u32,
        clear: bool,
    },
    Scene3D {
        scene_id: u32,
        clear: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum WindowRoot {
    #[serde(rename = "scene-2d")]
    Scene2D {
        #[serde(rename = "sceneId")]
        scene_id: u32,
    },
    #[serde(rename = "scene-3d")]
    Scene3D {
        #[serde(rename = "sceneId")]
        scene_id: u32,
    },
}

#[derive(Clone)]
pub struct RenderModel {
    next_scene_id: u32,
    next_object_id: u32,
    pub(crate) presented_root: Option<CompositionNode>,
    pub(crate) scenes_2d: HashMap<u32, Scene2D>,
    pub(crate) rects_2d: HashMap<u32, Rect2D>,
    pub(crate) paths_2d: HashMap<u32, Path2D>,
    pub(crate) texts_2d: HashMap<u32, Text2D>,
    pub(crate) groups_2d: HashMap<u32, Group2D>,
    pub(crate) scenes_3d: HashMap<u32, Scene3D>,
    pub(crate) triangles_3d: HashMap<u32, Triangle3D>,
}

impl Default for RenderModel {
    fn default() -> Self {
        Self {
            next_scene_id: 1,
            next_object_id: 1,
            presented_root: None,
            scenes_2d: HashMap::new(),
            rects_2d: HashMap::new(),
            paths_2d: HashMap::new(),
            texts_2d: HashMap::new(),
            groups_2d: HashMap::new(),
            scenes_3d: HashMap::new(),
            triangles_3d: HashMap::new(),
        }
    }
}

impl RenderModel {
    pub fn create_scene_2d(&mut self, options: Scene2DOptions) -> Scene2DHandle {
        let id = self.next_scene_id;
        self.next_scene_id += 1;
        self.scenes_2d.insert(
            id,
            Scene2D {
                clear_color: options.clear_color,
                root_item_ids: Vec::new(),
                recording_cache: Mutex::new(None),
            },
        );
        Scene2DHandle { id }
    }

    pub fn scene_2d_set_clear_color(
        &mut self,
        scene_id: u32,
        options: SceneClearColorOptions,
    ) -> Result<()> {
        let scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        scene.clear_color = options.color;
        Ok(())
    }

    pub fn scene_2d_create_rect(
        &mut self,
        scene_id: u32,
        options: Rect2DOptions,
    ) -> Result<Rect2DHandle> {
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.rects_2d.insert(
            id,
            Rect2D {
                _scene_id: scene_id,
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
                color: options.color,
                transform: options.transform,
            },
        );
        Ok(Rect2DHandle { id })
    }

    pub fn rect_2d_update(&mut self, rect_id: u32, options: Rect2DUpdate) -> Result<()> {
        if !self.rects_2d.contains_key(&rect_id) {
            return Err(anyhow!("unknown 2D rect {rect_id}"));
        }
        let scene_id = {
            let rect = self
                .rects_2d
                .get_mut(&rect_id)
                .ok_or_else(|| anyhow!("unknown 2D rect {rect_id}"))?;
            if let Some(x) = options.x {
                rect.x = x;
            }
            if let Some(y) = options.y {
                rect.y = y;
            }
            if let Some(width) = options.width {
                rect.width = width;
            }
            if let Some(height) = options.height {
                rect.height = height;
            }
            if let Some(color) = options.color {
                rect.color = color;
            }
            if let Some(transform) = options.transform {
                rect.transform = transform;
            }
            rect._scene_id
        };
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn scene_2d_create_path(
        &mut self,
        scene_id: u32,
        options: Path2DOptions,
    ) -> Result<Path2DHandle> {
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.paths_2d.insert(
            id,
            Path2D {
                _scene_id: scene_id,
                x: options.x,
                y: options.y,
                verbs: options.verbs,
                fill_rule: options.fill_rule,
                style: options.style,
                color: options.color,
                shader: options.shader,
                stroke_width: options.stroke_width,
                stroke_join: options.stroke_join,
                stroke_cap: options.stroke_cap,
                dash_array: options.dash_array,
                dash_offset: options.dash_offset,
                transform: options.transform,
            },
        );
        Ok(Path2DHandle { id })
    }

    pub fn path_2d_update(&mut self, path_id: u32, options: Path2DUpdate) -> Result<()> {
        if !self.paths_2d.contains_key(&path_id) {
            return Err(anyhow!("unknown 2D path {path_id}"));
        }
        let scene_id = {
            let path = self
                .paths_2d
                .get_mut(&path_id)
                .ok_or_else(|| anyhow!("unknown 2D path {path_id}"))?;
            path.x = options.x;
            path.y = options.y;
            path.verbs = options.verbs;
            path.fill_rule = options.fill_rule;
            path.style = options.style;
            path.color = options.color;
            path.shader = options.shader;
            path.stroke_width = options.stroke_width;
            path.stroke_join = options.stroke_join;
            path.stroke_cap = options.stroke_cap;
            path.dash_array = options.dash_array;
            path.dash_offset = options.dash_offset;
            path.transform = options.transform;
            path._scene_id
        };
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn scene_2d_create_text(
        &mut self,
        scene_id: u32,
        options: Text2DOptions,
    ) -> Result<Text2DHandle> {
        let _scene = self
            .scenes_2d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.texts_2d
            .insert(id, text_from_options(scene_id, options));
        Ok(Text2DHandle { id })
    }

    pub fn text_2d_update(&mut self, text_id: u32, options: Text2DUpdate) -> Result<()> {
        let scene_id = match self.texts_2d.get(&text_id) {
            Some(text) => text_scene_id(text),
            None => return Err(anyhow!("unknown 2D text {text_id}")),
        };
        self.texts_2d
            .insert(text_id, text_from_options(scene_id, options));
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn scene_2d_create_group(
        &mut self,
        scene_id: u32,
        options: Group2DOptions,
    ) -> Result<Group2DHandle> {
        let _scene = self
            .scenes_2d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.groups_2d.insert(
            id,
            Group2D {
                scene_id,
                transform: options.transform,
                child_item_ids: Vec::new(),
            },
        );
        Ok(Group2DHandle { id })
    }

    pub fn group_2d_update(&mut self, group_id: u32, options: Group2DUpdate) -> Result<()> {
        let scene_id = {
            let group = self
                .groups_2d
                .get_mut(&group_id)
                .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?;
            group.transform = options.transform;
            group.scene_id
        };
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn scene_2d_set_root_items(
        &mut self,
        scene_id: u32,
        root_item_ids: Vec<u32>,
    ) -> Result<()> {
        for item_id in &root_item_ids {
            let item_scene_id = self
                .item_2d_scene_id(*item_id)
                .ok_or_else(|| anyhow!("unknown 2D item {item_id}"))?;
            if item_scene_id != scene_id {
                return Err(anyhow!(
                    "2D item {item_id} belongs to scene {item_scene_id}, not {scene_id}"
                ));
            }
        }
        {
            let scene = self
                .scenes_2d
                .get_mut(&scene_id)
                .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
            scene.root_item_ids = root_item_ids;
        }
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn group_2d_set_children(&mut self, group_id: u32, child_item_ids: Vec<u32>) -> Result<()> {
        let scene_id = self
            .groups_2d
            .get(&group_id)
            .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?
            .scene_id;
        for item_id in &child_item_ids {
            let item_scene_id = self
                .item_2d_scene_id(*item_id)
                .ok_or_else(|| anyhow!("unknown 2D item {item_id}"))?;
            if item_scene_id != scene_id {
                return Err(anyhow!(
                    "2D item {item_id} belongs to scene {item_scene_id}, not {scene_id}"
                ));
            }
        }
        {
            let group = self
                .groups_2d
                .get_mut(&group_id)
                .ok_or_else(|| anyhow!("unknown 2D group {group_id}"))?;
            group.child_item_ids = child_item_ids;
        }
        self.invalidate_scene_2d_recording(scene_id);
        Ok(())
    }

    pub fn create_scene_3d(&mut self, options: Scene3DOptions) -> Scene3DHandle {
        let id = self.next_scene_id;
        self.next_scene_id += 1;
        self.scenes_3d.insert(
            id,
            Scene3D {
                clear_color: options.clear_color,
                camera: Camera3D {
                    view_projection_matrix: options.camera.view_projection_matrix,
                },
                triangle_ids: Vec::new(),
            },
        );
        Scene3DHandle { id }
    }

    pub fn scene_3d_set_clear_color(
        &mut self,
        scene_id: u32,
        options: SceneClearColorOptions,
    ) -> Result<()> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        scene.clear_color = options.color;
        Ok(())
    }

    pub fn scene_3d_set_camera(&mut self, scene_id: u32, options: SceneCameraUpdate) -> Result<()> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        if let Some(view_projection_matrix) = options.view_projection_matrix {
            scene.camera.view_projection_matrix = view_projection_matrix;
        }
        Ok(())
    }

    pub fn scene_3d_create_triangle(
        &mut self,
        scene_id: u32,
        options: Triangle3DOptions,
    ) -> Result<Triangle3DHandle> {
        let scene = self
            .scenes_3d
            .get_mut(&scene_id)
            .ok_or_else(|| anyhow!("unknown 3D scene {scene_id}"))?;
        let id = self.next_object_id;
        self.next_object_id += 1;
        self.triangles_3d.insert(
            id,
            Triangle3D {
                scene_id,
                positions: options.positions,
                color: options.color,
            },
        );
        scene.triangle_ids.push(id);
        Ok(Triangle3DHandle { id })
    }

    pub fn triangle_3d_update(
        &mut self,
        triangle_id: u32,
        options: Triangle3DUpdate,
    ) -> Result<()> {
        let triangle = self
            .triangles_3d
            .get_mut(&triangle_id)
            .ok_or_else(|| anyhow!("unknown 3D triangle {triangle_id}"))?;
        if let Some(positions) = options.positions {
            triangle.positions = positions;
        }
        if let Some(color) = options.color {
            triangle.color = color;
        }
        Ok(())
    }

    pub fn set_window_root(&mut self, root: WindowRoot) -> Result<()> {
        self.presented_root = Some(match root {
            WindowRoot::Scene2D { scene_id } => {
                if !self.scenes_2d.contains_key(&scene_id) {
                    return Err(anyhow!("unknown 2D scene {scene_id}"));
                }
                CompositionNode::Scene2D {
                    scene_id,
                    clear: true,
                }
            }
            WindowRoot::Scene3D { scene_id } => {
                if !self.scenes_3d.contains_key(&scene_id) {
                    return Err(anyhow!("unknown 3D scene {scene_id}"));
                }
                CompositionNode::Scene3D {
                    scene_id,
                    clear: true,
                }
            }
        });
        Ok(())
    }

    pub(crate) fn scene_2d_recording(
        &self,
        scene_id: u32,
        device_pixel_ratio: f32,
    ) -> Result<Arc<DrawingRecording>> {
        let scene = self
            .scenes_2d
            .get(&scene_id)
            .ok_or_else(|| anyhow!("unknown 2D scene {scene_id}"))?;
        let device_pixel_ratio_bits = device_pixel_ratio.to_bits();
        {
            let cache = scene
                .recording_cache
                .lock()
                .expect("scene 2D recording cache lock poisoned");
            if let Some(cache) = cache.as_ref() {
                if cache.device_pixel_ratio_bits == device_pixel_ratio_bits {
                    return Ok(cache.recording.clone());
                }
            }
        }

        let root_item_ids = scene.root_item_ids.clone();
        let recording = Arc::new(lower_scene_2d_to_recording(
            self,
            &root_item_ids,
            device_pixel_ratio,
        ));
        let mut cache = scene
            .recording_cache
            .lock()
            .expect("scene 2D recording cache lock poisoned");
        *cache = Some(Scene2DRecordingCache {
            device_pixel_ratio_bits,
            recording: recording.clone(),
        });
        Ok(recording)
    }

    fn item_2d_scene_id(&self, item_id: u32) -> Option<u32> {
        if let Some(rect) = self.rects_2d.get(&item_id) {
            return Some(rect._scene_id);
        }
        if let Some(path) = self.paths_2d.get(&item_id) {
            return Some(path._scene_id);
        }
        if let Some(text) = self.texts_2d.get(&item_id) {
            return Some(text_scene_id(text));
        }
        self.groups_2d.get(&item_id).map(|group| group.scene_id)
    }

    fn invalidate_scene_2d_recording(&self, scene_id: u32) {
        let Some(scene) = self.scenes_2d.get(&scene_id) else {
            return;
        };
        let mut cache = scene
            .recording_cache
            .lock()
            .expect("scene 2D recording cache lock poisoned");
        cache.take();
    }
}

fn glyph_mask_from_options(options: GlyphMask2DOptions) -> GlyphMask2D {
    GlyphMask2D {
        _cache_key: options.cache_key,
        width: options.width,
        height: options.height,
        stride: options.stride,
        _format: options.format,
        offset_x: options.offset_x,
        offset_y: options.offset_y,
        pixels: options.pixels,
    }
}

fn text_scene_id(text: &Text2D) -> u32 {
    match text {
        Text2D::DirectMask { _scene_id, .. }
        | Text2D::TransformedMask { _scene_id, .. }
        | Text2D::Sdf { _scene_id, .. }
        | Text2D::Path { _scene_id, .. }
        | Text2D::Composite { _scene_id, .. } => *_scene_id,
    }
}

fn text_from_options(scene_id: u32, options: Text2DOptions) -> Text2D {
    match options {
        Text2DOptions::DirectMask {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::DirectMask {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| DirectMaskGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    mask: glyph.mask.map(glyph_mask_from_options),
                })
                .collect(),
            transform,
        },
        Text2DOptions::TransformedMask {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::TransformedMask {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| TransformedMaskGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    mask: glyph.mask.map(glyph_mask_from_options),
                    strike_to_source_scale: glyph.strike_to_source_scale,
                })
                .collect(),
            transform,
        },
        Text2DOptions::Sdf {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::Sdf {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| SdfGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    _mask: glyph.mask.map(glyph_mask_from_options),
                    sdf: glyph.sdf.map(glyph_mask_from_options),
                    sdf_inset: glyph.sdf_inset,
                    _sdf_radius: glyph.sdf_radius,
                    strike_to_source_scale: glyph.strike_to_source_scale,
                })
                .collect(),
            transform,
        },
        Text2DOptions::Path {
            x,
            y,
            color,
            glyphs,
            transform,
        } => Text2D::Path {
            _scene_id: scene_id,
            x,
            y,
            color,
            glyphs: glyphs
                .into_iter()
                .map(|glyph| PathTextGlyph2D {
                    _glyph_id: glyph.glyph_id,
                    x: glyph.x,
                    y: glyph.y,
                    verbs: glyph.verbs,
                })
                .collect(),
            transform,
        },
        Text2DOptions::Composite { runs } => Text2D::Composite {
            _scene_id: scene_id,
            runs: runs
                .into_iter()
                .map(|run| text_from_options(scene_id, run))
                .collect(),
        },
    }
}
