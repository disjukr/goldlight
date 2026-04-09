use std::collections::HashMap;
use std::future::Future;
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self as std_mpsc, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use axum::extract::ws::{Message as WebSocketMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as AxumPath, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use deno_core::{
    resolve_import, resolve_path, InspectorMsg, InspectorSessionKind, InspectorSessionOptions,
    InspectorSessionProxy, JsRuntime, ModuleLoadResponse, ModuleLoader, ModuleSource,
    ModuleSourceCode, ModuleSpecifier, ModuleType, OpState, PollEventLoopOptions,
    RequestedModuleType, ResolutionKind, RuntimeOptions, v8,
};
use deno_error::JsErrorBox;
use futures::channel::mpsc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::runtime::Builder as TokioRuntimeBuilder;
use tokio::sync::oneshot;
use tracing::debug;
use uuid::Uuid;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy},
    window::{Window, WindowAttributes, WindowId},
};

pub const GOLDLIGHT_MODULE_SPECIFIER: &str = "ext:goldlight/mod.js";
pub const GOLDLIGHT_APP_MANIFEST: &str = "goldlight.manifest.json";
const INSPECTOR_PROTOCOL_JSON: &str = include_str!("../inspector_protocol.json");
const GOLDLIGHT_MODULE_SOURCE: &str = include_str!("../js/goldlight_module.js");
const GOLDLIGHT_WORKER_CONSOLE_SOURCE: &str = include_str!("../js/worker_console.js");

fn rewrite_inline_source_map(
    code: String,
    _compiled_specifier: &ModuleSpecifier,
    original_specifier: &ModuleSpecifier,
) -> String {
    let marker = "\n//# sourceMappingURL=data:application/json;base64,";
    let Some(index) = code.rfind(marker) else {
        return code;
    };

    let (prefix, suffix) = code.split_at(index + marker.len());
    let encoded = suffix.trim();
    let Ok(decoded) = BASE64_STANDARD.decode(encoded) else {
        return code;
    };
    let Ok(mut source_map) = serde_json::from_slice::<serde_json::Value>(&decoded) else {
        return code;
    };
    let Some(sources) = source_map
        .get_mut("sources")
        .and_then(|value| value.as_array_mut())
    else {
        return code;
    };

    let original_file = match original_specifier.to_file_path() {
        Ok(path) => path,
        Err(_) => return code,
    };
    let original_dir = original_file.parent().unwrap_or(&original_file);

    for source in sources.iter_mut() {
        let Some(source_str) = source.as_str() else {
            continue;
        };
        if source_str.contains("://") {
            continue;
        }
        let rebased_source = original_dir.join(source_str);
        if let Ok(source_url) = ModuleSpecifier::from_file_path(rebased_source) {
            *source = serde_json::Value::String(source_url.to_string());
        }
    }

    let Ok(reencoded) = serde_json::to_vec(&source_map) else {
        return code;
    };
    format!("{prefix}{}", BASE64_STANDARD.encode(reencoded))
}

fn strip_inline_source_map(code: &str) -> String {
    let marker = "\n//# sourceMappingURL=data:application/json;base64,";
    if let Some(index) = code.rfind(marker) {
        code[..index].to_string()
    } else {
        code.to_string()
    }
}

#[derive(Clone, Debug)]
pub enum RuntimeMode {
    Dev {
        vite_origin: String,
        project_root: PathBuf,
    },
    Prod { bundle_root: PathBuf },
}

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub mode: RuntimeMode,
    pub entrypoint_specifier: ModuleSpecifier,
    pub inspector: Option<InspectorConfig>,
}

#[derive(Debug, Deserialize)]
struct AppManifest {
    entrypoint: String,
}

#[derive(Clone, Debug)]
pub struct InspectorConfig {
    pub socket_addr: SocketAddr,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
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

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WorkerEventPayload {
    Resize { width: u32, height: u32 },
    AnimationFrame { timestamp_ms: f64 },
}

#[derive(Default)]
struct WorkerHostState {
    pending_events: Vec<WorkerEventPayload>,
    animation_frame_requested: bool,
}

type WorkerHostStateHandle = Arc<Mutex<WorkerHostState>>;

enum WindowWorkerControl {
    Wake,
    Shutdown,
}

struct WindowWorkerHandle {
    state: WorkerHostStateHandle,
    control_tx: Sender<WindowWorkerControl>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl WindowWorkerHandle {
    fn push_event(&self, event: WorkerEventPayload) {
        if let Ok(mut state) = self.state.lock() {
            state.pending_events.push(event);
        }
        let _ = self.control_tx.send(WindowWorkerControl::Wake);
    }

    fn take_animation_frame_request(&self) -> bool {
        if let Ok(mut state) = self.state.lock() {
            let requested = state.animation_frame_requested;
            state.animation_frame_requested = false;
            return requested;
        }

        false
    }

    fn shutdown(mut self) {
        let _ = self.control_tx.send(WindowWorkerControl::Shutdown);
        if let Some(thread_handle) = self.thread_handle.take() {
            let _ = thread_handle.join();
        }
    }
}

struct WindowRecord {
    window: Window,
    worker: Option<WindowWorkerHandle>,
}

#[derive(Clone)]
struct RuntimeOpContext {
    state: RuntimeStateHandle,
    event_proxy: Option<EventLoopProxy<RuntimeUserEvent>>,
    worker_state: Option<WorkerHostStateHandle>,
}

type RuntimeStateHandle = Arc<Mutex<RuntimeState>>;

#[derive(Clone, Debug)]
enum RuntimeUserEvent {
    Wake,
}

#[deno_core::op2]
#[serde]
fn op_goldlight_create_window(
    state: &mut OpState,
    #[serde] options: WindowOptions,
) -> Result<WindowHandle, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    if op_context.worker_state.is_some() {
        return Err(JsErrorBox::generic(
            "createWindow is only available in the main runtime",
        ));
    }
    let mut runtime_state = op_context
        .state
        .lock()
        .map_err(|_| JsErrorBox::generic("runtime state mutex poisoned"))?;
    let id = runtime_state.next_window_id;
    runtime_state.next_window_id += 1;
    runtime_state.pending_windows.push(PendingWindow {
        id,
        title: options.title,
        width: options.width,
        height: options.height,
        worker_entrypoint: options.worker_entrypoint,
    });
    if let Some(event_proxy) = op_context.event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }
    Ok(WindowHandle { id })
}

#[deno_core::op2(fast)]
fn op_goldlight_worker_request_animation_frame(state: &mut OpState) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let worker_state = op_context
        .worker_state
        .ok_or_else(|| JsErrorBox::generic("requestAnimationFrame is only available in a window worker"))?;
    let mut worker_state = worker_state
        .lock()
        .map_err(|_| JsErrorBox::generic("worker state mutex poisoned"))?;
    worker_state.animation_frame_requested = true;
    Ok(())
}

#[deno_core::op2]
#[serde]
fn op_goldlight_worker_drain_events(
    state: &mut OpState,
) -> Result<Vec<WorkerEventPayload>, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let worker_state = op_context
        .worker_state
        .ok_or_else(|| JsErrorBox::generic("window events are only available in a window worker"))?;
    let mut worker_state = worker_state
        .lock()
        .map_err(|_| JsErrorBox::generic("worker state mutex poisoned"))?;
    Ok(std::mem::take(&mut worker_state.pending_events))
}

