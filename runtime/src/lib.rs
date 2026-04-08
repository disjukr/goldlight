use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::rc::Rc;
use std::thread;

use anyhow::{anyhow, Context, Result};
use deno_core::{
    resolve_import, resolve_path, JsRuntime, ModuleLoadResponse, ModuleLoader, ModuleSource,
    ModuleSourceCode, ModuleSpecifier, ModuleType, OpState, RequestedModuleType, ResolutionKind,
    RuntimeOptions,
};
use deno_error::JsErrorBox;
use serde::{Deserialize, Serialize};
use tokio::runtime::Builder as TokioRuntimeBuilder;
use tracing::info;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowAttributes, WindowId},
};

pub const GOLDLIGHT_MODULE_SPECIFIER: &str = "ext:goldlight/mod.js";
pub const GOLDLIGHT_APP_MANIFEST: &str = "goldlight.manifest.json";

const GOLDLIGHT_MODULE_SOURCE: &str = r#"
function normalizeWindowOptions(options = {}) {
  const {
    title = "goldlight window",
    width = 640,
    height = 480,
    workerEntrypoint = undefined,
  } = options;

  return { title, width, height, workerEntrypoint };
}

export function createWindow(options = {}) {
  return Deno.core.ops.op_goldlight_create_window(normalizeWindowOptions(options));
}
"#;

#[derive(Clone, Debug)]
pub enum RuntimeMode {
    Dev { vite_origin: String },
    Prod { bundle_root: PathBuf },
}

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub mode: RuntimeMode,
    pub entrypoint_specifier: ModuleSpecifier,
}

#[derive(Debug, Deserialize)]
struct AppManifest {
    entrypoint: String,
}

#[derive(Clone, Debug, Deserialize)]
struct WindowOptions {
    title: String,
    width: u32,
    height: u32,
    #[serde(default)]
    worker_entrypoint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct WindowHandle {
    id: u32,
}

#[derive(Default)]
struct RuntimeState {
    next_window_id: u32,
    pending_windows: Vec<PendingWindow>,
}

#[derive(Clone, Debug)]
struct PendingWindow {
    id: u32,
    title: String,
    width: u32,
    height: u32,
    worker_entrypoint: Option<String>,
}

type RuntimeStateHandle = Rc<RefCell<RuntimeState>>;

#[deno_core::op2]
#[serde]
fn op_goldlight_create_window(
    state: &mut OpState,
    #[serde] options: WindowOptions,
) -> Result<WindowHandle, JsErrorBox> {
    let runtime_state = state.borrow::<RuntimeStateHandle>().clone();
    let mut runtime_state = runtime_state.borrow_mut();
    let id = runtime_state.next_window_id;
    runtime_state.next_window_id += 1;
    runtime_state.pending_windows.push(PendingWindow {
        id,
        title: options.title,
        width: options.width,
        height: options.height,
        worker_entrypoint: options.worker_entrypoint,
    });
    Ok(WindowHandle { id })
}

deno_core::extension!(
    goldlight_runtime,
    ops = [op_goldlight_create_window],
    options = {
        runtime_state: RuntimeStateHandle,
    },
    state = |state, options| {
        state.put(options.runtime_state);
    }
);

struct GoldlightModuleLoader {
    mode: RuntimeMode,
}

impl GoldlightModuleLoader {
    fn new(mode: RuntimeMode) -> Self {
        Self { mode }
    }
}

impl ModuleLoader for GoldlightModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        _kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, JsErrorBox> {
        if specifier == "goldlight" || specifier == "/@id/goldlight" {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER).map_err(JsErrorBox::from_err);
        }

