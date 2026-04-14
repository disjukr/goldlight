use std::sync::Arc;

use super::display::ColorValue;
use super::drawing::DrawingRecording;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ClipSpaceVertex {
    pub position: [f32; 4],
    pub color: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ColorLoadOp {
    Load,
    Clear(ColorValue),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum SurfaceId {
    Scene2D(u32),
    Scene3D(u32),
}

#[derive(Clone, Debug)]
pub(crate) enum CompositorQuad {
    Empty,
    Surface(SurfaceId),
    VectorRecording(Arc<DrawingRecording>),
    ClipSpaceGeometry(Arc<Vec<ClipSpaceVertex>>),
}

#[derive(Clone, Debug)]
pub(crate) struct CompositorRenderPass {
    pub color_load_op: ColorLoadOp,
    pub quad: CompositorQuad,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct CompositorFrame {
    passes: Vec<CompositorRenderPass>,
}

impl CompositorFrame {
    pub(crate) fn from_passes(passes: Vec<CompositorRenderPass>) -> Self {
        Self { passes }
    }

    pub(crate) fn passes(&self) -> &[CompositorRenderPass] {
        &self.passes
    }
}

#[derive(Clone, Debug)]
pub(crate) enum AggregatedQuad {
    Empty,
    VectorRecording(Arc<DrawingRecording>),
    ClipSpaceGeometry(Arc<Vec<ClipSpaceVertex>>),
}

#[derive(Clone, Debug)]
pub(crate) struct AggregatedRenderPass {
    pub color_load_op: ColorLoadOp,
    pub quad: AggregatedQuad,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct AggregatedFrame {
    passes: Vec<AggregatedRenderPass>,
}

impl AggregatedFrame {
    pub(crate) fn from_passes(passes: Vec<AggregatedRenderPass>) -> Self {
        Self { passes }
    }

    pub(crate) fn passes(&self) -> &[AggregatedRenderPass] {
        &self.passes
    }
}