deno_core::extension!(
    goldlight_runtime,
    ops = [
        op_goldlight_create_window,
        op_goldlight_worker_request_animation_frame,
        op_goldlight_worker_drain_events
    ],
    options = {
        runtime_op_context: RuntimeOpContext,
    },
    state = |state, options| {
        state.put(options.runtime_op_context);
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

fn dev_original_specifier_from_relative(
    project_root: &Path,
    relative_specifier: &str,
) -> Result<ModuleSpecifier, JsErrorBox> {
    let (path_part, query_part) = match relative_specifier.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (relative_specifier, None),
    };
    let mut specifier = ModuleSpecifier::from_file_path(project_root.join(path_part.trim_start_matches('/')))
        .map_err(|_| JsErrorBox::generic("invalid dev module path"))?;
    if let Some(query) = query_part {
        specifier.set_query(Some(query));
    }
    Ok(specifier)
}

fn get_global_function(
    js_runtime: &mut JsRuntime,
    name: &str,
) -> Result<v8::Global<v8::Function>> {
    let scope = &mut js_runtime.handle_scope();
    let context = scope.get_current_context();
    let global = context.global(scope);
    let key = v8::String::new(scope, name).context("failed to allocate function name")?;
    let value = global
        .get(scope, key.into())
        .context("global function is missing")?;
    let function = v8::Local::<v8::Function>::try_from(value)
        .map_err(|_| anyhow!("global {name} is not a function"))?;
    Ok(v8::Global::new(scope, function))
}

impl ModuleLoader for GoldlightModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        _kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, JsErrorBox> {
        if specifier == "goldlight" || specifier == "/__goldlight/runtime" {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER).map_err(JsErrorBox::from_err);
        }

        if referrer == GOLDLIGHT_MODULE_SPECIFIER && specifier.starts_with("./") {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER).map_err(JsErrorBox::from_err);
        }

        if let RuntimeMode::Dev { vite_origin, project_root: _ } = &self.mode {
            if specifier.starts_with("/@") {
                return ModuleSpecifier::parse(&format!("{vite_origin}{specifier}"))
                    .map_err(JsErrorBox::from_err);
            }
            if specifier.starts_with('/') {
                return ModuleSpecifier::parse(&format!("{vite_origin}{specifier}"))
                    .map_err(JsErrorBox::from_err);
            }
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

                let original_specifier = if let RuntimeMode::Dev { vite_origin, project_root } = &mode {
                    if let Some(relative_specifier) =
                        module_specifier.as_str().strip_prefix(&format!("{vite_origin}/"))
                    {
                        if !relative_specifier.starts_with("@") {
                            dev_original_specifier_from_relative(project_root, relative_specifier).ok()
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                };
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
                    ModuleSourceCode::String(
                        match original_specifier {
                            Some(original_specifier) => rewrite_inline_source_map(
                                code,
                                &module_specifier,
                                &original_specifier,
                            ),
                            None => code,
                        }
                        .into(),
                    ),
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
    windows: HashMap<WindowId, WindowRecord>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    inspector_registry: Option<InspectorRegistryHandle>,
    frame_time_origin: std::time::Instant,
}

struct InspectorServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    thread_handle: Option<thread::JoinHandle<()>>,
    registry: InspectorRegistryHandle,
}

impl InspectorServerHandle {
    fn shutdown(mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        if let Some(thread_handle) = self.thread_handle.take() {
            let _ = thread_handle.join();
        }
    }

    fn registry(&self) -> InspectorRegistryHandle {
        self.registry.clone()
    }
}

struct MainRuntimeThreadHandle {
    shutdown_tx: Option<Sender<()>>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl MainRuntimeThreadHandle {
    fn shutdown(mut self) {
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        if let Some(thread_handle) = self.thread_handle.take() {
            let _ = thread_handle.join();
        }
    }
}

type InspectorRegistryHandle = Arc<Mutex<HashMap<String, InspectorTargetRecord>>>;

#[derive(Clone)]
struct InspectorServerState {
    registry: InspectorRegistryHandle,
    socket_addr: SocketAddr,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InspectorTargetKind {
    Main,
    Worker,
}

#[derive(Clone)]
struct InspectorTargetRecord {
    target_id: String,
    title: String,
    app_url: String,
    target_type: &'static str,
    kind: InspectorTargetKind,
    session_sender: mpsc::UnboundedSender<InspectorSessionProxy>,
}

fn register_inspector_target(
    registry: &InspectorRegistryHandle,
    title: String,
    app_url: String,
    kind: InspectorTargetKind,
    session_sender: mpsc::UnboundedSender<InspectorSessionProxy>,
) -> String {
    let target_id = Uuid::new_v4().to_string();
    let record = InspectorTargetRecord {
        target_id: target_id.clone(),
        title,
        app_url,
        target_type: "node",
        kind,
        session_sender,
    };
    registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .insert(target_id.clone(), record);
    target_id
}

fn unregister_inspector_target(registry: &InspectorRegistryHandle, target_id: &str) {
    let _ = registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .remove(target_id);
}

fn inspector_devtools_frontend_url(socket_addr: SocketAddr, target_id: &str) -> String {
    format!(
        "devtools://devtools/bundled/js_app.html?ws={}/ws/{}&experiments=true&v8only=true",
        socket_addr, target_id
    )
}

fn inspector_worker_info(
    record: &InspectorTargetRecord,
    session_id: &str,
) -> serde_json::Value {
    json!({
        "sessionId": session_id,
        "workerInfo": {
            "workerId": record.target_id,
            "type": "node_worker",
            "title": record.title,
            "url": record.app_url
        },
        "waitingForDebugger": false
    })
}

impl GoldlightRuntime {
    fn new(
        state: RuntimeStateHandle,
        mode: RuntimeMode,
        entrypoint_specifier: ModuleSpecifier,
        startup_complete: Arc<AtomicBool>,
        main_runtime_idle: Arc<AtomicBool>,
        inspector_registry: Option<InspectorRegistryHandle>,
    ) -> Self {
        Self {
            state,
            mode,
            entrypoint_specifier,
            windows: HashMap::new(),
            startup_complete,
            main_runtime_idle,
            inspector_registry,
            frame_time_origin: std::time::Instant::now(),
        }
    }

    fn drain_pending_windows(&mut self, event_loop: &ActiveEventLoop) {
        let pending = {
            let mut state = self
                .state
                .lock()
                .expect("runtime state mutex poisoned");
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
            debug!(id = pending_window.id, title = pending_window.title, "runtime window created");
            let worker = pending_window.worker_entrypoint.clone().map(|worker_entrypoint| {
                let worker = spawn_window_worker(
                    self.mode.clone(),
                    self.entrypoint_specifier.clone(),
                    pending_window.id,
                    worker_entrypoint,
                    self.inspector_registry.clone(),
                );
                worker.push_event(WorkerEventPayload::Resize {
                    width: pending_window.width,
                    height: pending_window.height,
                });
                worker
            });
            let window_id = window.id();
            self.windows.insert(
                window_id,
                WindowRecord {
                    window,
                    worker,
                },
            );
        }
    }

    fn maybe_exit(&self, event_loop: &ActiveEventLoop) {
        if self.startup_complete.load(Ordering::SeqCst)
            && self.main_runtime_idle.load(Ordering::SeqCst)
            && self.windows.is_empty()
        {
            event_loop.exit();
        }
    }
}

impl ApplicationHandler<RuntimeUserEvent> for GoldlightRuntime {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.drain_pending_windows(event_loop);
        self.maybe_exit(event_loop);
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if matches!(event, WindowEvent::CloseRequested) {
            if let Some(mut record) = self.windows.remove(&window_id) {
                if let Some(worker) = record.worker.take() {
                    worker.shutdown();
                }
            }
            self.maybe_exit(event_loop);
            return;
        }

        let Some(record) = self.windows.get_mut(&window_id) else {
            return;
        };

        match event {
            WindowEvent::Resized(size) => {
                if let Some(worker) = record.worker.as_ref() {
                    worker.push_event(WorkerEventPayload::Resize {
                        width: size.width,
                        height: size.height,
                    });
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(worker) = record.worker.as_ref() {
                    worker.push_event(WorkerEventPayload::AnimationFrame {
                        timestamp_ms: self.frame_time_origin.elapsed().as_secs_f64() * 1000.0,
                    });
                }
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.drain_pending_windows(event_loop);
        for record in self.windows.values() {
            if let Some(worker) = record.worker.as_ref() {
                if worker.take_animation_frame_request() {
                    record.window.request_redraw();
                }
            }
        }
        self.maybe_exit(event_loop);
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, _event: RuntimeUserEvent) {
        self.drain_pending_windows(event_loop);
        self.maybe_exit(event_loop);
    }
}

pub fn init_logging() {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "warn".into());
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .init();
}

pub fn resolve_dev_config(vite_origin: &str, entrypoint: Option<&str>) -> Result<RuntimeConfig> {
    let normalized_origin = vite_origin.trim_end_matches('/');
    let selected_entrypoint = entrypoint
        .context("dev runtime requires an explicit entrypoint")?
        .replace('\\', "/");
    let project_root = std::env::current_dir().context("failed to resolve current project root")?;
    let entrypoint_specifier = ModuleSpecifier::parse(&format!(
        "{normalized_origin}/{selected_entrypoint}"
    ))?;

    Ok(RuntimeConfig {
        mode: RuntimeMode::Dev {
            vite_origin: normalized_origin.to_string(),
            project_root,
        },
        entrypoint_specifier,
        inspector: None,
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
        inspector: None,
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
    debug!(
        ?backend,
        mode = ?config.mode,
        entrypoint = %config.entrypoint_specifier,
        "goldlight runtime booting"
    );

    let event_loop = EventLoop::<RuntimeUserEvent>::with_user_event().build()?;
    let event_proxy = event_loop.create_proxy();
    let runtime_state = Arc::new(Mutex::new(RuntimeState::default()));
    let startup_complete = Arc::new(AtomicBool::new(false));
    let main_runtime_idle = Arc::new(AtomicBool::new(false));
    let inspector_server = config
        .inspector
        .clone()
        .map(|inspector_config| spawn_inspector_server(inspector_config.socket_addr))
        .transpose()?;
    let inspector_registry = inspector_server.as_ref().map(|server| server.registry());
    let runtime_thread = spawn_main_runtime_thread(
        runtime_state.clone(),
        config.mode.clone(),
        config.entrypoint_specifier.clone(),
        event_proxy,
        startup_complete.clone(),
        main_runtime_idle.clone(),
        inspector_registry.clone(),
    );

    let mut app = GoldlightRuntime::new(
        runtime_state,
        config.mode,
        config.entrypoint_specifier,
        startup_complete,
        main_runtime_idle,
        inspector_registry,
    );
    event_loop.run_app(&mut app)?;
    runtime_thread.shutdown();
    if let Some(inspector_server) = inspector_server {
        inspector_server.shutdown();
    }
    Ok(())
}

fn spawn_window_worker(
    mode: RuntimeMode,
    base_specifier: ModuleSpecifier,
    window_id: u32,
    worker_entrypoint: String,
    inspector_registry: Option<InspectorRegistryHandle>,
) -> WindowWorkerHandle {
    let worker_state = Arc::new(Mutex::new(WorkerHostState::default()));
    let (control_tx, control_rx) = std_mpsc::channel::<WindowWorkerControl>();
    let thread_worker_state = worker_state.clone();
    let thread_handle = thread::spawn(move || {
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

        let runtime_state = Arc::new(Mutex::new(RuntimeState::default()));
        if let Err(error) = run_window_worker_thread(
            runtime_state,
            thread_worker_state,
            mode,
            &worker_specifier,
            &control_rx,
            inspector_registry,
            window_id,
        ) {
            eprintln!("goldlight window worker {window_id} failed: {error:?}");
        }
    });

    WindowWorkerHandle {
        state: worker_state,
        control_tx,
        thread_handle: Some(thread_handle),
    }
}

fn spawn_main_runtime_thread(
    runtime_state: RuntimeStateHandle,
    mode: RuntimeMode,
    main_module: ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    inspector_registry: Option<InspectorRegistryHandle>,
) -> MainRuntimeThreadHandle {
    let (shutdown_tx, shutdown_rx) = std_mpsc::channel::<()>();
    let thread_handle = thread::spawn(move || {
        let result = run_main_runtime_thread(
            runtime_state,
            mode,
            main_module,
            event_proxy.clone(),
            &shutdown_rx,
            startup_complete.clone(),
            main_runtime_idle.clone(),
            inspector_registry,
        );

        if let Err(error) = result {
            eprintln!("goldlight main runtime failed: {error:?}");
        }

        main_runtime_idle.store(true, Ordering::SeqCst);
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    });

    MainRuntimeThreadHandle {
        shutdown_tx: Some(shutdown_tx),
        thread_handle: Some(thread_handle),
    }
}

fn run_main_runtime_thread(
    runtime_state: RuntimeStateHandle,
    mode: RuntimeMode,
    main_module: ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    shutdown_rx: &std_mpsc::Receiver<()>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    inspector_registry: Option<InspectorRegistryHandle>,
) -> Result<()> {
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(Rc::new(GoldlightModuleLoader::new(mode.clone()))),
        extensions: vec![goldlight_runtime::init(RuntimeOpContext {
            state: runtime_state,
            event_proxy: Some(event_proxy.clone()),
            worker_state: None,
        })],
        inspector: inspector_registry.is_some(),
        is_main: true,
        ..Default::default()
    });

    let main_target_id = if let Some(inspector_registry) = inspector_registry.as_ref() {
        let target_id = register_inspector_target(
            inspector_registry,
            "main".to_string(),
            main_module.as_str().to_string(),
            InspectorTargetKind::Main,
            js_runtime.inspector().borrow().get_session_sender(),
        );
        Some(target_id)
    } else {
        None
    };

    let tokio_runtime = TokioRuntimeBuilder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create tokio runtime for main runtime thread")?;

    main_runtime_idle.store(false, Ordering::SeqCst);
    tokio_runtime.block_on(async {
        let module_id = js_runtime.load_main_es_module(&main_module).await?;
        let evaluation = js_runtime.mod_evaluate(module_id);
        js_runtime
            .run_event_loop(PollEventLoopOptions {
                wait_for_inspector: false,
                pump_v8_message_loop: true,
            })
            .await?;
        evaluation.await?;
        Ok::<(), anyhow::Error>(())
    })?;
    if inspector_registry.is_some() {
        let _ = js_runtime.inspector().borrow().poll_sessions(None);
    }
    startup_complete.store(true, Ordering::SeqCst);
    main_runtime_idle.store(true, Ordering::SeqCst);
    let _ = event_proxy.send_event(RuntimeUserEvent::Wake);

    while shutdown_rx.try_recv().is_err() {
        main_runtime_idle.store(false, Ordering::SeqCst);
        tokio_runtime.block_on(async {
            js_runtime
                .run_event_loop(PollEventLoopOptions {
                    wait_for_inspector: false,
                    pump_v8_message_loop: true,
                })
                .await?;
            Ok::<(), anyhow::Error>(())
        })?;
        if inspector_registry.is_some() {
            let _ = js_runtime.inspector().borrow().poll_sessions(None);
        }
        main_runtime_idle.store(true, Ordering::SeqCst);
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);

        thread::sleep(Duration::from_millis(16));
    }

    if let (Some(inspector_registry), Some(main_target_id)) = (&inspector_registry, &main_target_id) {
        unregister_inspector_target(inspector_registry, main_target_id);
    }

    Ok(())
}

fn run_window_worker_thread(
    runtime_state: RuntimeStateHandle,
    worker_state: WorkerHostStateHandle,
    mode: RuntimeMode,
    main_module: &ModuleSpecifier,
    control_rx: &std_mpsc::Receiver<WindowWorkerControl>,
    inspector_registry: Option<InspectorRegistryHandle>,
    window_id: u32,
) -> Result<()> {
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(Rc::new(GoldlightModuleLoader::new(mode))),
        extensions: vec![goldlight_runtime::init(RuntimeOpContext {
            state: runtime_state,
            event_proxy: None,
            worker_state: Some(worker_state),
        })],
        inspector: inspector_registry.is_some(),
        is_main: false,
        ..Default::default()
    });

    let worker_target_id = if let Some(inspector_registry) = inspector_registry.as_ref() {
        Some(register_inspector_target(
            inspector_registry,
            format!("window-{window_id}"),
            main_module.as_str().to_string(),
            InspectorTargetKind::Worker,
            js_runtime.inspector().borrow().get_session_sender(),
        ))
    } else {
        None
    };

    let tokio_runtime = TokioRuntimeBuilder::new_current_thread()
        .enable_all()
        .build()
        .context("failed to create tokio runtime for window worker")?;

    js_runtime
        .execute_script(
            "ext:goldlight/worker_console.js",
            GOLDLIGHT_WORKER_CONSOLE_SOURCE,
        )
        .context("failed to install window worker console bridge")?;

    tokio_runtime.block_on(async {
        let module_id = js_runtime.load_main_es_module(main_module).await?;
        let evaluation = js_runtime.mod_evaluate(module_id);
        js_runtime
            .run_event_loop(PollEventLoopOptions {
                wait_for_inspector: false,
                pump_v8_message_loop: true,
            })
            .await?;
        evaluation.await?;
        Ok::<(), anyhow::Error>(())
    })?;
    if inspector_registry.is_some() {
        let _ = js_runtime.inspector().borrow().poll_sessions(None);
    }

    let worker_pump = get_global_function(&mut js_runtime, "__goldlightPump")
        .context("failed to capture window worker pump function")?;

    loop {
        match control_rx.recv_timeout(Duration::from_millis(16)) {
            Ok(WindowWorkerControl::Shutdown) => break,
            Ok(WindowWorkerControl::Wake) | Err(std_mpsc::RecvTimeoutError::Timeout) => {
                tokio_runtime.block_on(async {
                    let worker_pump_call = js_runtime.call(&worker_pump);
                    js_runtime
                        .with_event_loop_future(
                            worker_pump_call,
                            PollEventLoopOptions {
                                wait_for_inspector: false,
                                pump_v8_message_loop: true,
                            },
                        )
                        .await?;
                    js_runtime
                        .run_event_loop(PollEventLoopOptions {
                            wait_for_inspector: false,
                            pump_v8_message_loop: true,
                        })
                        .await?;
                    Ok::<(), anyhow::Error>(())
                })?;
                if inspector_registry.is_some() {
                    let _ = js_runtime.inspector().borrow().poll_sessions(None);
                }
            }
            Err(std_mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    if let (Some(inspector_registry), Some(worker_target_id)) = (&inspector_registry, &worker_target_id) {
        unregister_inspector_target(inspector_registry, worker_target_id);
    }

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

fn spawn_inspector_server(
    socket_addr: SocketAddr,
) -> Result<InspectorServerHandle> {
    let listener = TcpListener::bind(socket_addr)
        .with_context(|| format!("failed to bind inspector server at {socket_addr}"))?;
    listener
        .set_nonblocking(true)
        .context("failed to configure inspector server socket")?;
    let registry = Arc::new(Mutex::new(HashMap::new()));

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let thread_registry = registry.clone();
    let thread_handle = thread::spawn(move || {
        let state = InspectorServerState {
            registry: thread_registry,
            socket_addr,
        };

        let runtime = TokioRuntimeBuilder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to create tokio runtime for inspector server");

        runtime.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener)
                .expect("failed to convert inspector listener to tokio");
            let app = Router::new()
                .route("/json", get(inspector_json_list))
                .route("/json/list", get(inspector_json_list))
                .route("/json/version", get(inspector_json_version))
                .route("/json/protocol", get(inspector_json_protocol))
                .route("/ws/{target_id}", get(inspector_websocket))
                .with_state(state);

            let server = axum::serve(listener, app).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });

            if let Err(error) = server.await {
                eprintln!("goldlight inspector server failed: {error}");
            }
        });
    });

    Ok(InspectorServerHandle {
        shutdown_tx: Some(shutdown_tx),
        thread_handle: Some(thread_handle),
        registry,
    })
}

