use super::types::ColorValue;

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
    Group2D(u32),
    ScrollContainer2D(u32),
    Scene3D(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum RenderContent {
    SurfaceRecording {
        surface_id: SurfaceId,
        recording_index: u32,
    },
    Scene3D(u32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RetainedSurfaceQuad {
    pub surface_id: SurfaceId,
    pub transform: [f32; 6],
    pub viewport_size: [f32; 2],
    pub source_origin: [f32; 2],
    pub scroll_offset: [f32; 2],
}

#[derive(Clone, Debug)]
pub(crate) enum CompositorQuad {
    Empty,
    SurfaceRef(SurfaceId),
    RetainedSurface(RetainedSurfaceQuad),
    Content(RenderContent),
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
    RetainedSurface(RetainedSurfaceQuad),
    Content(RenderContent),
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
