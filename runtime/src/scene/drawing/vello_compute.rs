use bytemuck::bytes_of;
use peniko::{
    kurbo::{Affine, Cap, Join, PathEl, Point, Stroke},
    Color, Fill,
};
use vello_encoding::{BumpEstimator, DrawBeginClip, Encoding, RenderConfig, Transform};
use wgpu::util::DeviceExt;

// Keep the full fine-raster AA option set available even though the atlas currently
// instantiates the MSAA8 path only.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CoverageAaConfig {
    AnalyticArea,
    Msaa8,
    Msaa16,
}

impl Default for CoverageAaConfig {
    fn default() -> Self {
        Self::Msaa8
    }
}

pub struct CoverageScene {
    encoding: Encoding,
    estimator: BumpEstimator,
}

impl CoverageScene {
    pub fn new() -> Self {
        Self {
            encoding: Encoding::new(),
            estimator: BumpEstimator::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.encoding.is_empty()
    }

    pub fn reset(&mut self) {
        self.encoding.reset();
        self.estimator.reset();
    }

    pub fn solid_fill(
        &mut self,
        path: &[PathEl],
        fill_rule: Fill,
        transform: [f32; 6],
        color: Color,
    ) {
        let transform = transform_from_affine(transform);
        self.encoding.encode_transform(transform);
        self.encoding.encode_fill_style(fill_rule);
        if !path.is_empty()
            && self
                .encoding
                .encode_path_elements(path.iter().copied(), true)
        {
            self.estimator
                .count_path(path.iter().copied(), &transform, None);
            self.encoding.encode_color(color);
        }
    }

    pub fn solid_stroke(
        &mut self,
        path: &[PathEl],
        stroke: &Stroke,
        transform: [f32; 6],
        color: Color,
    ) {
        let transform = transform_from_affine(transform);
        self.encoding.encode_transform(transform);
        if self.encoding.encode_stroke_style(stroke)
            && !path.is_empty()
            && self
                .encoding
                .encode_path_elements(path.iter().copied(), false)
        {
            self.estimator
                .count_path(path.iter().copied(), &transform, Some(stroke));
            self.encoding.encode_color(color);
        }
    }

    pub fn push_clip(&mut self, path: &[PathEl], transform: [f32; 6]) {
        let transform = transform_from_affine(transform);
        self.encoding.encode_transform(transform);
        self.encoding.encode_fill_style(Fill::NonZero);
        if !path.is_empty()
            && self
                .encoding
                .encode_path_elements(path.iter().copied(), true)
        {
            self.estimator
                .count_path(path.iter().copied(), &transform, None);
            self.encoding.encode_begin_clip(DrawBeginClip::clip());
        }
    }

    pub fn push_clip_rect(&mut self, left: f32, top: f32, right: f32, bottom: f32) {
        let path = clip_rect_path(left, top, right, bottom);
        self.push_clip(&path, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    }

    pub fn pop_clip(&mut self) {
        self.encoding.encode_end_clip();
    }

    fn prepare_render(&self, width: u32, height: u32) -> Option<PreparedScene> {
        if self.encoding.is_empty() || width == 0 || height == 0 {
            return None;
        }

        let mut packed_scene = Vec::new();
        let layout = vello_encoding::resolve_solid_paths_only(&self.encoding, &mut packed_scene);
        let mut config = RenderConfig::new(&layout, width, height, &Color::from_rgba8(0, 0, 0, 0));

        let bump_estimate = self.estimator.tally(None);
        config.buffer_sizes.bin_data = bump_estimate.binning;
        config.buffer_sizes.seg_counts = bump_estimate.seg_counts;
        config.buffer_sizes.segments = bump_estimate.segments;
        config.buffer_sizes.lines = bump_estimate.lines;
        config.gpu.binning_size = bump_estimate.binning.len();
        config.gpu.seg_counts_size = bump_estimate.seg_counts.len();
        config.gpu.segments_size = bump_estimate.segments.len();
        config.gpu.lines_size = bump_estimate.lines.len();

        Some(PreparedScene {
            packed_scene,
            config,
        })
    }
}

struct PreparedScene {
    packed_scene: Vec<u8>,
    config: RenderConfig,
}

enum ResourceRef<'a> {
    Buffer(&'a wgpu::Buffer),
    TextureView(&'a wgpu::TextureView),
}

struct ComputeStagePipeline {
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
    binding_indices: Vec<u32>,
    binding_types: Vec<vello_shaders::BindType>,
}

impl ComputeStagePipeline {
    fn dispatch(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        label: &str,
        resources: &[ResourceRef<'_>],
        workgroups: (u32, u32, u32),
    ) {
        if workgroups.0 == 0 || workgroups.1 == 0 || workgroups.2 == 0 {
            return;
        }
        let bind_group = self.create_bind_group(device, resources, label);
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some(label),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(workgroups.0, workgroups.1, workgroups.2);
    }

    fn dispatch_indirect(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        label: &str,
        resources: &[ResourceRef<'_>],
        indirect_buffer: &wgpu::Buffer,
        indirect_offset: u64,
    ) {
        let bind_group = self.create_bind_group(device, resources, label);
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some(label),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups_indirect(indirect_buffer, indirect_offset);
    }

    fn create_bind_group(
        &self,
        device: &wgpu::Device,
        resources: &[ResourceRef<'_>],
        label: &str,
    ) -> wgpu::BindGroup {
        debug_assert_eq!(resources.len(), self.binding_types.len());
        debug_assert_eq!(resources.len(), self.binding_indices.len());

        let entries = resources
            .iter()
            .zip(self.binding_indices.iter().copied())
            .map(|(resource, binding)| match resource {
                ResourceRef::Buffer(buffer) => wgpu::BindGroupEntry {
                    binding,
                    resource: buffer.as_entire_binding(),
                },
                ResourceRef::TextureView(view) => wgpu::BindGroupEntry {
                    binding,
                    resource: wgpu::BindingResource::TextureView(view),
                },
            })
            .collect::<Vec<_>>();

        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout: &self.bind_group_layout,
            entries: &entries,
        })
    }
}

pub struct CoverageComputeRenderer {
    aa_config: CoverageAaConfig,
    pathtag_reduce: ComputeStagePipeline,
    pathtag_reduce2: ComputeStagePipeline,
    pathtag_scan1: ComputeStagePipeline,
    pathtag_scan_small: ComputeStagePipeline,
    pathtag_scan_large: ComputeStagePipeline,
    bbox_clear: ComputeStagePipeline,
    flatten: ComputeStagePipeline,
    draw_reduce: ComputeStagePipeline,
    draw_leaf: ComputeStagePipeline,
    clip_reduce: ComputeStagePipeline,
    clip_leaf: ComputeStagePipeline,
    binning: ComputeStagePipeline,
    tile_alloc: ComputeStagePipeline,
    path_count_setup: ComputeStagePipeline,
    path_count: ComputeStagePipeline,
    backdrop_dyn: ComputeStagePipeline,
    coarse: ComputeStagePipeline,
    path_tiling_setup: ComputeStagePipeline,
    path_tiling: ComputeStagePipeline,
    fine_area: ComputeStagePipeline,
    fine_msaa8: ComputeStagePipeline,
    fine_msaa16: ComputeStagePipeline,
    _gradient_texture: wgpu::Texture,
    gradient_view: wgpu::TextureView,
    _image_atlas_texture: wgpu::Texture,
    image_atlas_view: wgpu::TextureView,
    mask_lut8: wgpu::Buffer,
    mask_lut16: wgpu::Buffer,
}

impl CoverageComputeRenderer {
    pub fn new(device: &wgpu::Device, aa_config: CoverageAaConfig) -> Self {
        let pathtag_reduce = create_stage_pipeline(
            device,
            "goldlight vello pathtag_reduce",
            &vello_shaders::SHADERS.pathtag_reduce,
            None,
        );
        let pathtag_reduce2 = create_stage_pipeline(
            device,
            "goldlight vello pathtag_reduce2",
            &vello_shaders::SHADERS.pathtag_reduce2,
            None,
        );
        let pathtag_scan1 = create_stage_pipeline(
            device,
            "goldlight vello pathtag_scan1",
            &vello_shaders::SHADERS.pathtag_scan1,
            None,
        );
        let pathtag_scan_small = create_stage_pipeline(
            device,
            "goldlight vello pathtag_scan_small",
            &vello_shaders::SHADERS.pathtag_scan_small,
            None,
        );
        let pathtag_scan_large = create_stage_pipeline(
            device,
            "goldlight vello pathtag_scan_large",
            &vello_shaders::SHADERS.pathtag_scan_large,
            None,
        );
        let bbox_clear = create_stage_pipeline(
            device,
            "goldlight vello bbox_clear",
            &vello_shaders::SHADERS.bbox_clear,
            None,
        );
        let flatten = create_stage_pipeline(
            device,
            "goldlight vello flatten",
            &vello_shaders::SHADERS.flatten,
            None,
        );
        let draw_reduce = create_stage_pipeline(
            device,
            "goldlight vello draw_reduce",
            &vello_shaders::SHADERS.draw_reduce,
            None,
        );
        let draw_leaf = create_stage_pipeline(
            device,
            "goldlight vello draw_leaf",
            &vello_shaders::SHADERS.draw_leaf,
            None,
        );
        let clip_reduce = create_stage_pipeline(
            device,
            "goldlight vello clip_reduce",
            &vello_shaders::SHADERS.clip_reduce,
            None,
        );
        let clip_leaf = create_stage_pipeline(
            device,
            "goldlight vello clip_leaf",
            &vello_shaders::SHADERS.clip_leaf,
            None,
        );
        let binning = create_stage_pipeline(
            device,
            "goldlight vello binning",
            &vello_shaders::SHADERS.binning,
            None,
        );
        let tile_alloc = create_stage_pipeline(
            device,
            "goldlight vello tile_alloc",
            &vello_shaders::SHADERS.tile_alloc,
            None,
        );
        let path_count_setup = create_stage_pipeline(
            device,
            "goldlight vello path_count_setup",
            &vello_shaders::SHADERS.path_count_setup,
            None,
        );
        let path_count = create_stage_pipeline(
            device,
            "goldlight vello path_count",
            &vello_shaders::SHADERS.path_count,
            None,
        );
        let backdrop_dyn = create_stage_pipeline(
            device,
            "goldlight vello backdrop_dyn",
            &vello_shaders::SHADERS.backdrop_dyn,
            None,
        );
        let coarse = create_stage_pipeline(
            device,
            "goldlight vello coarse",
            &vello_shaders::SHADERS.coarse,
            None,
        );
        let path_tiling_setup = create_stage_pipeline(
            device,
            "goldlight vello path_tiling_setup",
            &vello_shaders::SHADERS.path_tiling_setup,
            None,
        );
        let path_tiling = create_stage_pipeline(
            device,
            "goldlight vello path_tiling",
            &vello_shaders::SHADERS.path_tiling,
            None,
        );
        let fine_area = create_stage_pipeline(
            device,
            "goldlight vello fine_area_coverage",
            &vello_shaders::SHADERS.fine_area,
            Some(coverage_fine_shader_source(
                vello_shaders::SHADERS.fine_area.wgsl.code.as_ref(),
            )),
        );
        let fine_msaa8 = create_stage_pipeline(
            device,
            "goldlight vello fine_msaa8_coverage",
            &vello_shaders::SHADERS.fine_msaa8,
            Some(coverage_fine_shader_source(
                vello_shaders::SHADERS.fine_msaa8.wgsl.code.as_ref(),
            )),
        );
        let fine_msaa16 = create_stage_pipeline(
            device,
            "goldlight vello fine_msaa16_coverage",
            &vello_shaders::SHADERS.fine_msaa16,
            Some(coverage_fine_shader_source(
                vello_shaders::SHADERS.fine_msaa16.wgsl.code.as_ref(),
            )),
        );

        let (gradient_texture, gradient_view) =
            create_dummy_texture(device, "goldlight vello gradients");
        let (image_atlas_texture, image_atlas_view) =
            create_dummy_texture(device, "goldlight vello image atlas");
        let mask_lut8 = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight vello mask lut 8"),
            contents: &vello_encoding::make_mask_lut(),
            usage: wgpu::BufferUsages::STORAGE,
        });
        let mask_lut16 = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight vello mask lut 16"),
            contents: &vello_encoding::make_mask_lut_16(),
            usage: wgpu::BufferUsages::STORAGE,
        });

        Self {
            aa_config,
            pathtag_reduce,
            pathtag_reduce2,
            pathtag_scan1,
            pathtag_scan_small,
            pathtag_scan_large,
            bbox_clear,
            flatten,
            draw_reduce,
            draw_leaf,
            clip_reduce,
            clip_leaf,
            binning,
            tile_alloc,
            path_count_setup,
            path_count,
            backdrop_dyn,
            coarse,
            path_tiling_setup,
            path_tiling,
            fine_area,
            fine_msaa8,
            fine_msaa16,
            _gradient_texture: gradient_texture,
            gradient_view,
            _image_atlas_texture: image_atlas_texture,
            image_atlas_view,
            mask_lut8,
            mask_lut16,
        }
    }