async fn inspector_json_version(
    _state: State<InspectorServerState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "Browser": "goldlight",
        "Protocol-Version": "1.3",
        "V8-Version": deno_core::v8::VERSION_STRING,
    }))
}

async fn inspector_json_protocol() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json; charset=UTF-8")],
        INSPECTOR_PROTOCOL_JSON,
    )
}

async fn inspector_json_list(
    State(state): State<InspectorServerState>,
) -> Json<Vec<serde_json::Value>> {
    let records = state
        .registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .values()
        .filter(|record| record.kind == InspectorTargetKind::Main)
        .cloned()
        .collect::<Vec<_>>();
    let mut records = records;
    records.sort_by(|left, right| left.title.cmp(&right.title));

    Json(
        records
            .into_iter()
            .map(|record| {
                let websocket_debugger_url =
                    format!("ws://{}/ws/{}", state.socket_addr, record.target_id);
                let devtools_frontend_url =
                    inspector_devtools_frontend_url(state.socket_addr, &record.target_id);
                json!({
                    "description": "goldlight",
                    "devtoolsFrontendUrl": devtools_frontend_url,
                    "faviconUrl": "https://deno.land/favicon.ico",
                    "id": record.target_id,
                    "title": record.title,
                    "type": record.target_type,
                    "url": record.app_url,
                    "webSocketDebuggerUrl": websocket_debugger_url,
                })
            })
            .collect(),
    )
}