        if referrer == GOLDLIGHT_MODULE_SPECIFIER && specifier.starts_with("./") {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER).map_err(JsErrorBox::from_err);
        }

        resolve_import(specifier, referrer).map_err(JsErrorBox::from_err)
    }

    fn load(
        &self,
        module_specifier: &ModuleSpecifier,
        _maybe_referrer: Option<&ModuleSpecifier>,
        _is_dyn_import: bool,
        _requested_module_type: RequestedModuleType,
    ) -> ModuleLoadResponse {
        if module_specifier.as_str() == GOLDLIGHT_MODULE_SPECIFIER {
            return ModuleLoadResponse::Sync(Ok(ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(String::from(GOLDLIGHT_MODULE_SOURCE).into()),
                module_specifier,
                None,
            )));
        }

        let module_specifier = module_specifier.clone();
        let mode = self.mode.clone();
        let fut = async move {
            if matches!(module_specifier.scheme(), "http" | "https") {
                if !matches!(mode, RuntimeMode::Dev { .. }) {
                    return Err(JsErrorBox::generic(format!(
                        "HTTP modules are only allowed in the dev runtime: {module_specifier}"
                    )));
                }

                let response = reqwest::get(module_specifier.as_str())
                    .await
                    .map_err(|error| JsErrorBox::generic(error.to_string()))?;
                let response = response
                    .error_for_status()
                    .map_err(|error| JsErrorBox::generic(error.to_string()))?;
                let code = response
                    .text()
                    .await
                    .map_err(|error| JsErrorBox::generic(error.to_string()))?;
                return Ok(ModuleSource::new(
                    ModuleType::JavaScript,
                    ModuleSourceCode::String(code.into()),
                    &module_specifier,
                    None,
                ));
            }

            let path = module_specifier.to_file_path().map_err(|_| {
                JsErrorBox::generic(format!(
                    "Provided module specifier \"{module_specifier}\" is not a file URL."
                ))
            })?;
            let code = std::fs::read_to_string(path).map_err(JsErrorBox::from_err)?;
            Ok(ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(code.into()),
                &module_specifier,
                None,
            ))
        };

        ModuleLoadResponse::Async(Box::pin(fut))
    }

    fn prepare_load(
        &self,
        _module_specifier: &ModuleSpecifier,
        _maybe_referrer: Option<String>,
        _is_dyn_import: bool,
        _requested_module_type: RequestedModuleType,
    ) -> Pin<Box<dyn Future<Output = Result<(), JsErrorBox>>>> {
        Box::pin(async { Ok(()) })
    }
}

struct GoldlightRuntime {
    state: RuntimeStateHandle,
    mode: RuntimeMode,
    entrypoint_specifier: ModuleSpecifier,
    windows: HashMap<WindowId, Window>,
    startup_complete: bool,
}

impl GoldlightRuntime {
    fn new(state: RuntimeStateHandle, mode: RuntimeMode, entrypoint_specifier: ModuleSpecifier) -> Self {
        Self {
            state,
            mode,
            entrypoint_specifier,
            windows: HashMap::new(),
            startup_complete: false,
        }
    }

    fn drain_pending_windows(&mut self, event_loop: &ActiveEventLoop) {
        let pending = {
            let mut state = self.state.borrow_mut();
            std::mem::take(&mut state.pending_windows)
        };

        for pending_window in pending {
            let attributes = WindowAttributes::default()
                .with_title(pending_window.title.clone())
                .with_inner_size(winit::dpi::PhysicalSize::new(
                    pending_window.width,
                    pending_window.height,
                ));
            let window = event_loop
                .create_window(attributes)
                .expect("failed to create runtime window");
            info!(id = pending_window.id, title = pending_window.title, "runtime window created");
            if let Some(worker_entrypoint) = pending_window.worker_entrypoint.clone() {
                spawn_window_worker(
                    self.mode.clone(),
                    self.entrypoint_specifier.clone(),
                    pending_window.id,
                    worker_entrypoint,
                );
            }
            self.windows.insert(window.id(), window);
        }
    }
}

impl ApplicationHandler for GoldlightRuntime {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.drain_pending_windows(event_loop);
        self.startup_complete = true;
        if self.windows.is_empty() {
            event_loop.exit();
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if matches!(event, WindowEvent::CloseRequested) {
            self.windows.remove(&window_id);
            if self.windows.is_empty() {
                event_loop.exit();
            }
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.drain_pending_windows(event_loop);
        if self.startup_complete && self.windows.is_empty() {
            event_loop.exit();
        }
    }
}

pub fn init_logging() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
}

pub fn resolve_dev_config(vite_origin: &str, entrypoint: Option<&str>) -> Result<RuntimeConfig> {
    let normalized_origin = vite_origin.trim_end_matches('/');
    let selected_entrypoint = entrypoint
        .context("dev runtime requires an explicit entrypoint")?
        .replace('\\', "/");
    let entrypoint_url = format!("{normalized_origin}/{selected_entrypoint}");
    let entrypoint_specifier = ModuleSpecifier::parse(&entrypoint_url)?;

    Ok(RuntimeConfig {
        mode: RuntimeMode::Dev {
            vite_origin: normalized_origin.to_string(),
        },
        entrypoint_specifier,
    })
}

