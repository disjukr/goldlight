use super::types::ColorValue;

fn srgb_channel_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

pub(crate) fn to_srgb_array(color: ColorValue) -> [f32; 4] {
    [color.r, color.g, color.b, color.a]
}

pub(crate) fn to_linear_array(color: ColorValue) -> [f32; 4] {
    [
        srgb_channel_to_linear(color.r),
        srgb_channel_to_linear(color.g),
        srgb_channel_to_linear(color.b),
        color.a,
    ]
}