async fn inspector_websocket(
    websocket: WebSocketUpgrade,
    AxumPath(target_id): AxumPath<String>,
    State(state): State<InspectorServerState>,
) -> Response {
    websocket.on_upgrade(move |socket| handle_inspector_websocket(socket, state, target_id))
}

struct AttachedWorkerSession {
    record: InspectorTargetRecord,
    session_id: String,
    context_namespace: i64,
    frontend_to_worker_tx: mpsc::UnboundedSender<String>,
    worker_to_frontend_rx: mpsc::UnboundedReceiver<InspectorMsg>,
    request_methods: HashMap<i64, String>,
    attached_announced: bool,
}

fn attach_worker_session(
    record: &InspectorTargetRecord,
    context_namespace: i64,
    bootstrap_messages: &[String],
) -> Option<AttachedWorkerSession> {
    let (frontend_to_worker_tx, frontend_to_worker_rx) = mpsc::unbounded::<String>();
    let (worker_to_frontend_tx, worker_to_frontend_rx) = mpsc::unbounded::<InspectorMsg>();
    let proxy = InspectorSessionProxy {
        tx: worker_to_frontend_tx,
        rx: frontend_to_worker_rx,
        options: InspectorSessionOptions {
            kind: InspectorSessionKind::NonBlocking {
                wait_for_disconnect: true,
            },
        },
    };
    record
        .session_sender
        .clone()
        .unbounded_send(proxy)
        .ok()?;
    for message in bootstrap_messages {
        let _ = frontend_to_worker_tx.unbounded_send(message.clone());
    }
    Some(AttachedWorkerSession {
        record: record.clone(),
        session_id: Uuid::new_v4().to_string(),
        context_namespace,
        frontend_to_worker_tx,
        worker_to_frontend_rx,
        request_methods: HashMap::new(),
        attached_announced: false,
    })
}

