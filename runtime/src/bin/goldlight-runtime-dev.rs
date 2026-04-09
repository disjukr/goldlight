use std::net::SocketAddr;

use anyhow::Result;
use goldlight_runtime::{
    init_logging, required_value, resolve_dev_config, run_runtime, InspectorConfig,
};

fn main() -> Result<()> {
    init_logging();

    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let vite_origin = required_value(&args, "--vite")?;
    let inspect = args
        .iter()
        .position(|arg| arg == "--inspect")
        .and_then(|index| args.get(index + 1))
        .map(|value| value.parse::<SocketAddr>())
        .transpose()?;
    let entrypoint = args
        .iter()
        .enumerate()
        .filter(|(_, arg)| !arg.starts_with("--"))
        .filter(|(index, _)| {
            args.get(index.saturating_sub(1))
                .map(|previous| previous.as_str() != "--vite" && previous.as_str() != "--inspect")
                .unwrap_or(true)
        })
        .map(|(_, value)| value.as_str())
        .last();

    let mut config = resolve_dev_config(vite_origin, entrypoint)?;
    config.inspector = inspect.map(|socket_addr| InspectorConfig { socket_addr });
    run_runtime(config)
}