    pub fn render_scene_to_texture(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        scene: &CoverageScene,
        target_view: &wgpu::TextureView,
        target_width: u32,
        target_height: u32,
    ) {
        let Some(prepared) = scene.prepare_render(target_width, target_height) else {
            return;
        };

        let config_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight vello config"),
            contents: bytes_of(&prepared.config.gpu),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let scene_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("goldlight vello scene"),
            contents: &prepared.packed_scene,
            usage: wgpu::BufferUsages::STORAGE,
        });

        let buffer_sizes = &prepared.config.buffer_sizes;
        let workgroups = &prepared.config.workgroup_counts;

        let info_bin_data_buffer = create_storage_buffer(
            device,
            "goldlight vello info_bin_data",
            buffer_sizes.bin_data.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let tile_buffer = create_storage_buffer(
            device,
            "goldlight vello tiles",
            buffer_sizes.tiles.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let segments_buffer = create_storage_buffer(
            device,
            "goldlight vello segments",
            buffer_sizes.segments.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let ptcl_buffer = create_storage_buffer(
            device,
            "goldlight vello ptcl",
            buffer_sizes.ptcl.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let reduced_buffer = create_storage_buffer(
            device,
            "goldlight vello pathtag_reduce",
            buffer_sizes.path_reduced.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let tag_monoid_buffer = create_storage_buffer(
            device,
            "goldlight vello tag_monoids",
            buffer_sizes.path_monoids.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let path_bbox_buffer = create_storage_buffer(
            device,
            "goldlight vello path_bboxes",
            buffer_sizes.path_bboxes.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let bump_buffer = create_storage_buffer(
            device,
            "goldlight vello bump",
            buffer_sizes.bump_alloc.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        encoder.clear_buffer(&bump_buffer, 0, None);
        let lines_buffer = create_storage_buffer(
            device,
            "goldlight vello lines",
            buffer_sizes.lines.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let draw_reduced_buffer = create_storage_buffer(
            device,
            "goldlight vello draw_reduced",
            buffer_sizes.draw_reduced.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let draw_monoid_buffer = create_storage_buffer(
            device,
            "goldlight vello draw_monoids",
            buffer_sizes.draw_monoids.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let clip_input_buffer = create_storage_buffer(
            device,
            "goldlight vello clip_inputs",
            buffer_sizes.clip_inps.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let clip_bbox_buffer = create_storage_buffer(
            device,
            "goldlight vello clip_bboxes",
            buffer_sizes.clip_bboxes.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let draw_bbox_buffer = create_storage_buffer(
            device,
            "goldlight vello draw_bboxes",
            buffer_sizes.draw_bboxes.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let bin_header_buffer = create_storage_buffer(
            device,
            "goldlight vello bin_headers",
            buffer_sizes.bin_headers.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let path_buffer = create_storage_buffer(
            device,
            "goldlight vello paths",
            buffer_sizes.paths.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let indirect_count_buffer = create_storage_buffer(
            device,
            "goldlight vello indirect_count",
            buffer_sizes.indirect_count.size_in_bytes(),
            wgpu::BufferUsages::INDIRECT,
        );
        let seg_counts_buffer = create_storage_buffer(
            device,
            "goldlight vello seg_counts",
            buffer_sizes.seg_counts.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );
        let blend_spill_buffer = create_storage_buffer(
            device,
            "goldlight vello blend_spill",
            buffer_sizes.blend_spill.size_in_bytes(),
            wgpu::BufferUsages::empty(),
        );

        self.pathtag_reduce.dispatch(
            device,
            encoder,
            "goldlight vello pathtag_reduce pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&reduced_buffer),
            ],
            workgroups.path_reduce,
        );

        if workgroups.use_large_path_scan {
            let reduced2_buffer = create_storage_buffer(
                device,
                "goldlight vello pathtag_reduce2",
                buffer_sizes.path_reduced2.size_in_bytes(),
                wgpu::BufferUsages::empty(),
            );
            let reduced_scan_buffer = create_storage_buffer(
                device,
                "goldlight vello pathtag_scan1",
                buffer_sizes.path_reduced_scan.size_in_bytes(),
                wgpu::BufferUsages::empty(),
            );
            self.pathtag_reduce2.dispatch(
                device,
                encoder,
                "goldlight vello pathtag_reduce2 pass",
                &[
                    ResourceRef::Buffer(&reduced_buffer),
                    ResourceRef::Buffer(&reduced2_buffer),
                ],
                workgroups.path_reduce2,
            );
            self.pathtag_scan1.dispatch(
                device,
                encoder,
                "goldlight vello pathtag_scan1 pass",
                &[
                    ResourceRef::Buffer(&reduced_buffer),
                    ResourceRef::Buffer(&reduced2_buffer),
                    ResourceRef::Buffer(&reduced_scan_buffer),
                ],
                workgroups.path_scan1,
            );
            self.pathtag_scan_large.dispatch(
                device,
                encoder,
                "goldlight vello pathtag_scan_large pass",
                &[
                    ResourceRef::Buffer(&config_buffer),
                    ResourceRef::Buffer(&scene_buffer),
                    ResourceRef::Buffer(&reduced_scan_buffer),
                    ResourceRef::Buffer(&tag_monoid_buffer),
                ],
                workgroups.path_scan,
            );
        } else {
            self.pathtag_scan_small.dispatch(
                device,
                encoder,
                "goldlight vello pathtag_scan_small pass",
                &[
                    ResourceRef::Buffer(&config_buffer),
                    ResourceRef::Buffer(&scene_buffer),
                    ResourceRef::Buffer(&reduced_buffer),
                    ResourceRef::Buffer(&tag_monoid_buffer),
                ],
                workgroups.path_scan,
            );
        }

        self.bbox_clear.dispatch(
            device,
            encoder,
            "goldlight vello bbox_clear pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&path_bbox_buffer),
            ],
            workgroups.bbox_clear,
        );

        self.flatten.dispatch(
            device,
            encoder,
            "goldlight vello flatten pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&tag_monoid_buffer),
                ResourceRef::Buffer(&path_bbox_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&lines_buffer),
            ],
            workgroups.flatten,
        );

        self.draw_reduce.dispatch(
            device,
            encoder,
            "goldlight vello draw_reduce pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&draw_reduced_buffer),
            ],
            workgroups.draw_reduce,
        );

        self.draw_leaf.dispatch(
            device,
            encoder,
            "goldlight vello draw_leaf pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&draw_reduced_buffer),
                ResourceRef::Buffer(&path_bbox_buffer),
                ResourceRef::Buffer(&draw_monoid_buffer),
                ResourceRef::Buffer(&info_bin_data_buffer),
                ResourceRef::Buffer(&clip_input_buffer),
            ],
            workgroups.draw_leaf,
        );

        if workgroups.clip_reduce.0 > 0 || workgroups.clip_leaf.0 > 0 {
            let clip_bic_buffer = create_storage_buffer(
                device,
                "goldlight vello clip_bics",
                buffer_sizes.clip_bics.size_in_bytes(),
                wgpu::BufferUsages::empty(),
            );
            let clip_element_buffer = create_storage_buffer(
                device,
                "goldlight vello clip_elements",
                buffer_sizes.clip_els.size_in_bytes(),
                wgpu::BufferUsages::empty(),
            );

            self.clip_reduce.dispatch(
                device,
                encoder,
                "goldlight vello clip_reduce pass",
                &[
                    ResourceRef::Buffer(&clip_input_buffer),
                    ResourceRef::Buffer(&path_bbox_buffer),
                    ResourceRef::Buffer(&clip_bic_buffer),
                    ResourceRef::Buffer(&clip_element_buffer),
                ],
                workgroups.clip_reduce,
            );
            self.clip_leaf.dispatch(
                device,
                encoder,
                "goldlight vello clip_leaf pass",
                &[
                    ResourceRef::Buffer(&config_buffer),
                    ResourceRef::Buffer(&clip_input_buffer),
                    ResourceRef::Buffer(&path_bbox_buffer),
                    ResourceRef::Buffer(&clip_bic_buffer),
                    ResourceRef::Buffer(&clip_element_buffer),
                    ResourceRef::Buffer(&draw_monoid_buffer),
                    ResourceRef::Buffer(&clip_bbox_buffer),
                ],
                workgroups.clip_leaf,
            );
        }

        self.binning.dispatch(
            device,
            encoder,
            "goldlight vello binning pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&draw_monoid_buffer),
                ResourceRef::Buffer(&path_bbox_buffer),
                ResourceRef::Buffer(&clip_bbox_buffer),
                ResourceRef::Buffer(&draw_bbox_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&info_bin_data_buffer),
                ResourceRef::Buffer(&bin_header_buffer),
            ],
            workgroups.binning,
        );

        self.tile_alloc.dispatch(
            device,
            encoder,
            "goldlight vello tile_alloc pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&draw_bbox_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&path_buffer),
                ResourceRef::Buffer(&tile_buffer),
            ],
            workgroups.tile_alloc,
        );

        self.path_count_setup.dispatch(
            device,
            encoder,
            "goldlight vello path_count_setup pass",
            &[
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&indirect_count_buffer),
            ],
            workgroups.path_count_setup,
        );

        self.path_count.dispatch_indirect(
            device,
            encoder,
            "goldlight vello path_count pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&lines_buffer),
                ResourceRef::Buffer(&path_buffer),
                ResourceRef::Buffer(&tile_buffer),
                ResourceRef::Buffer(&seg_counts_buffer),
            ],
            &indirect_count_buffer,
            0,
        );

        self.backdrop_dyn.dispatch(
            device,
            encoder,
            "goldlight vello backdrop_dyn pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&path_buffer),
                ResourceRef::Buffer(&tile_buffer),
            ],
            workgroups.backdrop,
        );

        self.coarse.dispatch(
            device,
            encoder,
            "goldlight vello coarse pass",
            &[
                ResourceRef::Buffer(&config_buffer),
                ResourceRef::Buffer(&scene_buffer),
                ResourceRef::Buffer(&draw_monoid_buffer),
                ResourceRef::Buffer(&bin_header_buffer),
                ResourceRef::Buffer(&info_bin_data_buffer),
                ResourceRef::Buffer(&path_buffer),
                ResourceRef::Buffer(&tile_buffer),
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&ptcl_buffer),
            ],
            workgroups.coarse,
        );

        self.path_tiling_setup.dispatch(
            device,
            encoder,
            "goldlight vello path_tiling_setup pass",
            &[
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&indirect_count_buffer),
                ResourceRef::Buffer(&ptcl_buffer),
            ],
            workgroups.path_tiling_setup,
        );

        self.path_tiling.dispatch_indirect(
            device,
            encoder,
            "goldlight vello path_tiling pass",
            &[
                ResourceRef::Buffer(&bump_buffer),
                ResourceRef::Buffer(&seg_counts_buffer),
                ResourceRef::Buffer(&lines_buffer),
                ResourceRef::Buffer(&path_buffer),
                ResourceRef::Buffer(&tile_buffer),
                ResourceRef::Buffer(&segments_buffer),
            ],
            &indirect_count_buffer,
            0,
        );

        let (fine_pipeline, mask_lut) = match self.aa_config {
            CoverageAaConfig::AnalyticArea => (&self.fine_area, None),
            CoverageAaConfig::Msaa8 => (&self.fine_msaa8, Some(&self.mask_lut8)),
            CoverageAaConfig::Msaa16 => (&self.fine_msaa16, Some(&self.mask_lut16)),
        };
        let mut fine_resources = vec![
            ResourceRef::Buffer(&config_buffer),
            ResourceRef::Buffer(&segments_buffer),
            ResourceRef::Buffer(&ptcl_buffer),
            ResourceRef::Buffer(&info_bin_data_buffer),
            ResourceRef::Buffer(&blend_spill_buffer),
            ResourceRef::TextureView(target_view),
            ResourceRef::TextureView(&self.gradient_view),
            ResourceRef::TextureView(&self.image_atlas_view),
        ];
        if let Some(mask_lut) = mask_lut {
            fine_resources.push(ResourceRef::Buffer(mask_lut));
        }
        fine_pipeline.dispatch(
            device,
            encoder,
            "goldlight vello fine pass",
            &fine_resources,
            workgroups.fine,
        );
    }
}

fn create_dummy_texture(device: &wgpu::Device, label: &str) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

fn create_stage_pipeline(
    device: &wgpu::Device,
    label: &str,
    shader: &vello_shaders::ComputeShader<'static>,
    source_override: Option<String>,
) -> ComputeStagePipeline {
    let binding_indices = shader
        .wgsl
        .binding_indices
        .iter()
        .map(|&index| index as u32)
        .collect::<Vec<_>>();
    let binding_types = shader.bindings.iter().copied().collect::<Vec<_>>();
    let entries = binding_indices
        .iter()
        .copied()
        .zip(binding_types.iter().copied())
        .map(|(binding, ty)| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: match ty {
                vello_shaders::BindType::Buffer | vello_shaders::BindType::BufReadOnly => {
                    wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage {
                            read_only: matches!(ty, vello_shaders::BindType::BufReadOnly),
                        },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    }
                }
                vello_shaders::BindType::Uniform => wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                vello_shaders::BindType::Image => wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                vello_shaders::BindType::ImageRead => wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
            },
            count: None,
        })
        .collect::<Vec<_>>();
    let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(label),
        entries: &entries,
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts: &[&bind_group_layout],
        push_constant_ranges: &[],
    });
    let shader_source = source_override.unwrap_or_else(|| shader.wgsl.code.to_string());
    let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(shader_source.into()),
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(label),
        layout: Some(&pipeline_layout),
        module: &shader_module,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    ComputeStagePipeline {
        pipeline,
        bind_group_layout,
        binding_indices,
        binding_types,
    }
}