async fn send_worker_session_message(
    websocket_sender: &mut futures_util::stream::SplitSink<WebSocket, WebSocketMessage>,
    message: String,
) -> bool {
    websocket_sender
        .send(WebSocketMessage::Text(message.into()))
        .await
        .is_ok()
}

async fn maybe_attach_main_worker_sessions(
    websocket_sender: &mut futures_util::stream::SplitSink<WebSocket, WebSocketMessage>,
    state: &InspectorServerState,
    attached_workers: &mut HashMap<String, AttachedWorkerSession>,
    worker_bootstrap_messages: &[String],
    next_worker_context_namespace: &mut i64,
    nodeworker_enabled: bool,
) -> bool {
    let worker_records = state
        .registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .values()
        .filter(|record| record.kind == InspectorTargetKind::Worker)
        .cloned()
        .collect::<Vec<_>>();

    for record in worker_records {
        let worker = attached_workers.entry(record.target_id.clone()).or_insert_with(|| {
            let namespace = *next_worker_context_namespace;
            *next_worker_context_namespace += 1;
            attach_worker_session(&record, namespace, worker_bootstrap_messages)
                .expect("failed to attach worker inspector session")
        });
        worker.record = record.clone();

        if nodeworker_enabled && !worker.attached_announced {
            worker.attached_announced = true;
            let notification = json!({
                "method": "NodeWorker.attachedToWorker",
                "params": inspector_worker_info(&worker.record, &worker.session_id)
            })
            .to_string();
            if !send_worker_session_message(websocket_sender, notification).await {
                return false;
            }
        }
    }

    true
}

fn strip_session_id(message: &str) -> Option<(String, String)> {
    let mut value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    let session_id = value.get("sessionId")?.as_str()?.to_string();
    value.as_object_mut()?.remove("sessionId");
    Some((session_id, value.to_string()))
}

fn is_worker_bootstrap_method(method: &str) -> bool {
    matches!(
        method,
        "Runtime.enable"
            | "Debugger.enable"
            | "Profiler.enable"
            | "Debugger.setPauseOnExceptions"
            | "Debugger.setAsyncCallStackDepth"
            | "Debugger.setBlackboxPatterns"
            | "Debugger.setBreakpointByUrl"
            | "Debugger.removeBreakpoint"
    )
}

fn worker_call_frame_id(namespace: &str, raw: &str) -> String {
    format!("gl-worker-callframe:{namespace}:{raw}")
}

fn parse_worker_call_frame_id(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("gl-worker-callframe:")?;
    rest.split_once(':')
}

fn worker_object_id(namespace: &str, raw: &str) -> String {
    format!("gl-worker-object:{namespace}:{raw}")
}

fn parse_worker_object_id(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("gl-worker-object:")?;
    rest.split_once(':')
}

fn encode_worker_execution_context_id(namespace: i64, raw: i64) -> i64 {
    namespace * 1_000_000 + raw
}

fn decode_worker_execution_context_id(value: i64) -> Option<(i64, i64)> {
    if value < 1_000_000 {
        return None;
    }
    Some((value / 1_000_000, value % 1_000_000))
}

fn worker_script_id(context_namespace: i64, raw: &str) -> String {
    let raw = raw.parse::<i64>().ok().unwrap_or_default();
    encode_worker_script_id(context_namespace, raw).to_string()
}

fn parse_worker_script_id(value: &str) -> Option<(i64, String)> {
    decode_worker_script_id(value)
}

fn encode_worker_script_id(namespace: i64, raw: i64) -> i64 {
    namespace * 1_000_000 + raw
}

fn decode_worker_script_id(value: &str) -> Option<(i64, String)> {
    let encoded = value.parse::<i64>().ok()?;
    let (namespace, raw) = decode_worker_execution_context_id(encoded)?;
    Some((namespace, raw.to_string()))
}

enum WorkerRouteKey {
    TargetId(String),
    ContextNamespace(i64),
}

fn rewrite_worker_outbound_value(value: &mut serde_json::Value, namespace: &str, context_namespace: i64) {
    match value {
        serde_json::Value::Object(object) => {
            for (key, child) in object.iter_mut() {
                match key.as_str() {
                    "scriptId" => {
                        let Some(script_id) = child.as_str() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child =
                            serde_json::Value::String(worker_script_id(context_namespace, script_id));
                    }
                    "callFrameId" => {
                        let Some(call_frame_id) = child.as_str() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child =
                            serde_json::Value::String(worker_call_frame_id(namespace, call_frame_id));
                    }
                    "objectId" => {
                        let Some(object_id) = child.as_str() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child = serde_json::Value::String(worker_object_id(namespace, object_id));
                    }
                    "executionContextId" => {
                        let Some(raw) = child.as_i64() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child = serde_json::Value::Number(serde_json::Number::from(
                            encode_worker_execution_context_id(context_namespace, raw),
                        ));
                    }
                    _ => rewrite_worker_outbound_value(child, namespace, context_namespace),
                }
            }
        }
        serde_json::Value::Array(array) => {
            for item in array {
                rewrite_worker_outbound_value(item, namespace, context_namespace);
            }
        }
        _ => {}
    }
}

fn rewrite_worker_inbound_value(
    value: &mut serde_json::Value,
) -> Option<WorkerRouteKey> {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(serde_json::Value::String(script_id)) = object.get_mut("scriptId") {
                let current = script_id.clone();
                let (namespace, raw) = parse_worker_script_id(&current)?;
                *script_id = raw.to_string();
                return Some(WorkerRouteKey::ContextNamespace(namespace));
            }
            if let Some(serde_json::Value::String(call_frame_id)) = object.get_mut("callFrameId") {
                let current = call_frame_id.clone();
                let (namespace, raw) = parse_worker_call_frame_id(&current)?;
                *call_frame_id = raw.to_string();
                return Some(WorkerRouteKey::TargetId(namespace.to_string()));
            }
            if let Some(serde_json::Value::String(object_id)) = object.get_mut("objectId") {
                let current = object_id.clone();
                let (namespace, raw) = parse_worker_object_id(&current)?;
                *object_id = raw.to_string();
                return Some(WorkerRouteKey::TargetId(namespace.to_string()));
            }
            if let Some(serde_json::Value::Number(number)) = object.get_mut("executionContextId") {
                if let Some(value) = number.as_i64() {
                    let (namespace, raw) = decode_worker_execution_context_id(value)?;
                    *number = serde_json::Number::from(raw);
                    return Some(WorkerRouteKey::ContextNamespace(namespace));
                }
            }
            for child in object.values_mut() {
                if let Some(namespace) = rewrite_worker_inbound_value(child) {
                    return Some(namespace);
                }
            }
        }
        serde_json::Value::Array(array) => {
            for item in array {
                if let Some(namespace) = rewrite_worker_inbound_value(item) {
                    return Some(namespace);
                }
            }
        }
        _ => {}
    }
    None
}

fn get_worker_command_route(message: &str) -> Option<(String, serde_json::Value)> {
    let value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    let method = value.get("method")?.as_str()?;
    let params = value.get("params")?.clone();
    match method {
        "NodeWorker.sendMessageToWorker" => {
            let session_id = params.get("sessionId")?.as_str()?.to_string();
            let inner = params.get("message")?.as_str()?.to_string();
            Some((session_id, serde_json::Value::String(inner)))
        }
        _ => None,
    }
}

