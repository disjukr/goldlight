use anyhow::Result;
use goldlight_runtime::{init_logging, required_value, resolve_dev_config, run_runtime};

fn main() -> Result<()> {
    init_logging();

    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let vite_origin = required_value(&args, "--vite")?;
    let entrypoint = args
        .iter()
        .skip_while(|arg| arg.as_str() != "--vite")
        .skip(2)
        .next()
        .map(String::as_str);

    let config = resolve_dev_config(vite_origin, entrypoint)?;
    run_runtime(config)
}