pub fn resolve_prod_config(bundle_root: Option<&str>, entrypoint: Option<&str>) -> Result<RuntimeConfig> {
    let root_path = match bundle_root {
        Some(bundle_root) => absolutize_path(bundle_root)?,
        None => current_executable_dir()?,
    };
    let selected_entrypoint = match entrypoint {
        Some(entrypoint) => entrypoint.to_string(),
        None => load_app_manifest(&root_path)?.entrypoint,
    };
    let entrypoint_path = root_path.join(selected_entrypoint);
    let entrypoint_specifier = resolve_path(
        entrypoint_path
            .to_str()
            .context("Runtime bundle entrypoint path must be valid UTF-8")?,
        Path::new("."),
    )?;

    Ok(RuntimeConfig {
        mode: RuntimeMode::Prod {
            bundle_root: root_path,
        },
        entrypoint_specifier,
    })
}

fn load_app_manifest(bundle_root: &Path) -> Result<AppManifest> {
    let manifest_path = bundle_root.join(GOLDLIGHT_APP_MANIFEST);
    let manifest_text = std::fs::read_to_string(&manifest_path)
        .with_context(|| format!("failed to read app manifest: {}", manifest_path.display()))?;
    serde_json::from_str(&manifest_text)
        .with_context(|| format!("failed to parse app manifest: {}", manifest_path.display()))
}

pub fn run_runtime(config: RuntimeConfig) -> Result<()> {
    let backend = wgpu::Backends::all();
    info!(
        ?backend,
        mode = ?config.mode,
        entrypoint = %config.entrypoint_specifier,
        "goldlight runtime booting"
    );

    let runtime_state = Rc::new(RefCell::new(RuntimeState::default()));
    bootstrap_runtime(runtime_state.clone(), config.mode.clone(), &config.entrypoint_specifier)?;

    let event_loop = EventLoop::new()?;
    let mut app = GoldlightRuntime::new(runtime_state, config.mode, config.entrypoint_specifier);
    event_loop.run_app(&mut app)?;
    Ok(())
}

fn spawn_window_worker(
    mode: RuntimeMode,
    base_specifier: ModuleSpecifier,
    window_id: u32,
    worker_entrypoint: String,
) {
    thread::spawn(move || {
        let worker_specifier = match ModuleSpecifier::parse(&worker_entrypoint)
            .or_else(|_| resolve_import(&worker_entrypoint, base_specifier.as_str()).map_err(JsErrorBox::from_err))
        {
            Ok(specifier) => specifier,
            Err(error) => {
                eprintln!(
                    "goldlight window worker {window_id} has invalid entrypoint {worker_entrypoint}: {error}"
                );
                return;
            }
        };

        let runtime_state = Rc::new(RefCell::new(RuntimeState::default()));
        if let Err(error) = bootstrap_runtime(runtime_state, mode, &worker_specifier) {
            eprintln!("goldlight window worker {window_id} failed: {error:?}");
        }
    });
}

fn bootstrap_runtime(
    runtime_state: RuntimeStateHandle,
    mode: RuntimeMode,
    main_module: &ModuleSpecifier,
) -> Result<()> {
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(Rc::new(GoldlightModuleLoader::new(mode))),
        extensions: vec![goldlight_runtime::init(runtime_state)],
        ..Default::default()
    });

    let tokio_runtime = TokioRuntimeBuilder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create tokio runtime for deno_core bootstrap")?;

    tokio_runtime.block_on(async move {
        let module_id = js_runtime.load_main_es_module(main_module).await?;
        let evaluation = js_runtime.mod_evaluate(module_id);
        js_runtime.run_event_loop(Default::default()).await?;
        evaluation.await?;
        Ok::<(), anyhow::Error>(())
    })?;

    Ok(())
}

fn absolutize_path(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

fn current_executable_dir() -> Result<PathBuf> {
    let executable = std::env::current_exe().context("failed to resolve current executable path")?;
    executable
        .parent()
        .map(Path::to_path_buf)
        .context("current executable path is missing a parent directory")
}

pub fn required_value<'a>(args: &'a [String], flag: &str) -> Result<&'a str> {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .ok_or_else(|| anyhow!("missing required flag: {flag}"))?;
    args.get(index + 1)
        .map(|value| value.as_str())
        .ok_or_else(|| anyhow!("missing value for flag: {flag}"))
}