async fn handle_inspector_websocket(
    socket: WebSocket,
    state: InspectorServerState,
    target_id: String,
) {
    let (mut websocket_sender, mut websocket_receiver) = socket.split();
    let target_record = state
        .registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .get(&target_id)
        .cloned();
    let Some(target_record) = target_record else {
        let _ = websocket_sender.close().await;
        return;
    };
    let is_main_target = target_record.kind == InspectorTargetKind::Main;
    let (frontend_to_runtime_tx, frontend_to_runtime_rx) = mpsc::unbounded::<String>();
    let (runtime_to_frontend_tx, mut runtime_to_frontend_rx) = mpsc::unbounded::<InspectorMsg>();

    let proxy = InspectorSessionProxy {
        tx: runtime_to_frontend_tx,
        rx: frontend_to_runtime_rx,
        options: InspectorSessionOptions {
            kind: InspectorSessionKind::NonBlocking {
                wait_for_disconnect: true,
            },
        },
    };

    let send_result = Some(target_record.session_sender.clone().unbounded_send(proxy));

    if !matches!(send_result, Some(Ok(()))) {
        return;
    }

    let mut script_urls = HashMap::<String, String>::new();
    let mut request_methods = HashMap::<i64, String>::new();
    let mut paused_call_frame_id: Option<String> = None;
    let mut attached_workers = HashMap::<String, AttachedWorkerSession>::new();
    let mut worker_bootstrap_messages = Vec::<String>::new();
    let mut next_worker_context_namespace = 1_i64;
    let mut paused_worker_target_id: Option<String> = None;
    let mut nodeworker_enabled = false;
    let mut compiled_scripts = HashMap::<String, String>::new();
    let mut next_compiled_script_id = 1_u64;

    loop {
        if is_main_target
            && !maybe_attach_main_worker_sessions(
                &mut websocket_sender,
                &state,
                &mut attached_workers,
                &worker_bootstrap_messages,
                &mut next_worker_context_namespace,
                nodeworker_enabled,
            )
            .await
        {
            break;
        }

        tokio::select! {
            Some(message) = websocket_receiver.next() => {
                let Ok(message) = message else {
                    break;
                };

                match message {
                    WebSocketMessage::Text(text) => {
                        if is_main_target {
                            if let Some((session_id, inner_message)) = strip_session_id(&text) {
                                if let Some(worker) = attached_workers.values().find(|worker| worker.session_id == session_id) {
                                    if worker.frontend_to_worker_tx.unbounded_send(inner_message).is_err() {
                                        break;
                                    }
                                    continue;
                                }
                            }

                            if let Some((session_id, inner_message)) = get_worker_command_route(&text) {
                                if let Some(worker) = attached_workers.values().find(|worker| worker.session_id == session_id) {
                                    if let Some(inner_text) = inner_message.as_str() {
                                        if worker.frontend_to_worker_tx.unbounded_send(inner_text.to_string()).is_err() {
                                            break;
                                        }
                                    }
                                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                        if let Some(id) = value.get("id") {
                                            let response = json!({ "id": id, "result": {} }).to_string();
                                            if websocket_sender.send(WebSocketMessage::Text(response.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                    }
                                    continue;
                                }
                            }

                            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                if let Some(method) = value.get("method").and_then(|method| method.as_str()) {
                                    match method {
                                        "NodeWorker.enable" => {
                                            nodeworker_enabled = true;
                                            if let Some(id) = value.get("id") {
                                                let response = json!({ "id": id, "result": {} }).to_string();
                                                if websocket_sender.send(WebSocketMessage::Text(response.into())).await.is_err() {
                                                    break;
                                                }
                                            }
                                            continue;
                                        }
                                        "NodeWorker.disable" => {
                                            nodeworker_enabled = false;
                                            if let Some(id) = value.get("id") {
                                                let response = json!({ "id": id, "result": {} }).to_string();
                                                if websocket_sender.send(WebSocketMessage::Text(response.into())).await.is_err() {
                                                    break;
                                                }
                                            }
                                            continue;
                                        }
                                        "NodeWorker.detach" => {
                                            if let Some(id) = value.get("id") {
                                                let response = json!({ "id": id, "result": {} }).to_string();
                                                if websocket_sender.send(WebSocketMessage::Text(response.into())).await.is_err() {
                                                    break;
                                                }
                                            }
                                            continue;
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }

                        match patch_frontend_protocol_message(
                            &text,
                            paused_call_frame_id.as_deref(),
                            &mut compiled_scripts,
                            &mut next_compiled_script_id,
                        ) {
                            FrontendProtocolAction::Forward(inbound) => {
                                if is_main_target {
                                    if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&inbound) {
                                        if let Some(method) = value
                                            .get("method")
                                            .and_then(|method| method.as_str())
                                            .map(|method| method.to_string())
                                        {
                                            if is_worker_bootstrap_method(&method) {
                                                if !worker_bootstrap_messages.iter().any(|message| message == &inbound) {
                                                    worker_bootstrap_messages.push(inbound.clone());
                                                }
                                                for worker in attached_workers.values() {
                                                    let _ = worker.frontend_to_worker_tx.unbounded_send(inbound.clone());
                                                }
                                            }

                                            let route_key = if let Some(params) = value.get_mut("params") {
                                                rewrite_worker_inbound_value(params)
                                            } else {
                                                None
                                            };

                                            let routed_worker = match route_key {
                                                Some(WorkerRouteKey::TargetId(target_id)) => {
                                                    attached_workers.get_mut(&target_id)
                                                }
                                                Some(WorkerRouteKey::ContextNamespace(context_namespace)) => {
                                                    attached_workers
                                                        .values_mut()
                                                        .find(|worker| worker.context_namespace == context_namespace)
                                                }
                                                None if matches!(
                                                    method.as_str(),
                                                    "Debugger.resume"
                                                        | "Debugger.stepInto"
                                                        | "Debugger.stepOver"
                                                        | "Debugger.stepOut"
                                                        | "Debugger.restartFrame"
                                                ) => paused_worker_target_id
                                                    .as_ref()
                                                    .and_then(|target_id| attached_workers.get_mut(target_id)),
                                                None => None,
                                            };

                                            if let Some(worker) = routed_worker {
                                                let outbound = value.to_string();
                                                remember_inspector_request_method(
                                                    &outbound,
                                                    &mut worker.request_methods,
                                                );
                                                remember_inspector_request_method(&outbound, &mut request_methods);
                                                if worker.frontend_to_worker_tx.unbounded_send(outbound).is_err() {
                                                    break;
                                                }
                                                continue;
                                            }
                                        }
                                    }
                                }

                                remember_inspector_request_method(&inbound, &mut request_methods);
                                if frontend_to_runtime_tx.unbounded_send(inbound).is_err() {
                                    break;
                                }
                            }
                            FrontendProtocolAction::Respond(response) => {
                                if websocket_sender
                                    .send(WebSocketMessage::Text(response.into()))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                    WebSocketMessage::Binary(bytes) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            match patch_frontend_protocol_message(
                                &text,
                                paused_call_frame_id.as_deref(),
                                &mut compiled_scripts,
                                &mut next_compiled_script_id,
                            ) {
                                FrontendProtocolAction::Forward(inbound) => {
                                    remember_inspector_request_method(&inbound, &mut request_methods);
                                    if frontend_to_runtime_tx.unbounded_send(inbound).is_err() {
                                        break;
                                    }
                                }
                                FrontendProtocolAction::Respond(response) => {
                                    if websocket_sender
                                        .send(WebSocketMessage::Text(response.into()))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    WebSocketMessage::Close(_) => break,
                    WebSocketMessage::Ping(payload) => {
                        if websocket_sender.send(WebSocketMessage::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    WebSocketMessage::Pong(_) => {}
                }
            }
            Some(message) = runtime_to_frontend_rx.next() => {
                let backend_message = if let Ok(value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                    if let Some(id) = value.get("id").and_then(|id| id.as_i64()) {
                        if matches!(
                            request_methods.get(&id).map(String::as_str),
                            Some("Debugger.getScriptSource")
                        ) {
                            patch_get_script_source_response(&message.content)
                                .unwrap_or_else(|| message.content.clone())
                        } else {
                            message.content.clone()
                        }
                    } else {
                        message.content.clone()
                    }
                } else {
                    message.content.clone()
                };
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                    if let Some(id) = value.get("id").and_then(|id| id.as_i64()) {
                        request_methods.remove(&id);
                    }
                }
                match patch_inspector_protocol_message(
                    &backend_message,
                    &mut script_urls,
                    &mut paused_call_frame_id,
                ) {
                    BackendProtocolAction::Passthrough => {
                        if websocket_sender
                            .send(WebSocketMessage::Text(backend_message.into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    BackendProtocolAction::Rewrite(outbound) => {
                        if websocket_sender.send(WebSocketMessage::Text(outbound.into())).await.is_err() {
                            break;
                        }
                    }
                    BackendProtocolAction::Suppress => {}
                }
                if paused_call_frame_id.is_none() {
                    compiled_scripts.clear();
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(10)), if is_main_target => {
                let mut removed = Vec::new();
                for (worker_id, worker) in attached_workers.iter_mut() {
                    loop {
                        match worker.worker_to_frontend_rx.try_recv() {
                            Ok(message) => {
                                let mut outbound_message = message.content.clone();
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&message.content) {
                                    if let Some(id) = value.get("id").and_then(|id| id.as_i64()) {
                                        if matches!(
                                            worker.request_methods.remove(&id).as_deref(),
                                            Some("Debugger.getScriptSource")
                                        ) {
                                            outbound_message = patch_get_script_source_response(&message.content)
                                                .unwrap_or_else(|| message.content.clone());
                                        }
                                    }
                                }
                                let outbound = if nodeworker_enabled {
                                    json!({
                                        "method": "NodeWorker.receivedMessageFromWorker",
                                        "params": {
                                            "sessionId": worker.session_id,
                                            "message": outbound_message,
                                            "workerId": worker.record.target_id
                                        }
                                    }).to_string()
                                } else {
                                    match serde_json::from_str::<serde_json::Value>(&outbound_message) {
                                        Ok(mut value) => {
                                            let method = value
                                                .get("method")
                                                .and_then(|method| method.as_str())
                                                .map(str::to_string);
                                            if method.as_deref() == Some("Runtime.executionContextCreated") {
                                                if let Some(context) = value
                                                    .get_mut("params")
                                                    .and_then(|params| params.get_mut("context"))
                                                    .and_then(|context| context.as_object_mut())
                                                {
                                                    if let Some(context_id) = context
                                                        .get("id")
                                                        .and_then(|id| id.as_i64())
                                                    {
                                                        context.insert(
                                                            "id".to_string(),
                                                            json!(encode_worker_execution_context_id(
                                                                worker.context_namespace,
                                                                context_id,
                                                            )),
                                                        );
                                                    }
                                                    context.insert(
                                                        "name".to_string(),
                                                        json!(worker.record.title),
                                                    );
                                                    context.insert(
                                                        "origin".to_string(),
                                                        json!(worker.record.app_url),
                                                    );
                                                    let aux_data = context
                                                        .entry("auxData".to_string())
                                                        .or_insert_with(|| json!({}));
                                                    if let Some(aux_data) = aux_data.as_object_mut() {
                                                        aux_data.insert(
                                                            "isDefault".to_string(),
                                                            json!(true),
                                                        );
                                                        aux_data.insert(
                                                            "type".to_string(),
                                                            json!("default"),
                                                        );
                                                    }
                                                }
                                            } else if method.as_deref() == Some("Debugger.scriptParsed") {
                                                if let Some(params) = value
                                                    .get_mut("params")
                                                    .and_then(|params| params.as_object_mut())
                                                {
                                                    let is_worker_app_script = params
                                                        .get("url")
                                                        .and_then(|value| value.as_str())
                                                        .map(|url| url == worker.record.app_url)
                                                        .unwrap_or(false);
                                                    if let Some(aux_data) = params
                                                        .entry("executionContextAuxData".to_string())
                                                        .or_insert_with(|| json!({}))
                                                        .as_object_mut()
                                                    {
                                                        aux_data.insert(
                                                            "isDefault".to_string(),
                                                            json!(true),
                                                        );
                                                        aux_data.insert(
                                                            "type".to_string(),
                                                            json!("default"),
                                                        );
                                                    }
                                                    if is_worker_app_script {
                                                        params.insert(
                                                            "scriptLanguage".to_string(),
                                                            serde_json::Value::Null,
                                                        );
                                                    }
                                                }
                                            }
                                            if method.as_deref() == Some("Debugger.paused") {
                                                paused_worker_target_id = Some(worker.record.target_id.clone());
                                            } else if method.as_deref() == Some("Debugger.resumed") {
                                                if paused_worker_target_id.as_deref() == Some(worker.record.target_id.as_str()) {
                                                    paused_worker_target_id = None;
                                                }
                                            }
                                            rewrite_worker_outbound_value(
                                                &mut value,
                                                &worker.record.target_id,
                                                worker.context_namespace,
                                            );
                                            value.to_string()
                                        }
                                        Err(_) => outbound_message,
                                    }
                                };
                                match patch_inspector_protocol_message(
                                    &outbound,
                                    &mut script_urls,
                                    &mut paused_call_frame_id,
                                ) {
                                    BackendProtocolAction::Passthrough => {
                                        if websocket_sender
                                            .send(WebSocketMessage::Text(outbound.into()))
                                            .await
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    BackendProtocolAction::Rewrite(rewritten) => {
                                        if websocket_sender
                                            .send(WebSocketMessage::Text(rewritten.into()))
                                            .await
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    BackendProtocolAction::Suppress => {}
                                }
                                if paused_call_frame_id.is_none() {
                                    compiled_scripts.clear();
                                }
                            }
                            Err(futures::channel::mpsc::TryRecvError::Closed) => {
                                if nodeworker_enabled {
                                    let notification = json!({
                                        "method": "NodeWorker.detachedFromWorker",
                                        "params": {
                                            "sessionId": worker.session_id
                                        }
                                    }).to_string();
                                    if websocket_sender.send(WebSocketMessage::Text(notification.into())).await.is_err() {
                                        return;
                                    }
                                }
                                removed.push(worker_id.clone());
                                break;
                            }
                            Err(futures::channel::mpsc::TryRecvError::Empty) => break,
                        }
                    }
                }
                for worker_id in removed {
                    attached_workers.remove(&worker_id);
                }
            }
            else => break,
        }
    }

    let _ = websocket_sender.close().await;
}

enum BackendProtocolAction {
    Passthrough,
    Rewrite(String),
    Suppress,
}

fn patch_get_script_source_response(message: &str) -> Option<String> {
    let mut value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    let script_source = value
        .get_mut("result")
        .and_then(|result| result.get_mut("scriptSource"))
        .and_then(|script_source| script_source.as_str())
        .map(strip_inline_source_map)?;
    if let Some(result) = value.get_mut("result").and_then(|result| result.as_object_mut()) {
        result.insert("scriptSource".to_string(), serde_json::Value::String(script_source));
        return serde_json::to_string(&value).ok();
    }
    None
}

fn patch_inspector_protocol_message(
    message: &str,
    script_urls: &mut HashMap<String, String>,
    paused_call_frame_id: &mut Option<String>,
) -> BackendProtocolAction {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(message) else {
        return BackendProtocolAction::Passthrough;
    };
    let Some(method) = value.get("method").and_then(|method| method.as_str()) else {
        return BackendProtocolAction::Passthrough;
    };

    match method {
        "Debugger.scriptParsed" => {
            let Some(params) = value.get("params") else {
                return BackendProtocolAction::Passthrough;
            };
            let Some(script_id) = params.get("scriptId").and_then(|script_id| script_id.as_str()) else {
                return BackendProtocolAction::Passthrough;
            };
            let Some(url) = params.get("url").and_then(|url| url.as_str()) else {
                return BackendProtocolAction::Passthrough;
            };
            if !url.is_empty() {
                script_urls.insert(script_id.to_string(), url.to_string());
            }
            if url.ends_with("?goldlight-worker-url") {
                BackendProtocolAction::Suppress
            } else {
                BackendProtocolAction::Passthrough
            }
        }
        "Debugger.paused" => {
            let Some(call_frames) = value
                .get_mut("params")
                .and_then(|params| params.get_mut("callFrames"))
                .and_then(|call_frames| call_frames.as_array_mut())
            else {
                return BackendProtocolAction::Passthrough;
            };

            *paused_call_frame_id = call_frames
                .first()
                .and_then(|call_frame| call_frame.get("callFrameId"))
                .and_then(|call_frame_id| call_frame_id.as_str())
                .map(str::to_string);

            let mut patched = false;
            for call_frame in call_frames {
                let Some(call_frame_object) = call_frame.as_object_mut() else {
                    continue;
                };

                let is_empty_url = call_frame_object
                    .get("url")
                    .and_then(|url| url.as_str())
                    .map(|url| url.is_empty())
                    .unwrap_or(true);

                if !is_empty_url {
                    continue;
                }

                let Some(script_id) = call_frame_object
                    .get("location")
                    .and_then(|location| location.get("scriptId"))
                    .and_then(|script_id| script_id.as_str())
                else {
                    continue;
                };

                let Some(url) = script_urls.get(script_id) else {
                    continue;
                };

                call_frame_object.insert("url".to_string(), serde_json::Value::String(url.clone()));
                patched = true;
            }

            if patched {
                serde_json::to_string(&value)
                    .map(BackendProtocolAction::Rewrite)
                    .unwrap_or(BackendProtocolAction::Passthrough)
            } else {
                BackendProtocolAction::Passthrough
            }
        }
        "Debugger.resumed" => {
            *paused_call_frame_id = None;
            BackendProtocolAction::Passthrough
        }
        _ => BackendProtocolAction::Passthrough,
    }
}

enum FrontendProtocolAction {
    Forward(String),
    Respond(String),
}

fn patch_frontend_protocol_message(
    message: &str,
    paused_call_frame_id: Option<&str>,
    compiled_scripts: &mut HashMap<String, String>,
    next_compiled_script_id: &mut u64,
) -> FrontendProtocolAction {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(message) else {
        return FrontendProtocolAction::Forward(message.to_string());
    };
    let Some(method) = value.get("method").and_then(|method| method.as_str()) else {
        return FrontendProtocolAction::Forward(message.to_string());
    };
    if method == "Runtime.compileScript" {
        if paused_call_frame_id.is_none() {
            return FrontendProtocolAction::Forward(message.to_string());
        }
        let Some(request_id) = value.get("id").cloned() else {
            return FrontendProtocolAction::Forward(message.to_string());
        };
        let expression = value
            .get("params")
            .and_then(|params| params.get("expression"))
            .and_then(|expression| expression.as_str())
            .unwrap_or_default()
            .to_string();
        let script_id = next_compiled_script_id.to_string();
        *next_compiled_script_id += 1;
        compiled_scripts.insert(script_id.clone(), expression);
        let response = serde_json::json!({
            "id": request_id,
            "result": {
                "scriptId": script_id,
            }
        });
        return FrontendProtocolAction::Respond(response.to_string());
    }
    if method == "Runtime.runScript" {
        let Some(paused_call_frame_id) = paused_call_frame_id else {
            return FrontendProtocolAction::Forward(message.to_string());
        };
        let Some(request_id) = value.get("id").cloned() else {
            return FrontendProtocolAction::Forward(message.to_string());
        };
        let params = value
            .get("params")
            .and_then(|params| params.as_object())
            .cloned()
            .unwrap_or_default();
        let Some(script_id) = params.get("scriptId").and_then(|script_id| script_id.as_str()) else {
            return FrontendProtocolAction::Forward(message.to_string());
        };
        let Some(expression) = compiled_scripts.remove(script_id) else {
            return FrontendProtocolAction::Forward(message.to_string());
        };

        let mut rewritten_params = serde_json::Map::new();
        rewritten_params.insert(
            "callFrameId".to_string(),
            serde_json::Value::String(paused_call_frame_id.to_string()),
        );
        rewritten_params.insert(
            "expression".to_string(),
            serde_json::Value::String(expression),
        );
        for key in [
            "objectGroup",
            "includeCommandLineAPI",
            "silent",
            "returnByValue",
            "generatePreview",
            "throwOnSideEffect",
            "timeout",
        ] {
            if let Some(value) = params.get(key) {
                rewritten_params.insert(key.to_string(), value.clone());
            }
        }
        rewritten_params.insert(
            "throwOnSideEffect".to_string(),
            serde_json::Value::Bool(false),
        );
        rewritten_params.remove("timeout");

        let rewritten = serde_json::json!({
            "id": request_id,
            "method": "Debugger.evaluateOnCallFrame",
            "params": rewritten_params,
        });
        return FrontendProtocolAction::Forward(rewritten.to_string());
    }
    if method != "Runtime.evaluate" && method != "Debugger.evaluateOnCallFrame" {
        return FrontendProtocolAction::Forward(message.to_string());
    }

    if method == "Debugger.evaluateOnCallFrame" {
        let mut rewritten = value;
        let Some(params) = rewritten.get_mut("params").and_then(|params| params.as_object_mut())
        else {
            return FrontendProtocolAction::Forward(message.to_string());
        };
        params.insert(
            "throwOnSideEffect".to_string(),
            serde_json::Value::Bool(false),
        );
        params.remove("timeout");
        return serde_json::to_string(&rewritten)
            .map(FrontendProtocolAction::Forward)
            .unwrap_or_else(|_| FrontendProtocolAction::Forward(message.to_string()));
    }

    let Some(paused_call_frame_id) = paused_call_frame_id else {
        return FrontendProtocolAction::Forward(message.to_string());
    };
    let Some(request_id) = value.get("id").cloned() else {
        return FrontendProtocolAction::Forward(message.to_string());
    };
    let params = value
        .get("params")
        .and_then(|params| params.as_object())
        .cloned()
        .unwrap_or_default();

    let mut rewritten_params = serde_json::Map::new();
    rewritten_params.insert(
        "callFrameId".to_string(),
        serde_json::Value::String(paused_call_frame_id.to_string()),
    );

    for key in [
        "expression",
        "objectGroup",
        "includeCommandLineAPI",
        "silent",
        "returnByValue",
        "generatePreview",
        "throwOnSideEffect",
        "timeout",
    ] {
        if let Some(value) = params.get(key) {
            rewritten_params.insert(key.to_string(), value.clone());
        }
    }

    let rewritten = serde_json::json!({
        "id": request_id,
        "method": "Debugger.evaluateOnCallFrame",
        "params": rewritten_params,
    });
    FrontendProtocolAction::Forward(rewritten.to_string())
}

fn remember_inspector_request_method(
    message: &str,
    request_methods: &mut HashMap<i64, String>,
) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(message) else {
        return;
    };
    let Some(id) = value.get("id").and_then(|id| id.as_i64()) else {
        return;
    };
    let Some(method) = value.get("method").and_then(|method| method.as_str()) else {
        return;
    };
    request_methods.insert(id, method.to_string());
}
