use anyhow::Result;
use goldlight_runtime::{init_logging, resolve_prod_config, run_runtime};

fn main() -> Result<()> {
    init_logging();

    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let bundle_root = args
        .iter()
        .position(|arg| arg == "--bundle-root")
        .and_then(|index| args.get(index + 1))
        .map(String::as_str);
    let entrypoint = args
        .iter()
        .position(|arg| arg == "--entrypoint")
        .and_then(|index| args.get(index + 1))
        .map(String::as_str);

    let config = resolve_prod_config(bundle_root, entrypoint)?;
    run_runtime(config)
}