fn create_storage_buffer(
    device: &wgpu::Device,
    label: &str,
    size: u32,
    extra_usage: wgpu::BufferUsages,
) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: size.max(4) as u64,
        // Some compute prep paths clear/fill these buffers before dispatch, which
        // requires COPY_DST usage on recent wgpu versions.
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | extra_usage,
        mapped_at_creation: false,
    })
}

fn transform_from_affine(transform: [f32; 6]) -> Transform {
    let affine = Affine::new([
        transform[0] as f64,
        transform[1] as f64,
        transform[2] as f64,
        transform[3] as f64,
        transform[4] as f64,
        transform[5] as f64,
    ]);
    Transform::from_kurbo(&affine)
}

fn clip_rect_path(left: f32, top: f32, right: f32, bottom: f32) -> Vec<PathEl> {
    vec![
        PathEl::MoveTo(Point::new(left as f64, top as f64)),
        PathEl::LineTo(Point::new(right as f64, top as f64)),
        PathEl::LineTo(Point::new(right as f64, bottom as f64)),
        PathEl::LineTo(Point::new(left as f64, bottom as f64)),
        PathEl::ClosePath,
    ]
}

fn coverage_fine_shader_source(source: &str) -> String {
    let mut output = source.to_string();
    let start = output
        .find("let fg = rgba[i];")
        .expect("expected fine shader output block");
    let end_marker = "textureStore(output, vec2<i32>(coords), rgba_sep);";
    let end = output[start..]
        .find(end_marker)
        .map(|offset| start + offset + end_marker.len())
        .expect("expected fine shader textureStore");
    output.replace_range(
        start..end,
        "let coverage = rgba[i].a;\n            textureStore(output, vec2<i32>(coords), vec4(coverage, coverage, coverage, coverage));",
    );
    output
}

pub fn stroke_from_parts(
    width: f32,
    miter_limit: f32,
    cap: super::super::render::PathStrokeCap2D,
    join: super::super::render::PathStrokeJoin2D,
) -> Stroke {
    let cap = match cap {
        super::super::render::PathStrokeCap2D::Butt => Cap::Butt,
        super::super::render::PathStrokeCap2D::Square => Cap::Square,
        super::super::render::PathStrokeCap2D::Round => Cap::Round,
    };
    let join = match join {
        super::super::render::PathStrokeJoin2D::Miter => Join::Miter,
        super::super::render::PathStrokeJoin2D::Bevel => Join::Bevel,
        super::super::render::PathStrokeJoin2D::Round => Join::Round,
    };
    Stroke {
        width: width as f64,
        join,
        miter_limit: miter_limit as f64,
        start_cap: cap,
        end_cap: cap,
        dash_pattern: Default::default(),
        dash_offset: 0.0,
    }
}
