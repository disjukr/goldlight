use std::sync::Arc;

use super::drawing::DrawingRecording;
use super::render::ColorValue;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ClipSpaceVertex {
    pub position: [f32; 4],
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ColorLoadOp {
    Load,
    Clear(ColorValue),
}

#[derive(Clone, Debug)]
pub(crate) enum DrawPayload {
    VectorRecording(Arc<DrawingRecording>),
    ClipSpaceGeometry(Vec<ClipSpaceVertex>),
}

#[derive(Clone, Debug)]
pub(crate) struct DrawPass {
    pub color_load_op: ColorLoadOp,
    pub payload: DrawPayload,
}

#[derive(Clone, Debug)]
pub(crate) enum FrameGraphPass {
    Clear { color: ColorValue },
    Draw(DrawPass),
}

#[derive(Clone, Debug, Default)]
pub(crate) struct FrameGraph {
    passes: Vec<FrameGraphPass>,
}

impl FrameGraph {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push_clear(&mut self, color: ColorValue) {
        self.passes.push(FrameGraphPass::Clear { color });
    }

    pub(crate) fn push_draw(&mut self, pass: DrawPass) {
        self.passes.push(FrameGraphPass::Draw(pass));
    }

    pub(crate) fn passes(&self) -> &[FrameGraphPass] {
        &self.passes
    }
}
