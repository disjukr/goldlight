mod drawing;
mod drawing_text;
mod fill_patch;
mod path_atlas;
mod render;
mod stroke_patch;
mod svg;
mod text;
mod text_atlas;
mod vello_compute;

use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self as std_mpsc, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
#[cfg(feature = "dev-runtime")]
use axum::extract::{Path as AxumPath, State};
#[cfg(feature = "dev-runtime")]
use axum::http::header;
#[cfg(feature = "dev-runtime")]
use axum::response::{IntoResponse, Response};
#[cfg(feature = "dev-runtime")]
use axum::routing::get;
#[cfg(feature = "dev-runtime")]
use axum::{Json, Router};
#[cfg(feature = "dev-runtime")]
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
#[cfg(feature = "dev-runtime")]
use base64::Engine;
use bytes::Bytes;
use deno_core::{
    resolve_import, resolve_path, v8, JsRuntime, ModuleLoadResponse, ModuleLoader, ModuleSource,
    ModuleSourceCode, ModuleSpecifier, ModuleType, OpState, PollEventLoopOptions,
    RequestedModuleType, ResolutionKind, RuntimeOptions,
};
#[cfg(feature = "dev-runtime")]
use deno_core::{
    InspectorMsg, InspectorSessionKind, InspectorSessionOptions, InspectorSessionProxy,
};
use deno_error::JsErrorBox;
#[cfg(feature = "dev-runtime")]
use fastwebsockets::{
    upgrade::IncomingUpgrade, WebSocket as FastWebSocket, WebSocketWrite as FastWebSocketWrite,
};
use fastwebsockets::{FragmentCollector, Frame as FastWebSocketFrame, OpCode as FastOpCode};
#[cfg(feature = "dev-runtime")]
use futures::channel::mpsc;
use futures_util::StreamExt;
use http_body_util::Empty;
use hyper::upgrade::Upgraded;
use hyper::Request;
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
#[cfg(feature = "dev-runtime")]
use serde_json::json;
use sha2::{Digest, Sha256};
#[cfg(feature = "dev-runtime")]
use std::net::{SocketAddr, TcpListener};
use taffy::prelude::{
    AlignItems, AvailableSpace, Dimension, Display, FlexDirection, FromLength, JustifyContent,
    Layout as TaffyLayout, LengthPercentage, LengthPercentageAuto, Position, Rect, Size,
    Style as TaffyStyle, TaffyTree,
};
#[cfg(feature = "dev-runtime")]
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::runtime::Builder as TokioRuntimeBuilder;
use tokio::sync::mpsc::{self as tokio_mpsc, UnboundedSender as TokioUnboundedSender};
#[cfg(feature = "dev-runtime")]
use tokio::sync::oneshot;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::ClientConfig;
use tokio_rustls::rustls::RootCertStore;
use tokio_rustls::TlsConnector;
use tracing::debug;
#[cfg(feature = "dev-runtime")]
use uuid::Uuid;
use web_transport_proto::{ConnectRequest, ConnectResponse, Settings, SettingsError};
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy},
    window::{Window, WindowAttributes, WindowId},
};

use crate::render::{
    ColorValue, Path2DHandle, Path2DOptions, Path2DUpdate, Rect2DHandle, Rect2DOptions,
    Rect2DUpdate, RenderModel, RendererBootstrap, RendererState, Scene2DHandle, Scene2DOptions,
    Scene3DHandle, Scene3DOptions, SceneCameraUpdate, SceneClearColorOptions, Text2DHandle,
    Text2DOptions, Text2DUpdate, Triangle3DHandle, Triangle3DOptions, Triangle3DUpdate,
};
use crate::text::{GlyphSubpixelOffsetInput, ShapeTextInput};

pub const GOLDLIGHT_MODULE_SPECIFIER: &str = "ext:goldlight/mod.js";
pub const GOLDLIGHT_APP_MANIFEST: &str = "goldlight.manifest.json";
#[cfg(feature = "dev-runtime")]
const INSPECTOR_PROTOCOL_JSON: &str = include_str!("../inspector_protocol.json");
const GOLDLIGHT_MODULE_SOURCE: &str = include_str!("../js/goldlight_module.js");
#[cfg(feature = "dev-runtime")]
const GOLDLIGHT_HMR_SOURCE: &str = include_str!("../js/hmr.js");
const GOLDLIGHT_WORKER_CONSOLE_SOURCE: &str = include_str!("../js/worker_console.js");
const GOLDLIGHT_ABORT_SOURCE: &str = include_str!("../js/abort.js");
const GOLDLIGHT_BLOB_SOURCE: &str = include_str!("../js/blob.js");
const GOLDLIGHT_DOM_EXCEPTION_SOURCE: &str = include_str!("../js/dom_exception.js");
const GOLDLIGHT_STREAMS_SOURCE: &str = include_str!("../js/streams.js");
const GOLDLIGHT_TIMERS_SOURCE: &str = include_str!("../js/timers.js");
const GOLDLIGHT_FETCH_SOURCE: &str = include_str!("../js/fetch.js");
const GOLDLIGHT_WEBSOCKET_SOURCE: &str = include_str!("../js/websocket.js");
const GOLDLIGHT_WEBTRANSPORT_SOURCE: &str = include_str!("../js/webtransport.js");
#[cfg(feature = "dev-runtime")]
const GOLDLIGHT_VITE_CLIENT_SPECIFIER: &str = "ext:goldlight/vite_client.js";
#[cfg(feature = "dev-runtime")]
const GOLDLIGHT_VITE_CLIENT_SOURCE: &str = "export function createHotContext(ownerPath) { return globalThis.__goldlightCreateHotContext(ownerPath); }\n";
const RUNTIME_POLL_INTERVAL_MS: u64 = 16;

#[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
fn strip_inline_source_map(code: &str) -> String {
    let marker = "\n//# sourceMappingURL=data:application/json;base64,";
    if let Some(index) = code.rfind(marker) {
        code[..index].to_string()
    } else {
        code.to_string()
    }
}

#[cfg(feature = "dev-runtime")]
fn register_hmr_runtime(
    registry: &HmrRegistryHandle,
    runtime_state: HmrRuntimeStateHandle,
) -> String {
    let runtime_id = Uuid::new_v4().to_string();
    registry
        .lock()
        .expect("hmr registry mutex poisoned")
        .insert(runtime_id.clone(), runtime_state);
    runtime_id
}

#[cfg(feature = "dev-runtime")]
fn unregister_hmr_runtime(registry: &HmrRegistryHandle, runtime_id: &str) {
    let _ = registry
        .lock()
        .expect("hmr registry mutex poisoned")
        .remove(runtime_id);
}

#[cfg(feature = "dev-runtime")]
fn broadcast_hmr_update(registry: &HmrRegistryHandle, update: HmrUpdatePayload) {
    let runtime_states = registry
        .lock()
        .expect("hmr registry mutex poisoned")
        .values()
        .cloned()
        .collect::<Vec<_>>();
    for runtime_state in runtime_states {
        if let Ok(mut runtime_state) = runtime_state.lock() {
            runtime_state.pending_updates.push(update.clone());
        }
    }
}

#[cfg(feature = "dev-runtime")]
fn inject_hot_context_prelude(code: String) -> String {
    let prelude = "globalThis.__goldlightRegisterModule(import.meta.url);import.meta.hot ??= globalThis.__goldlightCreateHotContext(import.meta.url);";
    format!("{prelude}{code}")
}

#[derive(Clone, Debug)]
pub enum RuntimeMode {
    Dev {
        vite_origin: String,
        project_root: PathBuf,
    },
    Prod {
        bundle_root: PathBuf,
    },
}

#[derive(Clone, Debug)]
pub struct RuntimeConfig {
    pub mode: RuntimeMode,
    pub entrypoint_specifier: ModuleSpecifier,
    #[cfg(feature = "dev-runtime")]
    pub inspector: Option<InspectorConfig>,
}

#[derive(Debug, Deserialize)]
struct AppManifest {
    entrypoint: String,
}

#[cfg(feature = "dev-runtime")]
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
    #[serde(default = "default_window_initial_clear_color")]
    initial_clear_color: ColorValue,
    #[serde(default = "default_window_show_policy")]
    show_policy: WindowShowPolicy,
    #[serde(default)]
    worker_entrypoint: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum WindowShowPolicy {
    Immediate,
    AfterInitialClear,
    AfterFirstPaint,
}

fn default_window_initial_clear_color() -> ColorValue {
    ColorValue {
        r: 1.0,
        g: 1.0,
        b: 1.0,
        a: 1.0,
    }
}

fn default_window_show_policy() -> WindowShowPolicy {
    WindowShowPolicy::AfterInitialClear
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

#[derive(Default)]
struct TimerHostState {
    next_timer_id: u32,
    timers: HashMap<u32, TimerEntry>,
}

#[derive(Default)]
struct WebSocketHostState {
    next_socket_id: u32,
    sockets: HashMap<u32, WebSocketConnectionHandle>,
    buffered_amounts: HashMap<u32, u32>,
    pending_events: Vec<WebSocketEventPayload>,
}

#[derive(Default)]
struct FetchHostState {
    next_request_id: u32,
    requests: HashMap<u32, FetchRequestHandle>,
    pending_events: Vec<FetchEventPayload>,
}

#[derive(Default)]
struct WebTransportHostState {
    next_transport_id: u32,
    transports: HashMap<u32, WebTransportHandle>,
    next_send_stream_id: u32,
    send_streams: HashMap<u32, WebTransportSendStreamHandle>,
    next_recv_stream_id: u32,
    recv_streams: HashMap<u32, WebTransportRecvStreamHandle>,
}

#[cfg(feature = "dev-runtime")]
#[derive(Default)]
struct HmrRuntimeState {
    pending_updates: Vec<HmrUpdatePayload>,
}

#[cfg(feature = "dev-runtime")]
type HmrRuntimeStateHandle = Arc<Mutex<HmrRuntimeState>>;
#[cfg(feature = "dev-runtime")]
type HmrRegistryHandle = Arc<Mutex<HashMap<String, HmrRuntimeStateHandle>>>;
#[cfg(not(feature = "dev-runtime"))]
type HmrRuntimeStateHandle = ();
#[cfg(not(feature = "dev-runtime"))]
type HmrRegistryHandle = ();

#[cfg(feature = "dev-runtime")]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HmrUpdatePayload {
    path: String,
    #[serde(default)]
    accepted_path: Option<String>,
    timestamp: u64,
}

struct TimerEntry {
    next_fire_at: std::time::Instant,
    interval: Option<Duration>,
}

struct FetchRequestHandle {
    abort_tx: tokio::sync::watch::Sender<bool>,
    body_tx: Option<TokioUnboundedSender<FetchBodyCommand>>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl FetchRequestHandle {
    fn shutdown(mut self) {
        let _ = self.abort_tx.send(true);
        if let Some(thread_handle) = self.thread_handle.take() {
            thread::spawn(move || {
                let _ = thread_handle.join();
            });
        }
    }
}

enum WebSocketCommand {
    SendText {
        payload: String,
        queued_bytes: u32,
    },
    SendBinary {
        payload: Vec<u8>,
        queued_bytes: u32,
    },
    Close {
        code: Option<u16>,
        reason: Option<String>,
    },
    Shutdown,
}

enum FetchBodyCommand {
    Chunk(Vec<u8>),
    Done,
}

struct WebSocketConnectionHandle {
    command_tx: TokioUnboundedSender<WebSocketCommand>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl WebSocketConnectionHandle {
    fn shutdown(mut self) {
        let _ = self.command_tx.send(WebSocketCommand::Shutdown);
        if let Some(thread_handle) = self.thread_handle.take() {
            thread::spawn(move || {
                let _ = thread_handle.join();
            });
        }
    }
}

#[derive(Clone)]
struct WebTransportHandle {
    _endpoint: quinn::Endpoint,
    connection: quinn::Connection,
}

impl WebTransportHandle {
    fn close(&self, close_code: u32, reason: &str) {
        let code = quinn::VarInt::from_u32(close_code);
        self.connection.close(code, reason.as_bytes());
    }
}

#[derive(Clone)]
struct WebTransportSendStreamHandle {
    transport_id: u32,
    stream: Arc<tokio::sync::Mutex<quinn::SendStream>>,
}

#[derive(Clone)]
struct WebTransportRecvStreamHandle {
    transport_id: u32,
    stream: Arc<tokio::sync::Mutex<quinn::RecvStream>>,
}

#[derive(Clone, Debug)]
struct PendingWindow {
    id: u32,
    title: String,
    width: u32,
    height: u32,
    initial_clear_color: ColorValue,
    show_policy: WindowShowPolicy,
    worker_entrypoint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WorkerEventPayload {
    Resize {
        width: u32,
        height: u32,
    },
    AnimationFrame {
        #[serde(rename = "timestampMs")]
        timestamp_ms: f64,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WebSocketEventPayload {
    Open {
        socket_id: u32,
        protocol: Option<String>,
        extensions: Option<String>,
    },
    Message {
        socket_id: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        data_text: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        data_binary: Option<Vec<u8>>,
    },
    Error {
        socket_id: u32,
        message: String,
    },
    Close {
        socket_id: u32,
        code: Option<u16>,
        reason: Option<String>,
        was_clean: bool,
    },
}

#[derive(Default)]
struct WorkerHostState {
    pending_events: Vec<WorkerEventPayload>,
    animation_frame_requested: bool,
    render_model: RenderModel,
    render_model_revision: u64,
    published_render_model: Option<Arc<RenderModel>>,
    published_render_model_revision: Option<u64>,
    published_render_model_pending: bool,
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
            match event {
                WorkerEventPayload::Resize { width, height } => {
                    let mut merged = false;
                    for pending_event in state.pending_events.iter_mut().rev() {
                        if let WorkerEventPayload::Resize {
                            width: pending_width,
                            height: pending_height,
                        } = pending_event
                        {
                            *pending_width = width;
                            *pending_height = height;
                            merged = true;
                            break;
                        }
                    }
                    if !merged {
                        state
                            .pending_events
                            .push(WorkerEventPayload::Resize { width, height });
                    }
                }
                WorkerEventPayload::AnimationFrame { timestamp_ms } => {
                    let mut merged = false;
                    for pending_event in state.pending_events.iter_mut().rev() {
                        if let WorkerEventPayload::AnimationFrame {
                            timestamp_ms: pending_timestamp_ms,
                        } = pending_event
                        {
                            *pending_timestamp_ms = timestamp_ms;
                            merged = true;
                            break;
                        }
                    }
                    if !merged {
                        state
                            .pending_events
                            .push(WorkerEventPayload::AnimationFrame { timestamp_ms });
                    }
                }
            }
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

    fn take_published_render_model(&self) -> Option<Arc<RenderModel>> {
        if let Ok(mut state) = self.state.lock() {
            if !state.published_render_model_pending {
                return None;
            }
            state.published_render_model_pending = false;
            return state.published_render_model.clone();
        }

        None
    }

    fn shutdown(mut self) {
        let _ = self.control_tx.send(WindowWorkerControl::Shutdown);
        if let Some(thread_handle) = self.thread_handle.take() {
            thread::spawn(move || {
                let _ = thread_handle.join();
            });
        }
    }
}

struct WindowRendererInitHandle {
    result_rx: std_mpsc::Receiver<Result<RendererState>>,
}

enum WindowRendererState {
    Pending(WindowRendererInitHandle),
    Ready(RendererState),
    Failed,
}

struct WindowRecord {
    window: Arc<Window>,
    worker: Option<WindowWorkerHandle>,
    renderer: WindowRendererState,
    render_model_snapshot: Option<Arc<RenderModel>>,
    pending_resize: Option<winit::dpi::PhysicalSize<u32>>,
    initial_clear_color: ColorValue,
    show_policy: WindowShowPolicy,
    startup_presented: bool,
}

fn spawn_window_renderer(
    bootstrap: RendererBootstrap,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
) -> WindowRendererInitHandle {
    let (result_tx, result_rx) = std_mpsc::channel();
    thread::spawn(move || {
        let _ = result_tx.send(RendererState::new(bootstrap));
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    });
    WindowRendererInitHandle { result_rx }
}

#[derive(Clone)]
struct RuntimeOpContext {
    state: RuntimeStateHandle,
    event_proxy: Option<EventLoopProxy<RuntimeUserEvent>>,
    worker_state: Option<WorkerHostStateHandle>,
    timer_state: TimerHostStateHandle,
    fetch_state: FetchHostStateHandle,
    websocket_state: WebSocketHostStateHandle,
    webtransport_state: WebTransportHostStateHandle,
    #[cfg(feature = "dev-runtime")]
    hmr_state: Option<HmrRuntimeStateHandle>,
}

type RuntimeStateHandle = Arc<Mutex<RuntimeState>>;
type TimerHostStateHandle = Arc<Mutex<TimerHostState>>;
type FetchHostStateHandle = Arc<Mutex<FetchHostState>>;
type WebSocketHostStateHandle = Arc<Mutex<WebSocketHostState>>;
type WebTransportHostStateHandle = Arc<Mutex<WebTransportHostState>>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchRequestInput {
    url: String,
    method: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<Vec<u8>>,
    #[serde(default)]
    streaming_body: bool,
    #[serde(default)]
    redirect: Option<String>,
    #[serde(default)]
    credentials: Option<String>,
    #[serde(default)]
    cache: Option<String>,
    #[serde(default)]
    referrer: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum FetchEventPayload {
    Response {
        request_id: u32,
        url: String,
        status: u16,
        status_text: String,
        headers: Vec<(String, String)>,
    },
    Chunk {
        request_id: u32,
        chunk: Vec<u8>,
    },
    Done {
        request_id: u32,
    },
    Error {
        request_id: u32,
        message: String,
    },
    Aborted {
        request_id: u32,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebTransportCertificateHashInput {
    algorithm: String,
    value: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WebTransportConnectOptionsInput {
    #[serde(default)]
    server_certificate_hashes: Vec<WebTransportCertificateHashInput>,
    #[serde(default)]
    congestion_control: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebTransportConnectOutput {
    transport_id: u32,
    max_datagram_size: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebTransportCloseInfoOutput {
    close_code: u32,
    reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebTransportBidirectionalStreamOutput {
    send_stream_id: u32,
    receive_stream_id: u32,
}

const GOLDLIGHT_WEBTRANSPORT_ERROR_MARKER: &str = "\n[goldlight-webtransport-error]";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebTransportErrorOutput {
    message: String,
    source: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_error_code: Option<u32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutStyleInput {
    #[serde(default)]
    position: Option<String>,
    #[serde(default)]
    x: Option<f32>,
    #[serde(default)]
    y: Option<f32>,
    #[serde(default)]
    width: Option<f32>,
    #[serde(default)]
    height: Option<f32>,
    #[serde(default)]
    min_width: Option<f32>,
    #[serde(default)]
    min_height: Option<f32>,
    #[serde(default)]
    max_width: Option<f32>,
    #[serde(default)]
    max_height: Option<f32>,
    #[serde(default)]
    display: Option<String>,
    #[serde(default)]
    flex_direction: Option<String>,
    #[serde(default)]
    justify_content: Option<String>,
    #[serde(default)]
    align_items: Option<String>,
    #[serde(default)]
    gap: Option<f32>,
    #[serde(default)]
    padding: Option<f32>,
    #[serde(default)]
    padding_x: Option<f32>,
    #[serde(default)]
    padding_y: Option<f32>,
    #[serde(default)]
    padding_top: Option<f32>,
    #[serde(default)]
    padding_right: Option<f32>,
    #[serde(default)]
    padding_bottom: Option<f32>,
    #[serde(default)]
    padding_left: Option<f32>,
    #[serde(default)]
    margin: Option<f32>,
    #[serde(default)]
    margin_x: Option<f32>,
    #[serde(default)]
    margin_y: Option<f32>,
    #[serde(default)]
    margin_top: Option<f32>,
    #[serde(default)]
    margin_right: Option<f32>,
    #[serde(default)]
    margin_bottom: Option<f32>,
    #[serde(default)]
    margin_left: Option<f32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutNodeInput {
    id: u32,
    #[serde(default)]
    style: LayoutStyleInput,
    #[serde(default)]
    children: Vec<LayoutNodeInput>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ComputedLayoutOutput {
    id: u32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

fn point_dimension(value: Option<f32>) -> Dimension {
    value.map(Dimension::from_length).unwrap_or(Dimension::Auto)
}

fn length(value: Option<f32>) -> LengthPercentage {
    LengthPercentage::from_length(value.unwrap_or(0.0))
}

fn length_auto(value: Option<f32>) -> LengthPercentageAuto {
    value
        .map(LengthPercentageAuto::from_length)
        .unwrap_or(LengthPercentageAuto::Length(0.0))
}

fn build_padding_rect(style: &LayoutStyleInput) -> Rect<LengthPercentage> {
    let horizontal = style.padding_x.or(style.padding);
    let vertical = style.padding_y.or(style.padding);
    Rect {
        left: length(style.padding_left.or(horizontal)),
        right: length(style.padding_right.or(horizontal)),
        top: length(style.padding_top.or(vertical)),
        bottom: length(style.padding_bottom.or(vertical)),
    }
}

fn build_margin_rect(style: &LayoutStyleInput) -> Rect<LengthPercentageAuto> {
    let horizontal = style.margin_x.or(style.margin);
    let vertical = style.margin_y.or(style.margin);
    Rect {
        left: length_auto(style.margin_left.or(horizontal)),
        right: length_auto(style.margin_right.or(horizontal)),
        top: length_auto(style.margin_top.or(vertical)),
        bottom: length_auto(style.margin_bottom.or(vertical)),
    }
}

fn position_from_input(value: Option<&str>) -> Position {
    match value {
        Some("absolute") => Position::Absolute,
        _ => Position::Relative,
    }
}

fn display_from_input(value: Option<&str>) -> Display {
    match value {
        Some("flex") => Display::Flex,
        _ => Display::Block,
    }
}

fn flex_direction_from_input(value: Option<&str>) -> FlexDirection {
    match value {
        Some("column") => FlexDirection::Column,
        _ => FlexDirection::Row,
    }
}

fn justify_content_from_input(value: Option<&str>) -> Option<JustifyContent> {
    match value {
        Some("start") => Some(JustifyContent::Start),
        Some("center") => Some(JustifyContent::Center),
        Some("end") => Some(JustifyContent::End),
        Some("spaceBetween") => Some(JustifyContent::SpaceBetween),
        _ => None,
    }
}

fn align_items_from_input(value: Option<&str>) -> Option<AlignItems> {
    match value {
        Some("start") => Some(AlignItems::Start),
        Some("center") => Some(AlignItems::Center),
        Some("end") => Some(AlignItems::End),
        Some("stretch") => Some(AlignItems::Stretch),
        _ => None,
    }
}

fn build_taffy_style(style: &LayoutStyleInput) -> TaffyStyle {
    TaffyStyle {
        display: display_from_input(style.display.as_deref()),
        position: position_from_input(style.position.as_deref()),
        flex_direction: flex_direction_from_input(style.flex_direction.as_deref()),
        justify_content: justify_content_from_input(style.justify_content.as_deref()),
        align_items: align_items_from_input(style.align_items.as_deref()),
        size: Size {
            width: point_dimension(style.width),
            height: point_dimension(style.height),
        },
        min_size: Size {
            width: point_dimension(style.min_width),
            height: point_dimension(style.min_height),
        },
        max_size: Size {
            width: point_dimension(style.max_width),
            height: point_dimension(style.max_height),
        },
        inset: Rect {
            left: length_auto(style.x),
            right: LengthPercentageAuto::Auto,
            top: length_auto(style.y),
            bottom: LengthPercentageAuto::Auto,
        },
        padding: build_padding_rect(style),
        margin: build_margin_rect(style),
        gap: Size {
            width: LengthPercentage::from_length(style.gap.unwrap_or(0.0)),
            height: LengthPercentage::from_length(style.gap.unwrap_or(0.0)),
        },
        ..Default::default()
    }
}

fn add_layout_node(
    taffy: &mut TaffyTree<()>,
    node: &LayoutNodeInput,
    computed: &mut Vec<(u32, taffy::prelude::NodeId)>,
) -> Result<taffy::prelude::NodeId> {
    let child_ids = node
        .children
        .iter()
        .map(|child| add_layout_node(taffy, child, computed))
        .collect::<Result<Vec<_>>>()?;
    let style = build_taffy_style(&node.style);
    let node_id = taffy
        .new_with_children(style, &child_ids)
        .map_err(|error| anyhow!("failed to create taffy node: {error}"))?;
    computed.push((node.id, node_id));
    Ok(node_id)
}

#[deno_core::op2]
#[serde]
fn op_goldlight_compute_layout(
    #[serde] root: LayoutNodeInput,
) -> Result<Vec<ComputedLayoutOutput>, JsErrorBox> {
    let mut taffy = TaffyTree::<()>::new();
    let mut nodes = Vec::new();
    let root_id = add_layout_node(&mut taffy, &root, &mut nodes)
        .map_err(|error| JsErrorBox::generic(error.to_string()))?;
    taffy
        .compute_layout(
            root_id,
            Size {
                width: AvailableSpace::MaxContent,
                height: AvailableSpace::MaxContent,
            },
        )
        .map_err(|error| JsErrorBox::generic(format!("failed to compute layout: {error}")))?;

    nodes.sort_by_key(|(id, _)| *id);
    let mut results = Vec::with_capacity(nodes.len());
    for (id, node_id) in nodes {
        let TaffyLayout { size, location, .. } = taffy
            .layout(node_id)
            .map_err(|error| JsErrorBox::generic(format!("failed to read layout: {error}")))?;
        results.push(ComputedLayoutOutput {
            id,
            x: location.x,
            y: location.y,
            width: size.width,
            height: size.height,
        });
    }
    Ok(results)
}

#[derive(Clone, Debug)]
enum RuntimeUserEvent {
    Wake,
    #[cfg(feature = "dev-runtime")]
    HotReload,
}

pub enum RuntimeRunResult {
    Completed,
    RestartRequested,
}

fn with_worker_render_model_mutation<R>(
    state: &mut OpState,
    mutate: impl FnOnce(&mut WorkerHostState) -> Result<R>,
) -> Result<R, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let worker_state = op_context
        .worker_state
        .ok_or_else(|| JsErrorBox::generic("this API is only available in a window worker"))?;
    let result = {
        let mut worker_state = worker_state
            .lock()
            .map_err(|_| JsErrorBox::generic("worker state mutex poisoned"))?;
        let result =
            mutate(&mut worker_state).map_err(|error| JsErrorBox::generic(error.to_string()))?;
        worker_state.render_model_revision = worker_state.render_model_revision.wrapping_add(1);
        result
    };
    if let Some(event_proxy) = op_context.event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }
    Ok(result)
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
        initial_clear_color: options.initial_clear_color,
        show_policy: options.show_policy,
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
    let worker_state = op_context.worker_state.ok_or_else(|| {
        JsErrorBox::generic("requestAnimationFrame is only available in a window worker")
    })?;
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
    let worker_state = op_context.worker_state.ok_or_else(|| {
        JsErrorBox::generic("window events are only available in a window worker")
    })?;
    let mut worker_state = worker_state
        .lock()
        .map_err(|_| JsErrorBox::generic("worker state mutex poisoned"))?;
    Ok(std::mem::take(&mut worker_state.pending_events))
}

#[cfg(feature = "dev-runtime")]
#[deno_core::op2]
#[serde]
fn op_goldlight_hmr_drain_updates(
    state: &mut OpState,
) -> Result<Vec<HmrUpdatePayload>, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let hmr_state = op_context
        .hmr_state
        .ok_or_else(|| JsErrorBox::generic("HMR is only available in the dev runtime"))?;
    let mut hmr_state = hmr_state
        .lock()
        .map_err(|_| JsErrorBox::generic("hmr state mutex poisoned"))?;
    Ok(std::mem::take(&mut hmr_state.pending_updates))
}

#[cfg(feature = "dev-runtime")]
#[deno_core::op2(fast)]
fn op_goldlight_hmr_request_restart(state: &mut OpState) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    if let Some(event_proxy) = op_context.event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::HotReload);
    }
    Ok(())
}

#[deno_core::op2(fast)]
fn op_goldlight_timer_schedule(
    state: &mut OpState,
    delay_ms: f64,
    repeat: bool,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let timer_id = {
        let mut timer_state = op_context
            .timer_state
            .lock()
            .map_err(|_| JsErrorBox::generic("timer state mutex poisoned"))?;
        let timer_id = timer_state.next_timer_id;
        timer_state.next_timer_id = timer_state.next_timer_id.wrapping_add(1).max(1);
        let delay = Duration::from_secs_f64((delay_ms.max(0.0)) / 1000.0);
        timer_state.timers.insert(
            timer_id,
            TimerEntry {
                next_fire_at: std::time::Instant::now() + delay,
                interval: repeat.then_some(delay),
            },
        );
        timer_id
    };
    if let Some(event_proxy) = op_context.event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }
    Ok(timer_id)
}

#[deno_core::op2(fast)]
fn op_goldlight_timer_cancel(state: &mut OpState, timer_id: u32) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let mut timer_state = op_context
        .timer_state
        .lock()
        .map_err(|_| JsErrorBox::generic("timer state mutex poisoned"))?;
    timer_state.timers.remove(&timer_id);
    Ok(())
}

#[deno_core::op2]
#[serde]
fn op_goldlight_timer_drain_ready(state: &mut OpState) -> Result<Vec<u32>, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let mut timer_state = op_context
        .timer_state
        .lock()
        .map_err(|_| JsErrorBox::generic("timer state mutex poisoned"))?;
    let now = std::time::Instant::now();
    let mut ready = Vec::new();
    let timer_ids: Vec<u32> = timer_state.timers.keys().copied().collect();
    for timer_id in timer_ids {
        let Some(entry) = timer_state.timers.get_mut(&timer_id) else {
            continue;
        };
        if entry.next_fire_at > now {
            continue;
        }
        ready.push(timer_id);
        if let Some(interval) = entry.interval {
            entry.next_fire_at = now + interval;
        } else {
            timer_state.timers.remove(&timer_id);
        }
    }
    Ok(ready)
}

fn push_fetch_event(
    fetch_state: &FetchHostStateHandle,
    event_proxy: &Option<EventLoopProxy<RuntimeUserEvent>>,
    event: FetchEventPayload,
) {
    if let Ok(mut fetch_state) = fetch_state.lock() {
        fetch_state.pending_events.push(event);
    }
    if let Some(event_proxy) = event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }
}

fn spawn_fetch_request(
    request_id: u32,
    request: FetchRequestInput,
    fetch_state: FetchHostStateHandle,
    event_proxy: Option<EventLoopProxy<RuntimeUserEvent>>,
) -> Result<FetchRequestHandle, JsErrorBox> {
    let (abort_tx, abort_rx) = tokio::sync::watch::channel(false);
    let (body_tx, body_rx) = if request.streaming_body {
        let (tx, rx) = tokio_mpsc::unbounded_channel::<FetchBodyCommand>();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };
    let thread_handle = thread::Builder::new()
        .name(format!("goldlight-fetch-{request_id}"))
        .spawn(move || {
            let runtime = match TokioRuntimeBuilder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => {
                    push_fetch_event(
                        &fetch_state,
                        &event_proxy,
                        FetchEventPayload::Error {
                            request_id,
                            message: format!("failed to create fetch runtime: {error}"),
                        },
                    );
                    return;
                }
            };

            runtime.block_on(async move {
                let mut abort_rx = abort_rx;
                let redirect_mode = request.redirect.as_deref().unwrap_or("follow");
                let redirect_policy = match redirect_mode {
                    "error" | "manual" => reqwest::redirect::Policy::none(),
                    _ => reqwest::redirect::Policy::limited(20),
                };
                let client = match reqwest::Client::builder()
                    .redirect(redirect_policy)
                    .build()
                {
                    Ok(client) => client,
                    Err(error) => {
                        push_fetch_event(
                            &fetch_state,
                            &event_proxy,
                            FetchEventPayload::Error {
                                request_id,
                                message: format!("failed to create fetch client: {error}"),
                            },
                        );
                        return;
                    }
                };
                let method = match reqwest::Method::from_bytes(request.method.as_bytes()) {
                    Ok(method) => method,
                    Err(error) => {
                        push_fetch_event(
                            &fetch_state,
                            &event_proxy,
                            FetchEventPayload::Error {
                                request_id,
                                message: format!("invalid request method: {error}"),
                            },
                        );
                        return;
                    }
                };
                let mut builder = client.request(method, &request.url);
                for (name, value) in request.headers {
                    builder = builder.header(&name, &value);
                }
                let credentials_mode = request.credentials.as_deref().unwrap_or("same-origin");
                if credentials_mode == "omit" {
                    builder = builder.header(reqwest::header::COOKIE, "");
                    builder = builder.header(reqwest::header::AUTHORIZATION, "");
                    builder = builder.header("proxy-authorization", "");
                }
                let cache_mode = request.cache.as_deref().unwrap_or("default");
                match cache_mode {
                    "no-store" => {
                        builder = builder.header(reqwest::header::CACHE_CONTROL, "no-store");
                        builder = builder.header(reqwest::header::PRAGMA, "no-cache");
                    }
                    "reload" => {
                        builder = builder.header(reqwest::header::CACHE_CONTROL, "no-cache");
                        builder = builder.header(reqwest::header::PRAGMA, "no-cache");
                    }
                    "no-cache" => {
                        builder = builder.header(reqwest::header::CACHE_CONTROL, "no-cache");
                    }
                    "force-cache" => {
                        builder = builder.header(reqwest::header::CACHE_CONTROL, "only-if-cached, max-age=2147483647");
                    }
                    "only-if-cached" => {
                        builder = builder.header(reqwest::header::CACHE_CONTROL, "only-if-cached");
                    }
                    _ => {}
                }
                if let Some(referrer) = &request.referrer {
                    if !referrer.is_empty() {
                        builder = builder.header(reqwest::header::REFERER, referrer);
                    }
                }
                if request.streaming_body {
                    let mut body_rx = body_rx.expect("streaming body receiver missing");
                    let mut body_abort_rx = abort_rx.clone();
                    let body_stream = async_stream::stream! {
                        loop {
                            tokio::select! {
                                changed = body_abort_rx.changed() => {
                                    match changed {
                                        Ok(()) if *body_abort_rx.borrow() => {
                                            yield Err(std::io::Error::other("fetch aborted"));
                                            return;
                                        }
                                        _ => return,
                                    }
                                }
                                command = body_rx.recv() => {
                                    match command {
                                        Some(FetchBodyCommand::Chunk(chunk)) => {
                                            yield Ok::<bytes::Bytes, std::io::Error>(bytes::Bytes::from(chunk));
                                        }
                                        Some(FetchBodyCommand::Done) | None => {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    };
                    builder = builder.body(reqwest::Body::wrap_stream(body_stream));
                } else if let Some(body) = request.body {
                    builder = builder.body(body);
                }

                let send_result = tokio::select! {
                    changed = abort_rx.changed() => {
                        match changed {
                            Ok(()) if *abort_rx.borrow() => {
                                push_fetch_event(&fetch_state, &event_proxy, FetchEventPayload::Aborted { request_id });
                                return;
                            }
                            _ => return,
                        }
                    }
                    response = builder.send() => response,
                };

                let response = match send_result {
                    Ok(response) => response,
                    Err(error) => {
                        if *abort_rx.borrow() {
                            push_fetch_event(&fetch_state, &event_proxy, FetchEventPayload::Aborted { request_id });
                            return;
                        }
                        push_fetch_event(
                            &fetch_state,
                            &event_proxy,
                            FetchEventPayload::Error {
                                request_id,
                                message: format!("fetch failed: {error}"),
                            },
                        );
                        return;
                    }
                };

                if redirect_mode == "error" && response.status().is_redirection() {
                    push_fetch_event(
                        &fetch_state,
                        &event_proxy,
                        FetchEventPayload::Error {
                            request_id,
                            message: "redirects are not allowed for this request".to_string(),
                        },
                    );
                    return;
                }

                let status = response.status();
                let url = response.url().to_string();
                let status_text = status.canonical_reason().unwrap_or("").to_string();
                let headers = response
                    .headers()
                    .iter()
                    .filter_map(|(name, value)| {
                        value
                            .to_str()
                            .ok()
                            .map(|value| (name.as_str().to_string(), value.to_string()))
                    })
                    .collect::<Vec<_>>();
                push_fetch_event(
                    &fetch_state,
                    &event_proxy,
                    FetchEventPayload::Response {
                        request_id,
                        url,
                        status: status.as_u16(),
                        status_text,
                        headers,
                    },
                );

                let mut stream = response.bytes_stream();
                loop {
                    tokio::select! {
                        changed = abort_rx.changed() => {
                            match changed {
                                Ok(()) if *abort_rx.borrow() => {
                                    push_fetch_event(&fetch_state, &event_proxy, FetchEventPayload::Aborted { request_id });
                                    return;
                                }
                                _ => break,
                            }
                        }
                        next_chunk = stream.next() => {
                            match next_chunk {
                                Some(Ok(chunk)) => {
                                    push_fetch_event(
                                        &fetch_state,
                                        &event_proxy,
                                        FetchEventPayload::Chunk {
                                            request_id,
                                            chunk: chunk.to_vec(),
                                        },
                                    );
                                }
                                Some(Err(error)) => {
                                    push_fetch_event(
                                        &fetch_state,
                                        &event_proxy,
                                        FetchEventPayload::Error {
                                            request_id,
                                            message: format!("failed to read response body: {error}"),
                                        },
                                    );
                                    return;
                                }
                                None => {
                                    push_fetch_event(&fetch_state, &event_proxy, FetchEventPayload::Done { request_id });
                                    return;
                                }
                            }
                        }
                    }
                }
            });
        })
        .map_err(|error| JsErrorBox::generic(format!("failed to spawn fetch thread: {error}")))?;

    Ok(FetchRequestHandle {
        abort_tx,
        body_tx,
        thread_handle: Some(thread_handle),
    })
}

fn shutdown_all_fetch_requests(fetch_state: &FetchHostStateHandle) {
    let requests = if let Ok(mut fetch_state) = fetch_state.lock() {
        std::mem::take(&mut fetch_state.requests)
    } else {
        HashMap::new()
    };
    for (_, request) in requests {
        request.shutdown();
    }
}

fn push_websocket_event(
    websocket_state: &WebSocketHostStateHandle,
    event_proxy: &Option<EventLoopProxy<RuntimeUserEvent>>,
    event: WebSocketEventPayload,
) {
    if let Ok(mut websocket_state) = websocket_state.lock() {
        websocket_state.pending_events.push(event);
    }
    if let Some(event_proxy) = event_proxy {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }
}

trait AsyncReadWrite: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T> AsyncReadWrite for T where T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}

struct TokioSpawnExecutor;

impl hyper::rt::Executor<std::pin::Pin<Box<dyn Future<Output = ()> + Send>>>
    for TokioSpawnExecutor
{
    fn execute(&self, fut: std::pin::Pin<Box<dyn Future<Output = ()> + Send>>) {
        tokio::task::spawn(fut);
    }
}

fn websocket_tls_connector() -> TlsConnector {
    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();

    TlsConnector::from(Arc::new(config))
}

#[derive(Debug)]
struct WebTransportServerFingerprints {
    fingerprints: Vec<Vec<u8>>,
    provider: quinn::rustls::crypto::CryptoProvider,
}

impl WebTransportServerFingerprints {
    fn new(fingerprints: Vec<Vec<u8>>) -> Self {
        Self {
            fingerprints,
            provider: quinn::rustls::crypto::aws_lc_rs::default_provider(),
        }
    }
}

impl quinn::rustls::client::danger::ServerCertVerifier for WebTransportServerFingerprints {
    fn verify_server_cert(
        &self,
        end_entity: &quinn::rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[quinn::rustls::pki_types::CertificateDer<'_>],
        _server_name: &quinn::rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: quinn::rustls::pki_types::UnixTime,
    ) -> std::result::Result<quinn::rustls::client::danger::ServerCertVerified, quinn::rustls::Error>
    {
        let cert_hash = Sha256::digest(end_entity.as_ref());
        if self
            .fingerprints
            .iter()
            .any(|fingerprint| fingerprint.as_slice() == cert_hash.as_slice())
        {
            return Ok(quinn::rustls::client::danger::ServerCertVerified::assertion());
        }

        Err(quinn::rustls::Error::InvalidCertificate(
            quinn::rustls::CertificateError::UnknownIssuer,
        ))
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &quinn::rustls::pki_types::CertificateDer<'_>,
        dss: &quinn::rustls::DigitallySignedStruct,
    ) -> std::result::Result<
        quinn::rustls::client::danger::HandshakeSignatureValid,
        quinn::rustls::Error,
    > {
        quinn::rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &quinn::rustls::pki_types::CertificateDer<'_>,
        dss: &quinn::rustls::DigitallySignedStruct,
    ) -> std::result::Result<
        quinn::rustls::client::danger::HandshakeSignatureValid,
        quinn::rustls::Error,
    > {
        quinn::rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<quinn::rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn webtransport_root_store() -> RootCertStore {
    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    root_store
}

fn webtransport_client_config(
    options: &WebTransportConnectOptionsInput,
) -> Result<quinn::ClientConfig, JsErrorBox> {
    let mut tls_config = if options.server_certificate_hashes.is_empty() {
        quinn::rustls::ClientConfig::builder()
            .with_root_certificates(webtransport_root_store())
            .with_no_client_auth()
    } else {
        let hashes = options
            .server_certificate_hashes
            .iter()
            .filter(|hash| hash.algorithm.eq_ignore_ascii_case("sha-256"))
            .map(|hash| hash.value.clone())
            .collect::<Vec<_>>();
        quinn::rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(WebTransportServerFingerprints::new(hashes)))
            .with_no_client_auth()
    };

    tls_config.alpn_protocols = vec![b"h3".to_vec()];
    tls_config.enable_early_data = true;

    let client_crypto =
        quinn::crypto::rustls::QuicClientConfig::try_from(tls_config).map_err(|error| {
            webtransport_session_error(format!("failed to create QUIC client config: {error}"))
        })?;
    let mut client_config = quinn::ClientConfig::new(Arc::new(client_crypto));
    let mut transport = quinn::TransportConfig::default();
    if let Some(congestion_control) = options.congestion_control.as_deref() {
        match congestion_control {
            "low-latency" => {
                transport.congestion_controller_factory(Arc::new(
                    quinn::congestion::BbrConfig::default(),
                ));
            }
            "throughput" => {
                transport.congestion_controller_factory(Arc::new(
                    quinn::congestion::CubicConfig::default(),
                ));
            }
            _ => {}
        }
    }
    client_config.transport_config(Arc::new(transport));
    Ok(client_config)
}

async fn exchange_webtransport_settings(
    connection: &quinn::Connection,
) -> Result<(quinn::SendStream, quinn::RecvStream), JsErrorBox> {
    let settings_send = async {
        let mut tx = connection
            .open_uni()
            .await
            .map_err(|error| webtransport_connection_error(error, "session"))?;
        let mut settings = Settings::default();
        settings.enable_webtransport(1);
        let mut buf = Vec::new();
        settings.encode(&mut buf);
        tx.write_all(&buf)
            .await
            .map_err(|error| webtransport_write_error_with_source(error, "session"))?;
        Result::<_, JsErrorBox>::Ok(tx)
    };

    let settings_recv = async {
        let mut rx = connection
            .accept_uni()
            .await
            .map_err(|error| webtransport_connection_error(error, "session"))?;
        let mut buf = Vec::new();
        loop {
            let chunk = rx
                .read_chunk(usize::MAX, true)
                .await
                .map_err(|error| webtransport_read_error_with_source(error, "session"))?;
            let chunk = chunk
                .ok_or_else(|| webtransport_session_error("peer does not support WebTransport"))?;
            buf.extend_from_slice(&chunk.bytes);
            let mut cursor = std::io::Cursor::new(&buf);
            let settings = match Settings::decode(&mut cursor) {
                Ok(settings) => settings,
                Err(SettingsError::UnexpectedEnd) => continue,
                Err(error) => return Err(webtransport_session_error(error.to_string())),
            };
            if settings.supports_webtransport() == 0 {
                return Err(webtransport_session_error(
                    "peer does not support WebTransport",
                ));
            }
            break;
        }
        Result::<_, JsErrorBox>::Ok(rx)
    };

    tokio::try_join!(settings_send, settings_recv)
}

async fn connect_webtransport(
    url: &str,
    options: &WebTransportConnectOptionsInput,
) -> Result<(quinn::Endpoint, quinn::Connection), JsErrorBox> {
    let parsed = reqwest::Url::parse(url).map_err(|error| {
        webtransport_session_error(format!("invalid WebTransport URL: {error}"))
    })?;
    if parsed.scheme() != "https" {
        return Err(webtransport_session_error(
            "WebTransport URL must use https",
        ));
    }
    let host = parsed.host_str().ok_or_else(|| {
        webtransport_session_error(format!("WebTransport URL missing host: {url}"))
    })?;
    let port = parsed.port_or_known_default().ok_or_else(|| {
        webtransport_session_error(format!("WebTransport URL missing port: {url}"))
    })?;

    let socket = std::net::UdpSocket::bind((std::net::Ipv6Addr::UNSPECIFIED, 0))
        .or_else(|_| std::net::UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)))
        .map_err(|error| webtransport_session_error(error.to_string()))?;
    let endpoint = quinn::Endpoint::new(
        quinn::EndpointConfig::default(),
        None,
        socket,
        quinn::default_runtime()
            .ok_or_else(|| webtransport_session_error("missing QUIC runtime"))?,
    )
    .map_err(|error| webtransport_session_error(error.to_string()))?;
    let client_config = webtransport_client_config(options)?;
    let remote_addr = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| webtransport_session_error(error.to_string()))?
        .next()
        .ok_or_else(|| webtransport_session_error("unable to resolve WebTransport host"))?;
    let connecting = endpoint
        .connect_with(client_config, remote_addr, host)
        .map_err(|error| webtransport_session_error(error.to_string()))?;
    let connection = connecting
        .await
        .map_err(|error| webtransport_connection_error(error, "session"))?;
    let _settings = exchange_webtransport_settings(&connection).await?;

    let (mut connect_tx, mut connect_rx) = connection
        .open_bi()
        .await
        .map_err(|error| webtransport_connection_error(error, "session"))?;
    let request = ConnectRequest {
        url: parsed.as_str().parse().map_err(|error| {
            webtransport_session_error(format!("invalid WebTransport URL: {error}"))
        })?,
    };
    let mut buf = Vec::new();
    request.encode(&mut buf);
    connect_tx
        .write_all(&buf)
        .await
        .map_err(|error| webtransport_write_error_with_source(error, "session"))?;
    buf.clear();
    loop {
        let chunk = connect_rx
            .read_chunk(usize::MAX, true)
            .await
            .map_err(|error| webtransport_read_error_with_source(error, "session"))?;
        let chunk = chunk
            .ok_or_else(|| webtransport_session_error("peer rejected WebTransport connection"))?;
        buf.extend_from_slice(&chunk.bytes);
        let mut cursor = std::io::Cursor::new(&buf);
        let response = match ConnectResponse::decode(&mut cursor) {
            Ok(response) => response,
            Err(web_transport_proto::ConnectError::UnexpectedEnd) => continue,
            Err(error) => return Err(webtransport_session_error(error.to_string())),
        };
        if response.status != 200 {
            return Err(webtransport_session_error(
                web_transport_proto::ConnectError::ErrorStatus(response.status).to_string(),
            ));
        }
        break;
    }

    drop(connect_tx);
    drop(connect_rx);

    Ok((endpoint, connection))
}

async fn connect_fastwebsocket(
    url: &str,
    protocols: &[String],
) -> Result<(FragmentCollector<TokioIo<Upgraded>>, hyper::HeaderMap)> {
    let parsed =
        reqwest::Url::parse(url).with_context(|| format!("invalid websocket url: {url}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("websocket url missing host: {url}"))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| anyhow!("websocket url missing port: {url}"))?;
    let authority = if parsed.port().is_some() {
        format!("{host}:{port}")
    } else {
        host.to_string()
    };

    let mut path = parsed.path().to_string();
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    if path.is_empty() {
        path.push('/');
    }

    let tcp_stream = TcpStream::connect((host, port)).await?;
    let request_url = format!(
        "{}://{}{}",
        if parsed.scheme() == "wss" {
            "https"
        } else {
            "http"
        },
        authority,
        path
    );
    let stream: Box<dyn AsyncReadWrite> = match parsed.scheme() {
        "ws" => Box::new(tcp_stream),
        "wss" => {
            let connector = websocket_tls_connector();
            let server_name = ServerName::try_from(host.to_string())
                .map_err(|_| anyhow!("invalid websocket hostname: {host}"))?;
            Box::new(connector.connect(server_name, tcp_stream).await?)
        }
        scheme => return Err(anyhow!("unsupported websocket scheme: {scheme}")),
    };

    let mut request = Request::builder()
        .method("GET")
        .uri(request_url)
        .header(hyper::header::HOST, authority)
        .header(hyper::header::UPGRADE, "websocket")
        .header(hyper::header::CONNECTION, "upgrade")
        .header(
            hyper::header::SEC_WEBSOCKET_KEY,
            fastwebsockets::handshake::generate_key(),
        )
        .header(hyper::header::SEC_WEBSOCKET_VERSION, "13");

    if !protocols.is_empty() {
        request = request.header(hyper::header::SEC_WEBSOCKET_PROTOCOL, protocols.join(", "));
    }

    let request = request.body(Empty::<Bytes>::new())?;
    let (mut websocket, response) =
        fastwebsockets::handshake::client(&TokioSpawnExecutor, request, stream).await?;
    websocket.set_auto_close(true);
    websocket.set_auto_pong(true);
    let websocket = FragmentCollector::new(websocket);
    Ok((websocket, response.headers().clone()))
}

#[cfg(feature = "dev-runtime")]
async fn connect_hmr_fastwebsocket(
    url: &str,
    protocols: &[String],
) -> Result<FragmentCollector<Box<dyn AsyncReadWrite>>> {
    let parsed =
        reqwest::Url::parse(url).with_context(|| format!("invalid websocket url: {url}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("websocket url missing host: {url}"))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| anyhow!("websocket url missing port: {url}"))?;
    let authority = if parsed.port().is_some() {
        format!("{host}:{port}")
    } else {
        host.to_string()
    };

    let mut path = parsed.path().to_string();
    if let Some(query) = parsed.query() {
        path.push('?');
        path.push_str(query);
    }
    if path.is_empty() {
        path.push('/');
    }

    let tcp_stream = TcpStream::connect((host, port)).await?;
    let mut stream: Box<dyn AsyncReadWrite> = match parsed.scheme() {
        "ws" => Box::new(tcp_stream),
        "wss" => {
            let connector = websocket_tls_connector();
            let server_name = ServerName::try_from(host.to_string())
                .map_err(|_| anyhow!("invalid websocket hostname: {host}"))?;
            Box::new(connector.connect(server_name, tcp_stream).await?)
        }
        scheme => return Err(anyhow!("unsupported websocket scheme: {scheme}")),
    };

    let mut request = format!(
        "GET {path} HTTP/1.1\r\nHost: {authority}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n",
        fastwebsockets::handshake::generate_key()
    );
    if !protocols.is_empty() {
        request.push_str("Sec-WebSocket-Protocol: ");
        request.push_str(&protocols.join(", "));
        request.push_str("\r\n");
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await?;
    stream.flush().await?;

    let mut response_bytes = Vec::new();
    let mut byte = [0_u8; 1];
    loop {
        stream.read_exact(&mut byte).await?;
        response_bytes.push(byte[0]);
        if response_bytes.ends_with(b"\r\n\r\n") {
            break;
        }
    }

    let response = String::from_utf8(response_bytes)
        .map_err(|error| anyhow!("invalid websocket upgrade response: {error}"))?;
    let mut lines = response.split("\r\n");
    let status_line = lines
        .next()
        .ok_or_else(|| anyhow!("missing websocket upgrade status line"))?;
    if !status_line.starts_with("HTTP/1.1 101") && !status_line.starts_with("HTTP/1.0 101") {
        return Err(anyhow!(
            "unexpected websocket upgrade status: {status_line}"
        ));
    }

    let mut has_upgrade = false;
    let mut has_connection_upgrade = false;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if name.eq_ignore_ascii_case("Upgrade") && value.eq_ignore_ascii_case("websocket") {
            has_upgrade = true;
        }
        if name.eq_ignore_ascii_case("Connection")
            && value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        {
            has_connection_upgrade = true;
        }
    }

    if !has_upgrade || !has_connection_upgrade {
        return Err(anyhow!("invalid websocket upgrade response headers"));
    }

    let mut websocket = FastWebSocket::after_handshake(stream, fastwebsockets::Role::Client);
    websocket.set_auto_close(true);
    websocket.set_auto_pong(true);
    Ok(FragmentCollector::new(websocket))
}

fn websocket_buffered_amount_add(
    websocket_state: &WebSocketHostStateHandle,
    socket_id: u32,
    amount: u32,
) {
    if let Ok(mut websocket_state) = websocket_state.lock() {
        let entry = websocket_state
            .buffered_amounts
            .entry(socket_id)
            .or_insert(0);
        *entry = entry.saturating_add(amount);
    }
}

fn websocket_buffered_amount_sub(
    websocket_state: &WebSocketHostStateHandle,
    socket_id: u32,
    amount: u32,
) {
    if let Ok(mut websocket_state) = websocket_state.lock() {
        if let Some(entry) = websocket_state.buffered_amounts.get_mut(&socket_id) {
            *entry = entry.saturating_sub(amount);
        }
    }
}

fn spawn_websocket_connection(
    socket_id: u32,
    url: String,
    protocols: Vec<String>,
    websocket_state: WebSocketHostStateHandle,
    event_proxy: Option<EventLoopProxy<RuntimeUserEvent>>,
) -> Result<WebSocketConnectionHandle, JsErrorBox> {
    let (command_tx, mut command_rx) = tokio_mpsc::unbounded_channel::<WebSocketCommand>();
    let thread_handle = thread::Builder::new()
        .name(format!("goldlight-websocket-{socket_id}"))
        .spawn(move || {
            let runtime = match TokioRuntimeBuilder::new_current_thread().enable_all().build() {
                Ok(runtime) => runtime,
                Err(error) => {
                    push_websocket_event(
                        &websocket_state,
                        &event_proxy,
                        WebSocketEventPayload::Error {
                            socket_id,
                            message: format!("failed to create websocket runtime: {error}"),
                        },
                    );
                    push_websocket_event(
                        &websocket_state,
                        &event_proxy,
                        WebSocketEventPayload::Close {
                            socket_id,
                            code: None,
                            reason: Some("failed to initialize websocket".to_string()),
                            was_clean: false,
                        },
                    );
                    return;
                }
            };

            runtime.block_on(async move {
                let (mut websocket, response_headers) = match connect_fastwebsocket(&url, &protocols).await {
                    Ok(connection) => connection,
                    Err(error) => {
                        push_websocket_event(
                            &websocket_state,
                            &event_proxy,
                            WebSocketEventPayload::Error {
                                socket_id,
                                message: error.to_string(),
                            },
                        );
                        push_websocket_event(
                            &websocket_state,
                            &event_proxy,
                            WebSocketEventPayload::Close {
                                socket_id,
                                code: None,
                                reason: Some(error.to_string()),
                                was_clean: false,
                            },
                        );
                        return;
                    }
                };

                let protocol = response_headers
                    .get("Sec-WebSocket-Protocol")
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                let extensions = response_headers
                    .get("Sec-WebSocket-Extensions")
                    .and_then(|value| value.to_str().ok())
                    .map(|value| value.to_string());
                push_websocket_event(
                    &websocket_state,
                    &event_proxy,
                    WebSocketEventPayload::Open {
                        socket_id,
                        protocol,
                        extensions,
                    },
                );

                loop {
                    tokio::select! {
                        maybe_command = command_rx.recv() => {
                            let Some(command) = maybe_command else {
                                break;
                            };
                            match command {
                                WebSocketCommand::SendText { payload, queued_bytes } => {
                                    if let Err(error) = websocket.write_frame(FastWebSocketFrame::text(payload.into_bytes().into())).await {
                                        push_websocket_event(
                                            &websocket_state,
                                            &event_proxy,
                                            WebSocketEventPayload::Error {
                                                socket_id,
                                                message: error.to_string(),
                                            },
                                        );
                                        break;
                                    }
                                    websocket_buffered_amount_sub(&websocket_state, socket_id, queued_bytes);
                                }
                                WebSocketCommand::SendBinary { payload, queued_bytes } => {
                                    if let Err(error) = websocket.write_frame(FastWebSocketFrame::binary(payload.into())).await {
                                        push_websocket_event(
                                            &websocket_state,
                                            &event_proxy,
                                            WebSocketEventPayload::Error {
                                                socket_id,
                                                message: error.to_string(),
                                            },
                                        );
                                        break;
                                    }
                                    websocket_buffered_amount_sub(&websocket_state, socket_id, queued_bytes);
                                }
                                WebSocketCommand::Close { code, reason } => {
                                    let close_frame = match code {
                                        Some(code) => FastWebSocketFrame::close(
                                            code,
                                            reason.clone().unwrap_or_default().as_bytes(),
                                        ),
                                        None => FastWebSocketFrame::close_raw(vec![].into()),
                                    };
                                    let _ = websocket.write_frame(close_frame).await;
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Close {
                                            socket_id,
                                            code,
                                            reason,
                                            was_clean: true,
                                        },
                                    );
                                    break;
                                }
                                WebSocketCommand::Shutdown => {
                                    let _ = websocket.write_frame(FastWebSocketFrame::close_raw(vec![].into())).await;
                                    break;
                                }
                            }
                        }
                        message = websocket.read_frame() => {
                            match message {
                                Ok(frame) if frame.opcode == FastOpCode::Text => {
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Message {
                                            socket_id,
                                            data_text: Some(String::from_utf8_lossy(&frame.payload).into_owned()),
                                            data_binary: None,
                                        },
                                    );
                                }
                                Ok(frame) if frame.opcode == FastOpCode::Binary => {
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Message {
                                            socket_id,
                                            data_text: None,
                                            data_binary: Some(frame.payload.to_vec()),
                                        },
                                    );
                                }
                                Ok(frame) if frame.opcode == FastOpCode::Close => {
                                    let code = if frame.payload.len() >= 2 {
                                        Some(u16::from_be_bytes([frame.payload[0], frame.payload[1]]))
                                    } else {
                                        None
                                    };
                                    let reason = if frame.payload.len() > 2 {
                                        Some(String::from_utf8_lossy(&frame.payload[2..]).into_owned())
                                    } else {
                                        None
                                    };
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Close {
                                            socket_id,
                                            code,
                                            reason,
                                            was_clean: true,
                                        },
                                    );
                                    break;
                                }
                                Ok(frame) if frame.opcode == FastOpCode::Pong => {}
                                Ok(frame) if frame.opcode == FastOpCode::Ping => {
                                    let _ = websocket.write_frame(FastWebSocketFrame::pong(frame.payload)).await;
                                }
                                Ok(_) => {}
                                Err(error) => {
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Error {
                                            socket_id,
                                            message: error.to_string(),
                                        },
                                    );
                                    push_websocket_event(
                                        &websocket_state,
                                        &event_proxy,
                                        WebSocketEventPayload::Close {
                                            socket_id,
                                            code: None,
                                            reason: Some(error.to_string()),
                                            was_clean: false,
                                        },
                                    );
                                    break;
                                }
                            }
                        }
                    }
                }
            });
        })
        .map_err(|error| JsErrorBox::generic(format!("failed to spawn websocket thread: {error}")))?;

    Ok(WebSocketConnectionHandle {
        command_tx,
        thread_handle: Some(thread_handle),
    })
}

fn shutdown_all_websockets(websocket_state: &WebSocketHostStateHandle) {
    let sockets = if let Ok(mut websocket_state) = websocket_state.lock() {
        websocket_state.buffered_amounts.clear();
        std::mem::take(&mut websocket_state.sockets)
    } else {
        HashMap::new()
    };
    for (_, socket) in sockets {
        socket.shutdown();
    }
}

fn shutdown_all_webtransports(webtransport_state: &WebTransportHostStateHandle) {
    let transports = if let Ok(mut webtransport_state) = webtransport_state.lock() {
        webtransport_state.send_streams.clear();
        webtransport_state.recv_streams.clear();
        std::mem::take(&mut webtransport_state.transports)
    } else {
        HashMap::new()
    };
    for (_, transport) in transports {
        transport.close(0, "");
    }
}

fn webtransport_error_box(
    message: impl Into<String>,
    source: &'static str,
    stream_error_code: Option<u32>,
) -> JsErrorBox {
    let message = message.into();
    let payload = WebTransportErrorOutput {
        message: message.clone(),
        source,
        stream_error_code,
    };
    match serde_json::to_string(&payload) {
        Ok(payload_json) => JsErrorBox::generic(format!(
            "{message}{GOLDLIGHT_WEBTRANSPORT_ERROR_MARKER}{payload_json}"
        )),
        Err(_) => JsErrorBox::generic(message),
    }
}

fn webtransport_session_error(message: impl Into<String>) -> JsErrorBox {
    webtransport_error_box(message, "session", None)
}

fn webtransport_stream_error(
    message: impl Into<String>,
    stream_error_code: Option<u32>,
) -> JsErrorBox {
    webtransport_error_box(message, "stream", stream_error_code)
}

fn webtransport_connection_error(
    error: quinn::ConnectionError,
    source: &'static str,
) -> JsErrorBox {
    webtransport_error_box(error.to_string(), source, None)
}

fn webtransport_write_error_with_source(
    error: quinn::WriteError,
    source: &'static str,
) -> JsErrorBox {
    match error {
        quinn::WriteError::Stopped(code) => webtransport_error_box(
            format!("sending stopped by peer: error {code}"),
            source,
            Some(code.into_inner() as u32),
        ),
        quinn::WriteError::ConnectionLost(error) => webtransport_connection_error(error, source),
        quinn::WriteError::ClosedStream => webtransport_error_box("closed stream", source, None),
        quinn::WriteError::ZeroRttRejected => {
            webtransport_error_box("0-RTT rejected", source, None)
        }
    }
}

fn webtransport_write_error(error: quinn::WriteError) -> JsErrorBox {
    webtransport_write_error_with_source(error, "stream")
}

fn webtransport_read_error_with_source(
    error: quinn::ReadError,
    source: &'static str,
) -> JsErrorBox {
    match error {
        quinn::ReadError::Reset(code) => webtransport_error_box(
            format!("stream reset by peer: error {code}"),
            source,
            Some(code.into_inner() as u32),
        ),
        quinn::ReadError::ConnectionLost(error) => webtransport_connection_error(error, source),
        quinn::ReadError::ClosedStream => webtransport_error_box("closed stream", source, None),
        quinn::ReadError::IllegalOrderedRead => {
            webtransport_error_box("ordered read after unordered read", source, None)
        }
        quinn::ReadError::ZeroRttRejected => webtransport_error_box("0-RTT rejected", source, None),
    }
}

fn webtransport_read_error(error: quinn::ReadError) -> JsErrorBox {
    webtransport_read_error_with_source(error, "stream")
}

fn webtransport_send_datagram_error(error: quinn::SendDatagramError) -> JsErrorBox {
    match error {
        quinn::SendDatagramError::UnsupportedByPeer => {
            webtransport_session_error("datagrams not supported by peer")
        }
        quinn::SendDatagramError::Disabled => {
            webtransport_session_error("datagram support disabled")
        }
        quinn::SendDatagramError::TooLarge => webtransport_session_error("datagram too large"),
        quinn::SendDatagramError::ConnectionLost(error) => {
            webtransport_connection_error(error, "session")
        }
    }
}

#[deno_core::op2]
fn op_goldlight_fetch_start(
    state: &mut OpState,
    #[serde] request: FetchRequestInput,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let request_id = {
        let mut fetch_state = op_context
            .fetch_state
            .lock()
            .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
        let request_id = fetch_state.next_request_id;
        fetch_state.next_request_id = fetch_state.next_request_id.wrapping_add(1).max(1);
        request_id
    };
    let request_handle = spawn_fetch_request(
        request_id,
        request,
        op_context.fetch_state.clone(),
        op_context.event_proxy.clone(),
    )?;
    let mut fetch_state = op_context
        .fetch_state
        .lock()
        .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
    fetch_state.requests.insert(request_id, request_handle);
    Ok(request_id)
}

#[deno_core::op2(fast)]
fn op_goldlight_fetch_abort(state: &mut OpState, request_id: u32) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let fetch_state = op_context
        .fetch_state
        .lock()
        .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
    let request = fetch_state
        .requests
        .get(&request_id)
        .ok_or_else(|| JsErrorBox::generic("unknown fetch request id"))?;
    request
        .abort_tx
        .send(true)
        .map_err(|_| JsErrorBox::generic("failed to abort fetch request"))?;
    Ok(())
}

#[deno_core::op2(fast)]
fn op_goldlight_fetch_write_chunk(
    state: &mut OpState,
    request_id: u32,
    #[buffer(copy)] chunk: Vec<u8>,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let fetch_state = op_context
        .fetch_state
        .lock()
        .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
    let request = fetch_state
        .requests
        .get(&request_id)
        .ok_or_else(|| JsErrorBox::generic("unknown fetch request id"))?;
    let body_tx = request
        .body_tx
        .as_ref()
        .ok_or_else(|| JsErrorBox::generic("fetch request is not streaming"))?;
    body_tx
        .send(FetchBodyCommand::Chunk(chunk))
        .map_err(|_| JsErrorBox::generic("failed to write fetch body chunk"))?;
    Ok(())
}

#[deno_core::op2(fast)]
fn op_goldlight_fetch_close_body(state: &mut OpState, request_id: u32) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let fetch_state = op_context
        .fetch_state
        .lock()
        .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
    let request = fetch_state
        .requests
        .get(&request_id)
        .ok_or_else(|| JsErrorBox::generic("unknown fetch request id"))?;
    let body_tx = request
        .body_tx
        .as_ref()
        .ok_or_else(|| JsErrorBox::generic("fetch request is not streaming"))?;
    body_tx
        .send(FetchBodyCommand::Done)
        .map_err(|_| JsErrorBox::generic("failed to close fetch request body"))?;
    Ok(())
}

#[deno_core::op2]
#[serde]
fn op_goldlight_fetch_drain_events(
    state: &mut OpState,
) -> Result<Vec<FetchEventPayload>, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let mut fetch_state = op_context
        .fetch_state
        .lock()
        .map_err(|_| JsErrorBox::generic("fetch state mutex poisoned"))?;
    let events = std::mem::take(&mut fetch_state.pending_events);
    for event in &events {
        match event {
            FetchEventPayload::Done { request_id }
            | FetchEventPayload::Error { request_id, .. }
            | FetchEventPayload::Aborted { request_id } => {
                if let Some(request) = fetch_state.requests.remove(request_id) {
                    request.shutdown();
                }
            }
            FetchEventPayload::Response { .. } | FetchEventPayload::Chunk { .. } => {}
        }
    }
    Ok(events)
}

#[deno_core::op2]
fn op_goldlight_websocket_create(
    state: &mut OpState,
    #[string] url: String,
    #[serde] protocols: Vec<String>,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let socket_id = {
        let mut websocket_state = op_context
            .websocket_state
            .lock()
            .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
        let socket_id = websocket_state.next_socket_id;
        websocket_state.next_socket_id = websocket_state.next_socket_id.wrapping_add(1).max(1);
        socket_id
    };
    let connection = spawn_websocket_connection(
        socket_id,
        url,
        protocols,
        op_context.websocket_state.clone(),
        op_context.event_proxy.clone(),
    )?;
    let mut websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    websocket_state.buffered_amounts.insert(socket_id, 0);
    websocket_state.sockets.insert(socket_id, connection);
    Ok(socket_id)
}

#[deno_core::op2(fast)]
fn op_goldlight_websocket_send_text(
    state: &mut OpState,
    socket_id: u32,
    #[string] text: String,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let queued_bytes = text.len() as u32;
    let websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    let socket = websocket_state
        .sockets
        .get(&socket_id)
        .ok_or_else(|| JsErrorBox::generic("unknown websocket id"))?;
    socket
        .command_tx
        .send(WebSocketCommand::SendText {
            queued_bytes,
            payload: text,
        })
        .map_err(|_| JsErrorBox::generic("failed to send websocket text payload"))?;
    drop(websocket_state);
    websocket_buffered_amount_add(&op_context.websocket_state, socket_id, queued_bytes);
    Ok(())
}

#[deno_core::op2]
fn op_goldlight_websocket_send_binary(
    state: &mut OpState,
    socket_id: u32,
    #[serde] data: Vec<u8>,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let queued_bytes = data.len() as u32;
    let websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    let socket = websocket_state
        .sockets
        .get(&socket_id)
        .ok_or_else(|| JsErrorBox::generic("unknown websocket id"))?;
    socket
        .command_tx
        .send(WebSocketCommand::SendBinary {
            queued_bytes,
            payload: data,
        })
        .map_err(|_| JsErrorBox::generic("failed to send websocket binary payload"))?;
    drop(websocket_state);
    websocket_buffered_amount_add(&op_context.websocket_state, socket_id, queued_bytes);
    Ok(())
}

#[deno_core::op2(fast)]
fn op_goldlight_websocket_get_buffered_amount(
    state: &mut OpState,
    socket_id: u32,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    Ok(*websocket_state
        .buffered_amounts
        .get(&socket_id)
        .unwrap_or(&0))
}

#[deno_core::op2]
fn op_goldlight_websocket_close(
    state: &mut OpState,
    socket_id: u32,
    code: Option<u16>,
    #[string] reason: Option<String>,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    let socket = websocket_state
        .sockets
        .get(&socket_id)
        .ok_or_else(|| JsErrorBox::generic("unknown websocket id"))?;
    socket
        .command_tx
        .send(WebSocketCommand::Close { code, reason })
        .map_err(|_| JsErrorBox::generic("failed to close websocket"))?;
    Ok(())
}

#[deno_core::op2]
#[serde]
fn op_goldlight_websocket_drain_events(
    state: &mut OpState,
) -> Result<Vec<WebSocketEventPayload>, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let mut websocket_state = op_context
        .websocket_state
        .lock()
        .map_err(|_| JsErrorBox::generic("websocket state mutex poisoned"))?;
    let events = std::mem::take(&mut websocket_state.pending_events);
    for event in &events {
        match event {
            WebSocketEventPayload::Close { socket_id, .. } => {
                if let Some(socket) = websocket_state.sockets.remove(socket_id) {
                    socket.shutdown();
                }
                websocket_state.buffered_amounts.remove(socket_id);
            }
            WebSocketEventPayload::Open { .. }
            | WebSocketEventPayload::Message { .. }
            | WebSocketEventPayload::Error { .. } => {}
        }
    }
    Ok(events)
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_connect(
    state: Rc<RefCell<OpState>>,
    #[string] url: String,
    #[serde] options: WebTransportConnectOptionsInput,
) -> Result<WebTransportConnectOutput, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let (endpoint, connection) = connect_webtransport(&url, &options)
        .await
        .map_err(|error| webtransport_session_error(error.to_string()))?;
    let max_datagram_size = connection.max_datagram_size().unwrap_or(0) as u32;
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| JsErrorBox::generic("webtransport state mutex poisoned"))?;
    let transport_id = webtransport_state.next_transport_id;
    webtransport_state.next_transport_id =
        webtransport_state.next_transport_id.wrapping_add(1).max(1);
    webtransport_state.transports.insert(
        transport_id,
        WebTransportHandle {
            _endpoint: endpoint,
            connection,
        },
    );
    Ok(WebTransportConnectOutput {
        transport_id,
        max_datagram_size,
    })
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_closed(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<WebTransportCloseInfoOutput, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    let close_info = match transport.connection.closed().await {
        quinn::ConnectionError::ApplicationClosed(reason) => WebTransportCloseInfoOutput {
            close_code: reason.error_code.into_inner() as u32,
            reason: String::from_utf8_lossy(&reason.reason).into_owned(),
        },
        quinn::ConnectionError::LocallyClosed => WebTransportCloseInfoOutput {
            close_code: 0,
            reason: String::new(),
        },
        error => WebTransportCloseInfoOutput {
            close_code: 0,
            reason: error.to_string(),
        },
    };
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
    webtransport_state.transports.remove(&transport_id);
    webtransport_state
        .send_streams
        .retain(|_, stream| stream.transport_id != transport_id);
    webtransport_state
        .recv_streams
        .retain(|_, stream| stream.transport_id != transport_id);
    Ok(close_info)
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_draining(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    loop {
        if transport.connection.close_reason().is_some() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[deno_core::op2(fast)]
fn op_goldlight_webtransport_close(
    state: &mut OpState,
    transport_id: u32,
    close_code: u32,
    #[string] reason: String,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
    let transport = webtransport_state
        .transports
        .get(&transport_id)
        .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?;
    transport.close(close_code, &reason);
    Ok(())
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_create_bidirectional_stream(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<WebTransportBidirectionalStreamOutput, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    let (send_stream, recv_stream) = transport
        .connection
        .open_bi()
        .await
        .map_err(|error| webtransport_connection_error(error, "stream"))?;
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
    let send_stream_id = webtransport_state.next_send_stream_id;
    webtransport_state.next_send_stream_id = webtransport_state
        .next_send_stream_id
        .wrapping_add(1)
        .max(1);
    let receive_stream_id = webtransport_state.next_recv_stream_id;
    webtransport_state.next_recv_stream_id = webtransport_state
        .next_recv_stream_id
        .wrapping_add(1)
        .max(1);
    webtransport_state.send_streams.insert(
        send_stream_id,
        WebTransportSendStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(send_stream)),
        },
    );
    webtransport_state.recv_streams.insert(
        receive_stream_id,
        WebTransportRecvStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(recv_stream)),
        },
    );
    Ok(WebTransportBidirectionalStreamOutput {
        send_stream_id,
        receive_stream_id,
    })
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_create_unidirectional_stream(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    let send_stream = transport
        .connection
        .open_uni()
        .await
        .map_err(|error| webtransport_connection_error(error, "stream"))?;
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
    let send_stream_id = webtransport_state.next_send_stream_id;
    webtransport_state.next_send_stream_id = webtransport_state
        .next_send_stream_id
        .wrapping_add(1)
        .max(1);
    webtransport_state.send_streams.insert(
        send_stream_id,
        WebTransportSendStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(send_stream)),
        },
    );
    Ok(send_stream_id)
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_accept_bidirectional_stream(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<Option<WebTransportBidirectionalStreamOutput>, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    let (send_stream, recv_stream) = match transport.connection.accept_bi().await {
        Ok(streams) => streams,
        Err(
            quinn::ConnectionError::ApplicationClosed(_)
            | quinn::ConnectionError::ConnectionClosed(_)
            | quinn::ConnectionError::LocallyClosed
            | quinn::ConnectionError::Reset
            | quinn::ConnectionError::TimedOut,
        ) => return Ok(None),
        Err(error) => return Err(webtransport_connection_error(error, "stream")),
    };
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
    let send_stream_id = webtransport_state.next_send_stream_id;
    webtransport_state.next_send_stream_id = webtransport_state
        .next_send_stream_id
        .wrapping_add(1)
        .max(1);
    let receive_stream_id = webtransport_state.next_recv_stream_id;
    webtransport_state.next_recv_stream_id = webtransport_state
        .next_recv_stream_id
        .wrapping_add(1)
        .max(1);
    webtransport_state.send_streams.insert(
        send_stream_id,
        WebTransportSendStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(send_stream)),
        },
    );
    webtransport_state.recv_streams.insert(
        receive_stream_id,
        WebTransportRecvStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(recv_stream)),
        },
    );
    Ok(Some(WebTransportBidirectionalStreamOutput {
        send_stream_id,
        receive_stream_id,
    }))
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_accept_unidirectional_stream(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<Option<u32>, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    let recv_stream = match transport.connection.accept_uni().await {
        Ok(stream) => stream,
        Err(
            quinn::ConnectionError::ApplicationClosed(_)
            | quinn::ConnectionError::ConnectionClosed(_)
            | quinn::ConnectionError::LocallyClosed
            | quinn::ConnectionError::Reset
            | quinn::ConnectionError::TimedOut,
        ) => return Ok(None),
        Err(error) => return Err(webtransport_connection_error(error, "stream")),
    };
    let mut webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
    let receive_stream_id = webtransport_state.next_recv_stream_id;
    webtransport_state.next_recv_stream_id = webtransport_state
        .next_recv_stream_id
        .wrapping_add(1)
        .max(1);
    webtransport_state.recv_streams.insert(
        receive_stream_id,
        WebTransportRecvStreamHandle {
            transport_id,
            stream: Arc::new(tokio::sync::Mutex::new(recv_stream)),
        },
    );
    Ok(Some(receive_stream_id))
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_send_datagram(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
    #[buffer(copy)] data: Vec<u8>,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    transport
        .connection
        .send_datagram_wait(Bytes::from(data))
        .await
        .map_err(webtransport_send_datagram_error)
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_read_datagram(
    state: Rc<RefCell<OpState>>,
    transport_id: u32,
) -> Result<Option<Vec<u8>>, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let transport = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
        webtransport_state
            .transports
            .get(&transport_id)
            .cloned()
            .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?
    };
    match transport.connection.read_datagram().await {
        Ok(bytes) => Ok(Some(bytes.to_vec())),
        Err(
            quinn::ConnectionError::ApplicationClosed(_)
            | quinn::ConnectionError::ConnectionClosed(_)
            | quinn::ConnectionError::LocallyClosed
            | quinn::ConnectionError::Reset
            | quinn::ConnectionError::TimedOut,
        ) => Ok(None),
        Err(error) => Err(webtransport_connection_error(error, "session")),
    }
}

#[deno_core::op2(fast)]
fn op_goldlight_webtransport_get_max_datagram_size(
    state: &mut OpState,
    transport_id: u32,
) -> Result<u32, JsErrorBox> {
    let op_context = state.borrow::<RuntimeOpContext>().clone();
    let webtransport_state = op_context
        .webtransport_state
        .lock()
        .map_err(|_| webtransport_session_error("webtransport state mutex poisoned"))?;
    let transport = webtransport_state
        .transports
        .get(&transport_id)
        .ok_or_else(|| webtransport_session_error("unknown webtransport id"))?;
    Ok(transport.connection.max_datagram_size().unwrap_or(0) as u32)
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_send_stream_write(
    state: Rc<RefCell<OpState>>,
    send_stream_id: u32,
    #[buffer(copy)] data: Vec<u8>,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let stream = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
        webtransport_state
            .send_streams
            .get(&send_stream_id)
            .cloned()
            .ok_or_else(|| webtransport_stream_error("unknown webtransport send stream id", None))?
    };
    let mut stream = stream.stream.lock().await;
    stream
        .write_all(&data)
        .await
        .map_err(webtransport_write_error)
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_send_stream_close(
    state: Rc<RefCell<OpState>>,
    send_stream_id: u32,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let stream = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
        webtransport_state
            .send_streams
            .get(&send_stream_id)
            .cloned()
            .ok_or_else(|| webtransport_stream_error("unknown webtransport send stream id", None))?
    };
    let mut stream = stream.stream.lock().await;
    stream
        .finish()
        .map_err(|_| webtransport_stream_error("closed stream", None))
}

#[deno_core::op2(async)]
#[serde]
async fn op_goldlight_webtransport_receive_stream_read(
    state: Rc<RefCell<OpState>>,
    receive_stream_id: u32,
) -> Result<Option<Vec<u8>>, JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let stream = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
        webtransport_state
            .recv_streams
            .get(&receive_stream_id)
            .cloned()
            .ok_or_else(|| {
                webtransport_stream_error("unknown webtransport receive stream id", None)
            })?
    };
    let mut buffer = vec![0; 64 * 1024];
    let mut stream = stream.stream.lock().await;
    match stream
        .read(&mut buffer)
        .await
        .map_err(webtransport_read_error)?
    {
        Some(read) => {
            buffer.truncate(read);
            Ok(Some(buffer))
        }
        None => Ok(None),
    }
}

#[deno_core::op2(async)]
async fn op_goldlight_webtransport_receive_stream_cancel(
    state: Rc<RefCell<OpState>>,
    receive_stream_id: u32,
) -> Result<(), JsErrorBox> {
    let op_context = state.borrow().borrow::<RuntimeOpContext>().clone();
    let stream = {
        let webtransport_state = op_context
            .webtransport_state
            .lock()
            .map_err(|_| webtransport_stream_error("webtransport state mutex poisoned", None))?;
        webtransport_state
            .recv_streams
            .get(&receive_stream_id)
            .cloned()
            .ok_or_else(|| {
                webtransport_stream_error("unknown webtransport receive stream id", None)
            })?
    };
    let mut stream = stream.stream.lock().await;
    stream
        .stop(quinn::VarInt::from_u32(0))
        .map_err(|_| webtransport_stream_error("closed stream", None))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_list_families() -> Result<Vec<String>, JsErrorBox> {
    text::list_families().map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[string]
fn op_goldlight_text_match_typeface(#[string] family: String) -> Result<String, JsErrorBox> {
    text::match_typeface(&family)
        .map(|handle| handle.unwrap_or_default())
        .map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_get_font_metrics(
    #[string] typeface: String,
    size: f32,
) -> Result<Option<text::FontMetricsValue>, JsErrorBox> {
    text::get_font_metrics(&typeface, size).map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_shape_text(
    #[serde] input: ShapeTextInput,
) -> Result<Option<text::ShapedRunValue>, JsErrorBox> {
    text::shape_text(input).map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_get_glyph_path(
    #[string] typeface: String,
    glyph_id: u32,
    size: f32,
) -> Result<Option<Vec<render::PathVerb2D>>, JsErrorBox> {
    text::get_glyph_path(&typeface, glyph_id, size)
        .map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_get_glyph_mask(
    #[string] typeface: String,
    glyph_id: u32,
    size: f32,
    #[serde] subpixel_offset: Option<GlyphSubpixelOffsetInput>,
) -> Result<Option<text::GlyphMaskValue>, JsErrorBox> {
    text::get_glyph_mask(&typeface, glyph_id, size, subpixel_offset)
        .map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_text_get_glyph_sdf(
    #[string] typeface: String,
    glyph_id: u32,
    size: f32,
    inset: Option<u32>,
    radius: Option<f32>,
) -> Result<Option<text::GlyphMaskValue>, JsErrorBox> {
    text::get_glyph_sdf(&typeface, glyph_id, size, inset, radius)
        .map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_svg_parse(#[string] source: String) -> Result<svg::SvgSceneValue, JsErrorBox> {
    svg::parse_svg(&source).map_err(|error| JsErrorBox::generic(error.to_string()))
}

#[deno_core::op2]
#[serde]
fn op_goldlight_create_scene_2d(
    state: &mut OpState,
    #[serde] options: Scene2DOptions,
) -> Result<Scene2DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        Ok(worker_state.render_model.create_scene_2d(options))
    })
}

#[deno_core::op2]
fn op_goldlight_scene_2d_set_clear_color(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: SceneClearColorOptions,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_2d_set_clear_color(scene_id, options)
    })
}

#[deno_core::op2]
#[serde]
fn op_goldlight_scene_2d_create_rect(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: Rect2DOptions,
) -> Result<Rect2DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_2d_create_rect(scene_id, options)
    })
}

#[deno_core::op2]
fn op_goldlight_rect_2d_update(
    state: &mut OpState,
    rect_id: u32,
    #[serde] options: Rect2DUpdate,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state.render_model.rect_2d_update(rect_id, options)
    })
}

#[deno_core::op2]
#[serde]
fn op_goldlight_scene_2d_create_path(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: Path2DOptions,
) -> Result<Path2DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_2d_create_path(scene_id, options)
    })
}

#[deno_core::op2]
fn op_goldlight_path_2d_update(
    state: &mut OpState,
    path_id: u32,
    #[serde] options: Path2DUpdate,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state.render_model.path_2d_update(path_id, options)
    })
}

#[deno_core::op2]
#[serde]
fn op_goldlight_scene_2d_create_text(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: Text2DOptions,
) -> Result<Text2DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_2d_create_text(scene_id, options)
    })
}

#[deno_core::op2]
fn op_goldlight_text_2d_update(
    state: &mut OpState,
    text_id: u32,
    #[serde] options: Text2DUpdate,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state.render_model.text_2d_update(text_id, options)
    })
}

#[deno_core::op2(fast)]
fn op_goldlight_present_scene_2d(state: &mut OpState, scene_id: u32) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state.render_model.present_scene_2d(scene_id)
    })
}

#[deno_core::op2]
#[serde]
fn op_goldlight_create_scene_3d(
    state: &mut OpState,
    #[serde] options: Scene3DOptions,
) -> Result<Scene3DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        Ok(worker_state.render_model.create_scene_3d(options))
    })
}

#[deno_core::op2]
fn op_goldlight_scene_3d_set_clear_color(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: SceneClearColorOptions,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_3d_set_clear_color(scene_id, options)
    })
}

#[deno_core::op2]
fn op_goldlight_scene_3d_set_camera(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: SceneCameraUpdate,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_3d_set_camera(scene_id, options)
    })
}

#[deno_core::op2]
#[serde]
fn op_goldlight_scene_3d_create_triangle(
    state: &mut OpState,
    scene_id: u32,
    #[serde] options: Triangle3DOptions,
) -> Result<Triangle3DHandle, JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .scene_3d_create_triangle(scene_id, options)
    })
}

#[deno_core::op2]
fn op_goldlight_triangle_3d_update(
    state: &mut OpState,
    triangle_id: u32,
    #[serde] options: Triangle3DUpdate,
) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state
            .render_model
            .triangle_3d_update(triangle_id, options)
    })
}

#[deno_core::op2(fast)]
fn op_goldlight_present_scene_3d(state: &mut OpState, scene_id: u32) -> Result<(), JsErrorBox> {
    with_worker_render_model_mutation(state, |worker_state| {
        worker_state.render_model.present_scene_3d(scene_id)
    })
}

#[cfg(feature = "dev-runtime")]
deno_core::extension!(
    goldlight_runtime,
    ops = [
        op_goldlight_create_window,
        op_goldlight_timer_schedule,
        op_goldlight_timer_cancel,
        op_goldlight_timer_drain_ready,
        op_goldlight_fetch_start,
        op_goldlight_fetch_abort,
        op_goldlight_fetch_write_chunk,
        op_goldlight_fetch_close_body,
        op_goldlight_fetch_drain_events,
        op_goldlight_websocket_create,
        op_goldlight_websocket_get_buffered_amount,
        op_goldlight_websocket_send_text,
        op_goldlight_websocket_send_binary,
        op_goldlight_websocket_close,
        op_goldlight_websocket_drain_events,
        op_goldlight_webtransport_connect,
        op_goldlight_webtransport_draining,
        op_goldlight_webtransport_closed,
        op_goldlight_webtransport_close,
        op_goldlight_webtransport_create_bidirectional_stream,
        op_goldlight_webtransport_create_unidirectional_stream,
        op_goldlight_webtransport_accept_bidirectional_stream,
        op_goldlight_webtransport_accept_unidirectional_stream,
        op_goldlight_webtransport_send_datagram,
        op_goldlight_webtransport_read_datagram,
        op_goldlight_webtransport_get_max_datagram_size,
        op_goldlight_webtransport_send_stream_write,
        op_goldlight_webtransport_send_stream_close,
        op_goldlight_webtransport_receive_stream_read,
        op_goldlight_webtransport_receive_stream_cancel,
        op_goldlight_text_list_families,
        op_goldlight_text_match_typeface,
        op_goldlight_text_get_font_metrics,
        op_goldlight_text_shape_text,
        op_goldlight_text_get_glyph_path,
        op_goldlight_text_get_glyph_mask,
        op_goldlight_text_get_glyph_sdf,
        op_goldlight_svg_parse,
        op_goldlight_hmr_drain_updates,
        op_goldlight_hmr_request_restart,
        op_goldlight_worker_request_animation_frame,
        op_goldlight_worker_drain_events,
        op_goldlight_compute_layout,
        op_goldlight_create_scene_2d,
        op_goldlight_scene_2d_set_clear_color,
        op_goldlight_scene_2d_create_rect,
        op_goldlight_rect_2d_update,
        op_goldlight_scene_2d_create_path,
        op_goldlight_path_2d_update,
        op_goldlight_scene_2d_create_text,
        op_goldlight_text_2d_update,
        op_goldlight_present_scene_2d,
        op_goldlight_create_scene_3d,
        op_goldlight_scene_3d_set_clear_color,
        op_goldlight_scene_3d_set_camera,
        op_goldlight_scene_3d_create_triangle,
        op_goldlight_triangle_3d_update,
        op_goldlight_present_scene_3d
    ],
    options = {
        runtime_op_context: RuntimeOpContext,
    },
    state = |state, options| {
        state.put(options.runtime_op_context);
    }
);

#[cfg(not(feature = "dev-runtime"))]
deno_core::extension!(
    goldlight_runtime,
    ops = [
        op_goldlight_create_window,
        op_goldlight_timer_schedule,
        op_goldlight_timer_cancel,
        op_goldlight_timer_drain_ready,
        op_goldlight_fetch_start,
        op_goldlight_fetch_abort,
        op_goldlight_fetch_write_chunk,
        op_goldlight_fetch_close_body,
        op_goldlight_fetch_drain_events,
        op_goldlight_websocket_create,
        op_goldlight_websocket_get_buffered_amount,
        op_goldlight_websocket_send_text,
        op_goldlight_websocket_send_binary,
        op_goldlight_websocket_close,
        op_goldlight_websocket_drain_events,
        op_goldlight_webtransport_connect,
        op_goldlight_webtransport_draining,
        op_goldlight_webtransport_closed,
        op_goldlight_webtransport_close,
        op_goldlight_webtransport_create_bidirectional_stream,
        op_goldlight_webtransport_create_unidirectional_stream,
        op_goldlight_webtransport_accept_bidirectional_stream,
        op_goldlight_webtransport_accept_unidirectional_stream,
        op_goldlight_webtransport_send_datagram,
        op_goldlight_webtransport_read_datagram,
        op_goldlight_webtransport_get_max_datagram_size,
        op_goldlight_webtransport_send_stream_write,
        op_goldlight_webtransport_send_stream_close,
        op_goldlight_webtransport_receive_stream_read,
        op_goldlight_webtransport_receive_stream_cancel,
        op_goldlight_text_list_families,
        op_goldlight_text_match_typeface,
        op_goldlight_text_get_font_metrics,
        op_goldlight_text_shape_text,
        op_goldlight_text_get_glyph_path,
        op_goldlight_text_get_glyph_mask,
        op_goldlight_text_get_glyph_sdf,
        op_goldlight_svg_parse,
        op_goldlight_worker_request_animation_frame,
        op_goldlight_worker_drain_events,
        op_goldlight_compute_layout,
        op_goldlight_create_scene_2d,
        op_goldlight_scene_2d_set_clear_color,
        op_goldlight_scene_2d_create_rect,
        op_goldlight_rect_2d_update,
        op_goldlight_scene_2d_create_path,
        op_goldlight_path_2d_update,
        op_goldlight_scene_2d_create_text,
        op_goldlight_text_2d_update,
        op_goldlight_present_scene_2d,
        op_goldlight_create_scene_3d,
        op_goldlight_scene_3d_set_clear_color,
        op_goldlight_scene_3d_set_camera,
        op_goldlight_scene_3d_create_triangle,
        op_goldlight_triangle_3d_update,
        op_goldlight_present_scene_3d
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

#[cfg(feature = "dev-runtime")]
fn dev_original_specifier_from_relative(
    project_root: &Path,
    relative_specifier: &str,
) -> Result<ModuleSpecifier, JsErrorBox> {
    let (path_part, query_part) = match relative_specifier.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (relative_specifier, None),
    };
    let mut specifier =
        ModuleSpecifier::from_file_path(project_root.join(path_part.trim_start_matches('/')))
            .map_err(|_| JsErrorBox::generic("invalid dev module path"))?;
    if let Some(query) = query_part {
        specifier.set_query(Some(query));
    }
    Ok(specifier)
}

fn get_global_function(js_runtime: &mut JsRuntime, name: &str) -> Result<v8::Global<v8::Function>> {
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

fn install_runtime_globals(js_runtime: &mut JsRuntime) -> Result<()> {
    #[cfg(feature = "dev-runtime")]
    js_runtime
        .execute_script("ext:goldlight/hmr.js", GOLDLIGHT_HMR_SOURCE)
        .context("failed to install hmr globals")?;
    js_runtime
        .execute_script(
            "ext:goldlight/dom_exception.js",
            GOLDLIGHT_DOM_EXCEPTION_SOURCE,
        )
        .context("failed to install DOMException globals")?;
    js_runtime
        .execute_script("ext:goldlight/blob.js", GOLDLIGHT_BLOB_SOURCE)
        .context("failed to install blob globals")?;
    js_runtime
        .execute_script("ext:goldlight/streams.js", GOLDLIGHT_STREAMS_SOURCE)
        .context("failed to install stream globals")?;
    js_runtime
        .execute_script("ext:goldlight/abort.js", GOLDLIGHT_ABORT_SOURCE)
        .context("failed to install abort globals")?;
    js_runtime
        .execute_script("ext:goldlight/fetch.js", GOLDLIGHT_FETCH_SOURCE)
        .context("failed to install fetch globals")?;
    js_runtime
        .execute_script("ext:goldlight/websocket.js", GOLDLIGHT_WEBSOCKET_SOURCE)
        .context("failed to install websocket globals")?;
    js_runtime
        .execute_script(
            "ext:goldlight/webtransport.js",
            GOLDLIGHT_WEBTRANSPORT_SOURCE,
        )
        .context("failed to install webtransport globals")?;
    js_runtime
        .execute_script("ext:goldlight/timers.js", GOLDLIGHT_TIMERS_SOURCE)
        .context("failed to install timer globals")?;
    Ok(())
}

impl ModuleLoader for GoldlightModuleLoader {
    fn resolve(
        &self,
        specifier: &str,
        referrer: &str,
        _kind: ResolutionKind,
    ) -> Result<ModuleSpecifier, JsErrorBox> {
        if specifier == "goldlight" || specifier == "/__goldlight/runtime" {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER)
                .map_err(JsErrorBox::from_err);
        }
        #[cfg(feature = "dev-runtime")]
        if specifier == "/@vite/client" {
            return ModuleSpecifier::parse(GOLDLIGHT_VITE_CLIENT_SPECIFIER)
                .map_err(JsErrorBox::from_err);
        }

        if referrer == GOLDLIGHT_MODULE_SPECIFIER && specifier.starts_with("./") {
            return ModuleSpecifier::parse(GOLDLIGHT_MODULE_SPECIFIER)
                .map_err(JsErrorBox::from_err);
        }

        if let RuntimeMode::Dev {
            vite_origin,
            project_root: _,
        } = &self.mode
        {
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
        #[cfg(feature = "dev-runtime")]
        if module_specifier.as_str() == GOLDLIGHT_VITE_CLIENT_SPECIFIER {
            return ModuleLoadResponse::Sync(Ok(ModuleSource::new(
                ModuleType::JavaScript,
                ModuleSourceCode::String(String::from(GOLDLIGHT_VITE_CLIENT_SOURCE).into()),
                module_specifier,
                None,
            )));
        }

        let module_specifier = module_specifier.clone();
        #[cfg(feature = "dev-runtime")]
        let mode = self.mode.clone();
        let fut = async move {
            #[cfg(not(feature = "dev-runtime"))]
            if matches!(module_specifier.scheme(), "http" | "https") {
                return Err(JsErrorBox::generic(format!(
                    "HTTP modules require the dev-runtime feature: {module_specifier}"
                )));
            }
            #[cfg(feature = "dev-runtime")]
            if matches!(module_specifier.scheme(), "http" | "https") {
                if !matches!(mode, RuntimeMode::Dev { .. }) {
                    return Err(JsErrorBox::generic(format!(
                        "HTTP modules are only allowed in the dev runtime: {module_specifier}"
                    )));
                }

                let original_specifier = if let RuntimeMode::Dev {
                    vite_origin,
                    project_root,
                } = &mode
                {
                    if let Some(relative_specifier) = module_specifier
                        .as_str()
                        .strip_prefix(&format!("{vite_origin}/"))
                    {
                        if !relative_specifier.starts_with("@") {
                            dev_original_specifier_from_relative(project_root, relative_specifier)
                                .ok()
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
                                inject_hot_context_prelude(code),
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
    main_timer_state: TimerHostStateHandle,
    mode: RuntimeMode,
    entrypoint_specifier: ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    windows: HashMap<WindowId, WindowRecord>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    main_shutdown_tx: Option<Sender<()>>,
    inspector_registry: Option<InspectorRegistryHandle>,
    hmr_registry: Option<HmrRegistryHandle>,
    frame_time_origin: std::time::Instant,
    restart_requested: bool,
}

#[cfg(feature = "dev-runtime")]
struct InspectorServerHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    thread_handle: Option<thread::JoinHandle<()>>,
    registry: InspectorRegistryHandle,
}

struct HmrClientHandle {
    shutdown_flag: Arc<AtomicBool>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl HmrClientHandle {
    fn shutdown(mut self) {
        self.shutdown_flag.store(true, Ordering::SeqCst);
        if let Some(thread_handle) = self.thread_handle.take() {
            thread::spawn(move || {
                let _ = thread_handle.join();
            });
        }
    }
}

#[cfg(feature = "dev-runtime")]
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
    shutdown_tx: Sender<()>,
}

impl MainRuntimeThreadHandle {
    fn shutdown(self) {
        let _ = self.shutdown_tx.send(());
    }
}

#[cfg(feature = "dev-runtime")]
type InspectorRegistryHandle = Arc<Mutex<HashMap<String, InspectorTargetRecord>>>;
#[cfg(not(feature = "dev-runtime"))]
type InspectorRegistryHandle = ();

#[cfg(feature = "dev-runtime")]
#[derive(Clone)]
struct InspectorServerState {
    registry: InspectorRegistryHandle,
    socket_addr: SocketAddr,
}

#[cfg(feature = "dev-runtime")]
#[derive(Clone, Copy, PartialEq, Eq)]
enum InspectorTargetKind {
    Main,
    Worker,
}

#[cfg(feature = "dev-runtime")]
#[derive(Clone)]
struct InspectorTargetRecord {
    target_id: String,
    title: String,
    app_url: String,
    target_type: &'static str,
    kind: InspectorTargetKind,
    session_sender: mpsc::UnboundedSender<InspectorSessionProxy>,
}

#[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
fn unregister_inspector_target(registry: &InspectorRegistryHandle, target_id: &str) {
    let _ = registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .remove(target_id);
}

#[cfg(feature = "dev-runtime")]
fn inspector_devtools_frontend_url(socket_addr: SocketAddr, target_id: &str) -> String {
    format!(
        "devtools://devtools/bundled/js_app.html?ws={}/ws/{}&experiments=true&v8only=true",
        socket_addr, target_id
    )
}

#[cfg(feature = "dev-runtime")]
fn inspector_worker_info(record: &InspectorTargetRecord, session_id: &str) -> serde_json::Value {
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
        main_timer_state: TimerHostStateHandle,
        mode: RuntimeMode,
        entrypoint_specifier: ModuleSpecifier,
        event_proxy: EventLoopProxy<RuntimeUserEvent>,
        startup_complete: Arc<AtomicBool>,
        main_runtime_idle: Arc<AtomicBool>,
        main_shutdown_tx: Option<Sender<()>>,
        inspector_registry: Option<InspectorRegistryHandle>,
        hmr_registry: Option<HmrRegistryHandle>,
    ) -> Self {
        Self {
            state,
            main_timer_state,
            mode,
            entrypoint_specifier,
            event_proxy,
            windows: HashMap::new(),
            startup_complete,
            main_runtime_idle,
            main_shutdown_tx,
            inspector_registry,
            hmr_registry,
            frame_time_origin: std::time::Instant::now(),
            restart_requested: false,
        }
    }

    fn drain_pending_windows(&mut self, event_loop: &ActiveEventLoop) {
        let pending = {
            let mut state = self.state.lock().expect("runtime state mutex poisoned");
            std::mem::take(&mut state.pending_windows)
        };
        for pending_window in pending {
            let startup_presented = pending_window.show_policy == WindowShowPolicy::Immediate;
            let attributes = WindowAttributes::default()
                .with_title(pending_window.title.clone())
                .with_inner_size(winit::dpi::PhysicalSize::new(
                    pending_window.width,
                    pending_window.height,
                ))
                .with_visible(startup_presented);
            let window = Arc::new(
                event_loop
                    .create_window(attributes)
                    .expect("failed to create runtime window"),
            );
            let window_id = window.id();
            let renderer_bootstrap = RendererBootstrap::new(window.clone())
                .expect("failed to create window renderer bootstrap");
            let renderer = spawn_window_renderer(renderer_bootstrap, self.event_proxy.clone());
            debug!(
                id = pending_window.id,
                title = pending_window.title,
                "runtime window created"
            );
            let worker = pending_window
                .worker_entrypoint
                .clone()
                .map(|worker_entrypoint| {
                    let worker = spawn_window_worker(
                        self.mode.clone(),
                        self.entrypoint_specifier.clone(),
                        pending_window.id,
                        worker_entrypoint,
                        self.event_proxy.clone(),
                        self.inspector_registry.clone(),
                        self.hmr_registry.clone(),
                    );
                    worker.push_event(WorkerEventPayload::Resize {
                        width: pending_window.width,
                        height: pending_window.height,
                    });
                    worker
                });
            self.windows.insert(
                window_id,
                WindowRecord {
                    window,
                    worker,
                    renderer: WindowRendererState::Pending(renderer),
                    render_model_snapshot: None,
                    pending_resize: None,
                    initial_clear_color: pending_window.initial_clear_color,
                    show_policy: pending_window.show_policy,
                    startup_presented,
                },
            );
        }
    }

    fn promote_pending_renderers(&mut self) {
        for record in self.windows.values_mut() {
            let init_result = match &mut record.renderer {
                WindowRendererState::Pending(handle) => Some(handle.result_rx.try_recv()),
                WindowRendererState::Ready(_) | WindowRendererState::Failed => None,
            };
            let Some(init_result) = init_result else {
                continue;
            };
            match init_result {
                Ok(Ok(mut renderer)) => {
                    if let Some(size) = record.pending_resize.take() {
                        renderer.resize(size);
                    }
                    record.renderer = WindowRendererState::Ready(renderer);
                    record.window.request_redraw();
                }
                Ok(Err(error)) => {
                    eprintln!("goldlight renderer init failed: {error:?}");
                    record.renderer = WindowRendererState::Failed;
                }
                Err(std_mpsc::TryRecvError::Empty) => {}
                Err(std_mpsc::TryRecvError::Disconnected) => {
                    eprintln!("goldlight renderer init failed: renderer init thread disconnected");
                    record.renderer = WindowRendererState::Failed;
                }
            }
        }
    }

    fn sync_window_redraws(&mut self) {
        for record in self.windows.values_mut() {
            let Some(worker) = record.worker.as_ref() else {
                continue;
            };
            let published_render_model = worker.take_published_render_model();
            let animation_frame_requested = worker.take_animation_frame_request();

            let mut needs_redraw = false;
            if let Some(render_model) = published_render_model {
                record.render_model_snapshot = Some(render_model);
                if !record.startup_presented
                    && record.show_policy == WindowShowPolicy::AfterFirstPaint
                {
                    needs_redraw = !Self::present_first_frame(record);
                } else {
                    needs_redraw = true;
                }
            }
            if animation_frame_requested {
                needs_redraw = true;
            }
            if needs_redraw {
                record.window.request_redraw();
            }
        }
    }

    fn render_window(record: &mut WindowRecord) -> bool {
        if let (WindowRendererState::Ready(renderer), Some(render_model)) =
            (&mut record.renderer, record.render_model_snapshot.as_ref())
        {
            match renderer.render(render_model.as_ref()) {
                Ok(rendered) => {
                    if rendered {
                        Self::complete_startup_presentation(record);
                    }
                    rendered
                }
                Err(error) => {
                    eprintln!("goldlight render failed: {error:?}");
                    false
                }
            }
        } else {
            false
        }
    }

    fn draw_window(record: &mut WindowRecord) -> bool {
        if record.startup_presented {
            return Self::render_window(record);
        }
        match record.show_policy {
            WindowShowPolicy::Immediate => Self::render_window(record),
            WindowShowPolicy::AfterInitialClear => Self::present_initial_clear(record),
            WindowShowPolicy::AfterFirstPaint => Self::present_first_frame(record),
        }
    }

    fn complete_startup_presentation(record: &mut WindowRecord) {
        if record.startup_presented {
            return;
        }
        record.window.set_visible(true);
        record.startup_presented = true;
    }

    fn present_initial_clear(record: &mut WindowRecord) -> bool {
        if record.startup_presented || record.show_policy != WindowShowPolicy::AfterInitialClear {
            return false;
        }
        let WindowRendererState::Ready(renderer) = &mut record.renderer else {
            return false;
        };
        match renderer.render_clear(record.initial_clear_color) {
            Ok(rendered) => {
                if rendered {
                    Self::complete_startup_presentation(record);
                }
                rendered
            }
            Err(error) => {
                eprintln!("goldlight initial clear failed: {error:?}");
                false
            }
        }
    }

    fn present_first_frame(record: &mut WindowRecord) -> bool {
        if record.startup_presented || record.show_policy != WindowShowPolicy::AfterFirstPaint {
            return false;
        }
        Self::render_window(record)
    }

    fn present_pending_startup_frames(&mut self) {
        for record in self.windows.values_mut() {
            if Self::present_initial_clear(record) {
                record.window.request_redraw();
                continue;
            }
            let _ = Self::present_first_frame(record);
        }
    }

    fn maybe_exit(&self, event_loop: &ActiveEventLoop) {
        let has_pending_timers = self
            .main_timer_state
            .lock()
            .map(|timer_state| !timer_state.timers.is_empty())
            .unwrap_or(true);
        if self.startup_complete.load(Ordering::SeqCst)
            && self.windows.is_empty()
            && !has_pending_timers
            && self.main_runtime_idle.load(Ordering::SeqCst)
        {
            if let Some(main_shutdown_tx) = &self.main_shutdown_tx {
                let _ = main_shutdown_tx.send(());
            }
            event_loop.exit();
        }
    }

    #[cfg(feature = "dev-runtime")]
    fn shutdown_all_windows(&mut self) {
        let window_ids = self.windows.keys().copied().collect::<Vec<_>>();
        for window_id in window_ids {
            if let Some(mut record) = self.windows.remove(&window_id) {
                if let Some(worker) = record.worker.take() {
                    worker.shutdown();
                }
            }
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
                match &mut record.renderer {
                    WindowRendererState::Ready(renderer) => {
                        renderer.resize(size);
                    }
                    WindowRendererState::Pending(_) | WindowRendererState::Failed => {
                        record.pending_resize = Some(size);
                    }
                }
                record.window.request_redraw();
                if let Some(worker) = record.worker.as_ref() {
                    worker.push_event(WorkerEventPayload::Resize {
                        width: size.width,
                        height: size.height,
                    });
                }
            }
            WindowEvent::RedrawRequested => {
                let _ = Self::draw_window(record);
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
        self.promote_pending_renderers();
        self.present_pending_startup_frames();
        self.sync_window_redraws();
        self.maybe_exit(event_loop);
    }

    fn user_event(&mut self, event_loop: &ActiveEventLoop, _event: RuntimeUserEvent) {
        match _event {
            RuntimeUserEvent::Wake => {
                self.drain_pending_windows(event_loop);
                self.promote_pending_renderers();
                self.present_pending_startup_frames();
                self.sync_window_redraws();
                self.maybe_exit(event_loop);
            }
            #[cfg(feature = "dev-runtime")]
            RuntimeUserEvent::HotReload => {
                self.restart_requested = true;
                self.shutdown_all_windows();
                if let Some(main_shutdown_tx) = &self.main_shutdown_tx {
                    let _ = main_shutdown_tx.send(());
                }
                event_loop.exit();
            }
        }
    }
}

pub fn init_logging() {
    let env_filter =
        tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "warn".into());
    tracing_subscriber::fmt().with_env_filter(env_filter).init();
}

pub fn resolve_dev_config(vite_origin: &str, entrypoint: Option<&str>) -> Result<RuntimeConfig> {
    let normalized_origin = vite_origin.trim_end_matches('/');
    let selected_entrypoint = entrypoint
        .context("dev runtime requires an explicit entrypoint")?
        .replace('\\', "/");
    let project_root = std::env::current_dir().context("failed to resolve current project root")?;
    let entrypoint_specifier =
        ModuleSpecifier::parse(&format!("{normalized_origin}/{selected_entrypoint}"))?;

    Ok(RuntimeConfig {
        mode: RuntimeMode::Dev {
            vite_origin: normalized_origin.to_string(),
            project_root,
        },
        entrypoint_specifier,
        #[cfg(feature = "dev-runtime")]
        inspector: None,
    })
}

pub fn resolve_prod_config(
    bundle_root: Option<&str>,
    entrypoint: Option<&str>,
) -> Result<RuntimeConfig> {
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
        #[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
fn vite_hmr_ws_url(vite_origin: &str) -> Result<String> {
    if let Some(rest) = vite_origin.strip_prefix("http://") {
        return Ok(format!("ws://{rest}"));
    }
    if let Some(rest) = vite_origin.strip_prefix("https://") {
        return Ok(format!("wss://{rest}"));
    }
    Err(anyhow!(
        "unsupported vite origin for hmr websocket: {vite_origin}"
    ))
}

#[cfg(feature = "dev-runtime")]
fn spawn_hmr_client(
    vite_origin: String,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    hmr_registry: HmrRegistryHandle,
) -> HmrClientHandle {
    let shutdown_flag = Arc::new(AtomicBool::new(false));
    let shutdown_flag_for_thread = shutdown_flag.clone();
    let thread_handle = thread::spawn(move || {
        let websocket_url = match vite_hmr_ws_url(&vite_origin) {
            Ok(url) => url,
            Err(_) => {
                return;
            }
        };

        let runtime = match TokioRuntimeBuilder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(_) => {
                return;
            }
        };

        runtime.block_on(async move {
            while !shutdown_flag_for_thread.load(Ordering::SeqCst) {
                match connect_hmr_fastwebsocket(&websocket_url, &[String::from("vite-hmr")]).await {
                    Ok(mut socket) => {
                        while !shutdown_flag_for_thread.load(Ordering::SeqCst) {
                            match socket.read_frame().await {
                                Ok(frame) if frame.opcode == FastOpCode::Text => {
                                    let text = String::from_utf8_lossy(&frame.payload).into_owned();
                                    let Ok(payload) =
                                        serde_json::from_str::<serde_json::Value>(&text)
                                    else {
                                        continue;
                                    };
                                    let message_type =
                                        payload.get("type").and_then(|value| value.as_str());
                                    if matches!(message_type, Some("full-reload")) {
                                        let _ = event_proxy.send_event(RuntimeUserEvent::HotReload);
                                        continue;
                                    }
                                    if matches!(message_type, Some("custom"))
                                        && matches!(
                                            payload.get("event").and_then(|value| value.as_str()),
                                            Some("goldlight:hmr-update")
                                        )
                                    {
                                        let updates = payload
                                            .get("data")
                                            .and_then(|value| value.get("updates"))
                                            .and_then(|value| value.as_array())
                                            .cloned()
                                            .unwrap_or_default();
                                        for update in updates {
                                            let Some(path) =
                                                update.get("path").and_then(|value| value.as_str())
                                            else {
                                                continue;
                                            };
                                            let accepted_path = update
                                                .get("acceptedPath")
                                                .and_then(|value| value.as_str())
                                                .map(ToOwned::to_owned);
                                            let timestamp = update
                                                .get("timestamp")
                                                .and_then(|value| value.as_u64())
                                                .unwrap_or(0);
                                            broadcast_hmr_update(
                                                &hmr_registry,
                                                HmrUpdatePayload {
                                                    path: path.to_string(),
                                                    accepted_path,
                                                    timestamp,
                                                },
                                            );
                                        }
                                        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
                                        continue;
                                    }
                                    if matches!(message_type, Some("update")) {
                                        let updates = payload
                                            .get("updates")
                                            .and_then(|value| value.as_array())
                                            .cloned()
                                            .unwrap_or_default();
                                        for update in updates {
                                            let Some(path) =
                                                update.get("path").and_then(|value| value.as_str())
                                            else {
                                                continue;
                                            };
                                            let accepted_path = update
                                                .get("acceptedPath")
                                                .and_then(|value| value.as_str())
                                                .map(ToOwned::to_owned);
                                            let timestamp = update
                                                .get("timestamp")
                                                .and_then(|value| value.as_u64())
                                                .unwrap_or(0);
                                            broadcast_hmr_update(
                                                &hmr_registry,
                                                HmrUpdatePayload {
                                                    path: path.to_string(),
                                                    accepted_path,
                                                    timestamp,
                                                },
                                            );
                                        }
                                        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
                                    }
                                }
                                Ok(frame) if frame.opcode == FastOpCode::Ping => {
                                    let _ = socket
                                        .write_frame(FastWebSocketFrame::pong(frame.payload))
                                        .await;
                                }
                                Ok(frame) if frame.opcode == FastOpCode::Close => break,
                                Ok(_) => {}
                                Err(_) => break,
                            }
                        }
                        let _ = socket
                            .write_frame(FastWebSocketFrame::close_raw(vec![].into()))
                            .await;
                    }
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                }
            }
        });
    });

    HmrClientHandle {
        shutdown_flag,
        thread_handle: Some(thread_handle),
    }
}

pub fn run_runtime(config: RuntimeConfig) -> Result<RuntimeRunResult> {
    let backend = wgpu::Backends::all();
    debug!(
        ?backend,
        mode = ?config.mode,
        entrypoint = %config.entrypoint_specifier,
        "goldlight runtime booting"
    );

    let event_loop = EventLoop::<RuntimeUserEvent>::with_user_event().build()?;
    let event_proxy = event_loop.create_proxy();
    #[cfg(feature = "dev-runtime")]
    let hmr_registry = matches!(config.mode, RuntimeMode::Dev { .. })
        .then(|| Arc::new(Mutex::new(HashMap::new())));
    #[cfg(not(feature = "dev-runtime"))]
    let hmr_registry: Option<HmrRegistryHandle> = None;

    #[cfg(feature = "dev-runtime")]
    let hmr_client = match &config.mode {
        RuntimeMode::Dev { vite_origin, .. } => Some(spawn_hmr_client(
            vite_origin.clone(),
            event_proxy.clone(),
            hmr_registry
                .as_ref()
                .expect("dev runtime should have an hmr registry")
                .clone(),
        )),
        RuntimeMode::Prod { .. } => None,
    };
    #[cfg(not(feature = "dev-runtime"))]
    let hmr_client: Option<HmrClientHandle> = None;
    let runtime_state = Arc::new(Mutex::new(RuntimeState::default()));
    let main_timer_state = Arc::new(Mutex::new(TimerHostState::default()));
    let startup_complete = Arc::new(AtomicBool::new(false));
    let main_runtime_idle = Arc::new(AtomicBool::new(false));
    #[cfg(feature = "dev-runtime")]
    let inspector_server = config
        .inspector
        .clone()
        .map(|inspector_config| spawn_inspector_server(inspector_config.socket_addr))
        .transpose()?;
    #[cfg(not(feature = "dev-runtime"))]
    let _inspector_server: Option<()> = None;
    #[cfg(feature = "dev-runtime")]
    let inspector_registry = inspector_server.as_ref().map(|server| server.registry());
    #[cfg(not(feature = "dev-runtime"))]
    let inspector_registry: Option<InspectorRegistryHandle> = None;
    let runtime_thread = spawn_main_runtime_thread(
        runtime_state.clone(),
        main_timer_state.clone(),
        config.mode.clone(),
        config.entrypoint_specifier.clone(),
        event_proxy.clone(),
        startup_complete.clone(),
        main_runtime_idle.clone(),
        inspector_registry.clone(),
        hmr_registry.clone(),
    );

    let mut app = GoldlightRuntime::new(
        runtime_state,
        main_timer_state,
        config.mode,
        config.entrypoint_specifier,
        event_proxy,
        startup_complete,
        main_runtime_idle,
        Some(runtime_thread.shutdown_tx.clone()),
        inspector_registry,
        hmr_registry,
    );
    event_loop.run_app(&mut app)?;
    runtime_thread.shutdown();
    if let Some(hmr_client) = hmr_client {
        hmr_client.shutdown();
    }
    #[cfg(feature = "dev-runtime")]
    if let Some(inspector_server) = inspector_server {
        inspector_server.shutdown();
    }
    Ok(if app.restart_requested {
        RuntimeRunResult::RestartRequested
    } else {
        RuntimeRunResult::Completed
    })
}

fn spawn_window_worker(
    mode: RuntimeMode,
    base_specifier: ModuleSpecifier,
    window_id: u32,
    worker_entrypoint: String,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    inspector_registry: Option<InspectorRegistryHandle>,
    hmr_registry: Option<HmrRegistryHandle>,
) -> WindowWorkerHandle {
    #[cfg(not(feature = "dev-runtime"))]
    let _ = window_id;
    let worker_state = Arc::new(Mutex::new(WorkerHostState::default()));
    let timer_state = Arc::new(Mutex::new(TimerHostState::default()));
    let (control_tx, control_rx) = std_mpsc::channel::<WindowWorkerControl>();
    let thread_worker_state = worker_state.clone();
    let thread_handle = thread::spawn(move || {
        let worker_specifier = match ModuleSpecifier::parse(&worker_entrypoint).or_else(|_| {
            resolve_import(&worker_entrypoint, base_specifier.as_str())
                .map_err(JsErrorBox::from_err)
        }) {
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
            timer_state,
            mode,
            &worker_specifier,
            event_proxy.clone(),
            &control_rx,
            inspector_registry,
            hmr_registry,
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
    timer_state: TimerHostStateHandle,
    mode: RuntimeMode,
    main_module: ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    inspector_registry: Option<InspectorRegistryHandle>,
    hmr_registry: Option<HmrRegistryHandle>,
) -> MainRuntimeThreadHandle {
    let (shutdown_tx, shutdown_rx) = std_mpsc::channel::<()>();
    let shutdown_tx_for_thread = shutdown_tx.clone();
    let _thread_handle = thread::spawn(move || {
        let result = run_main_runtime_thread(
            runtime_state,
            timer_state,
            mode,
            main_module,
            event_proxy.clone(),
            &shutdown_rx,
            startup_complete.clone(),
            main_runtime_idle.clone(),
            inspector_registry,
            hmr_registry,
        );

        if let Err(error) = result {
            eprintln!("goldlight main runtime failed: {error:?}");
        }
        let _ = shutdown_tx_for_thread.send(());
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    });

    MainRuntimeThreadHandle { shutdown_tx }
}

fn run_main_runtime_thread(
    runtime_state: RuntimeStateHandle,
    timer_state: TimerHostStateHandle,
    mode: RuntimeMode,
    main_module: ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    shutdown_rx: &std_mpsc::Receiver<()>,
    startup_complete: Arc<AtomicBool>,
    main_runtime_idle: Arc<AtomicBool>,
    inspector_registry: Option<InspectorRegistryHandle>,
    hmr_registry: Option<HmrRegistryHandle>,
) -> Result<()> {
    #[cfg(not(feature = "dev-runtime"))]
    let _ = &hmr_registry;
    #[cfg(feature = "dev-runtime")]
    let hmr_state = hmr_registry
        .as_ref()
        .map(|_| Arc::new(Mutex::new(HmrRuntimeState::default())));
    #[cfg(not(feature = "dev-runtime"))]
    let _hmr_state: Option<HmrRuntimeStateHandle> = None;
    let fetch_state = Arc::new(Mutex::new(FetchHostState::default()));
    let websocket_state = Arc::new(Mutex::new(WebSocketHostState::default()));
    let webtransport_state = Arc::new(Mutex::new(WebTransportHostState::default()));
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(Rc::new(GoldlightModuleLoader::new(mode.clone()))),
        extensions: vec![goldlight_runtime::init(RuntimeOpContext {
            state: runtime_state,
            event_proxy: Some(event_proxy.clone()),
            worker_state: None,
            timer_state,
            fetch_state: fetch_state.clone(),
            websocket_state: websocket_state.clone(),
            webtransport_state: webtransport_state.clone(),
            #[cfg(feature = "dev-runtime")]
            hmr_state: hmr_state.clone(),
        })],
        inspector: inspector_registry.is_some(),
        is_main: true,
        ..Default::default()
    });
    install_runtime_globals(&mut js_runtime)?;

    #[cfg(feature = "dev-runtime")]
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
    #[cfg(not(feature = "dev-runtime"))]
    let _main_target_id: Option<String> = None;
    #[cfg(feature = "dev-runtime")]
    let main_hmr_runtime_id = if let (Some(hmr_registry), Some(hmr_state)) =
        (hmr_registry.as_ref(), hmr_state.as_ref())
    {
        Some(register_hmr_runtime(hmr_registry, hmr_state.clone()))
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
    let timer_pump = get_global_function(&mut js_runtime, "__goldlightPumpTimers")
        .context("failed to capture main timer pump function")?;
    let fetch_pump = get_global_function(&mut js_runtime, "__goldlightPumpFetch")
        .context("failed to capture main fetch pump function")?;
    let websocket_pump = get_global_function(&mut js_runtime, "__goldlightPumpWebSockets")
        .context("failed to capture main websocket pump function")?;
    #[cfg(feature = "dev-runtime")]
    let hmr_pump = get_global_function(&mut js_runtime, "__goldlightPumpHmr")
        .context("failed to capture main hmr pump function")?;
    startup_complete.store(true, Ordering::SeqCst);
    main_runtime_idle.store(true, Ordering::SeqCst);
    let _ = event_proxy.send_event(RuntimeUserEvent::Wake);

    while shutdown_rx.try_recv().is_err() {
        main_runtime_idle.store(false, Ordering::SeqCst);
        tokio_runtime.block_on(async {
            let timer_pump_call = js_runtime.call(&timer_pump);
            js_runtime
                .with_event_loop_future(
                    timer_pump_call,
                    PollEventLoopOptions {
                        wait_for_inspector: false,
                        pump_v8_message_loop: true,
                    },
                )
                .await?;
            let fetch_pump_call = js_runtime.call(&fetch_pump);
            js_runtime
                .with_event_loop_future(
                    fetch_pump_call,
                    PollEventLoopOptions {
                        wait_for_inspector: false,
                        pump_v8_message_loop: true,
                    },
                )
                .await?;
            let websocket_pump_call = js_runtime.call(&websocket_pump);
            js_runtime
                .with_event_loop_future(
                    websocket_pump_call,
                    PollEventLoopOptions {
                        wait_for_inspector: false,
                        pump_v8_message_loop: true,
                    },
                )
                .await?;
            #[cfg(feature = "dev-runtime")]
            {
                let hmr_pump_call = js_runtime.call(&hmr_pump);
                js_runtime
                    .with_event_loop_future(
                        hmr_pump_call,
                        PollEventLoopOptions {
                            wait_for_inspector: false,
                            pump_v8_message_loop: true,
                        },
                    )
                    .await?;
            }
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

        thread::sleep(Duration::from_millis(RUNTIME_POLL_INTERVAL_MS));
    }

    #[cfg(feature = "dev-runtime")]
    if let (Some(inspector_registry), Some(main_target_id)) = (&inspector_registry, &main_target_id)
    {
        unregister_inspector_target(inspector_registry, main_target_id);
    }
    #[cfg(feature = "dev-runtime")]
    if let (Some(hmr_registry), Some(main_hmr_runtime_id)) = (&hmr_registry, &main_hmr_runtime_id) {
        unregister_hmr_runtime(hmr_registry, main_hmr_runtime_id);
    }
    shutdown_all_fetch_requests(&fetch_state);
    shutdown_all_websockets(&websocket_state);
    shutdown_all_webtransports(&webtransport_state);

    Ok(())
}

// The worker owns the mutable render model; the main thread only renders published snapshots.
fn publish_worker_render_model_snapshot(worker_state: &WorkerHostStateHandle) -> bool {
    let Ok(mut worker_state) = worker_state.lock() else {
        return false;
    };
    if worker_state.published_render_model_revision == Some(worker_state.render_model_revision) {
        return false;
    }

    worker_state.published_render_model = Some(Arc::new(worker_state.render_model.clone()));
    worker_state.published_render_model_revision = Some(worker_state.render_model_revision);
    worker_state.published_render_model_pending = true;
    true
}

fn run_window_worker_thread(
    runtime_state: RuntimeStateHandle,
    worker_state: WorkerHostStateHandle,
    timer_state: TimerHostStateHandle,
    mode: RuntimeMode,
    main_module: &ModuleSpecifier,
    event_proxy: EventLoopProxy<RuntimeUserEvent>,
    control_rx: &std_mpsc::Receiver<WindowWorkerControl>,
    inspector_registry: Option<InspectorRegistryHandle>,
    hmr_registry: Option<HmrRegistryHandle>,
    window_id: u32,
) -> Result<()> {
    #[cfg(not(feature = "dev-runtime"))]
    let _ = &hmr_registry;
    #[cfg(not(feature = "dev-runtime"))]
    let _ = window_id;
    #[cfg(feature = "dev-runtime")]
    let hmr_state = hmr_registry
        .as_ref()
        .map(|_| Arc::new(Mutex::new(HmrRuntimeState::default())));
    #[cfg(not(feature = "dev-runtime"))]
    let _hmr_state: Option<HmrRuntimeStateHandle> = None;
    let fetch_state = Arc::new(Mutex::new(FetchHostState::default()));
    let websocket_state = Arc::new(Mutex::new(WebSocketHostState::default()));
    let webtransport_state = Arc::new(Mutex::new(WebTransportHostState::default()));
    let mut js_runtime = JsRuntime::new(RuntimeOptions {
        module_loader: Some(Rc::new(GoldlightModuleLoader::new(mode))),
        extensions: vec![goldlight_runtime::init(RuntimeOpContext {
            state: runtime_state,
            event_proxy: Some(event_proxy.clone()),
            worker_state: Some(worker_state.clone()),
            timer_state,
            fetch_state: fetch_state.clone(),
            websocket_state: websocket_state.clone(),
            webtransport_state: webtransport_state.clone(),
            #[cfg(feature = "dev-runtime")]
            hmr_state: hmr_state.clone(),
        })],
        inspector: inspector_registry.is_some(),
        is_main: false,
        ..Default::default()
    });
    install_runtime_globals(&mut js_runtime)?;

    #[cfg(feature = "dev-runtime")]
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
    #[cfg(not(feature = "dev-runtime"))]
    let _worker_target_id: Option<String> = None;
    #[cfg(feature = "dev-runtime")]
    let worker_hmr_runtime_id = if let (Some(hmr_registry), Some(hmr_state)) =
        (hmr_registry.as_ref(), hmr_state.as_ref())
    {
        Some(register_hmr_runtime(hmr_registry, hmr_state.clone()))
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

    let layout_flush = get_global_function(&mut js_runtime, "__goldlightFlushLayout")
        .context("failed to capture window worker layout flush function")?;
    let worker_pump = get_global_function(&mut js_runtime, "__goldlightPump")
        .context("failed to capture window worker pump function")?;
    let timer_pump = get_global_function(&mut js_runtime, "__goldlightPumpTimers")
        .context("failed to capture window worker timer pump function")?;
    let fetch_pump = get_global_function(&mut js_runtime, "__goldlightPumpFetch")
        .context("failed to capture window worker fetch pump function")?;
    let websocket_pump = get_global_function(&mut js_runtime, "__goldlightPumpWebSockets")
        .context("failed to capture window worker websocket pump function")?;
    #[cfg(feature = "dev-runtime")]
    let hmr_pump = get_global_function(&mut js_runtime, "__goldlightPumpHmr")
        .context("failed to capture window worker hmr pump function")?;

    tokio_runtime.block_on(async {
        js_runtime.call(&layout_flush).await?;
        js_runtime
            .run_event_loop(PollEventLoopOptions {
                wait_for_inspector: false,
                pump_v8_message_loop: true,
            })
            .await?;
        Ok::<(), anyhow::Error>(())
    })?;
    if publish_worker_render_model_snapshot(&worker_state) {
        let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
    }

    loop {
        match control_rx.recv_timeout(Duration::from_millis(RUNTIME_POLL_INTERVAL_MS)) {
            Ok(WindowWorkerControl::Shutdown) => break,
            Ok(WindowWorkerControl::Wake) | Err(std_mpsc::RecvTimeoutError::Timeout) => {
                tokio_runtime.block_on(async {
                    let timer_pump_call = js_runtime.call(&timer_pump);
                    js_runtime
                        .with_event_loop_future(
                            timer_pump_call,
                            PollEventLoopOptions {
                                wait_for_inspector: false,
                                pump_v8_message_loop: true,
                            },
                        )
                        .await?;
                    let fetch_pump_call = js_runtime.call(&fetch_pump);
                    js_runtime
                        .with_event_loop_future(
                            fetch_pump_call,
                            PollEventLoopOptions {
                                wait_for_inspector: false,
                                pump_v8_message_loop: true,
                            },
                        )
                        .await?;
                    let websocket_pump_call = js_runtime.call(&websocket_pump);
                    js_runtime
                        .with_event_loop_future(
                            websocket_pump_call,
                            PollEventLoopOptions {
                                wait_for_inspector: false,
                                pump_v8_message_loop: true,
                            },
                        )
                        .await?;
                    #[cfg(feature = "dev-runtime")]
                    {
                        let hmr_pump_call = js_runtime.call(&hmr_pump);
                        js_runtime
                            .with_event_loop_future(
                                hmr_pump_call,
                                PollEventLoopOptions {
                                    wait_for_inspector: false,
                                    pump_v8_message_loop: true,
                                },
                            )
                            .await?;
                    }
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
                    js_runtime.call(&layout_flush).await?;
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
                if publish_worker_render_model_snapshot(&worker_state) {
                    let _ = event_proxy.send_event(RuntimeUserEvent::Wake);
                }
            }
            Err(std_mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    #[cfg(feature = "dev-runtime")]
    if let (Some(inspector_registry), Some(worker_target_id)) =
        (&inspector_registry, &worker_target_id)
    {
        unregister_inspector_target(inspector_registry, worker_target_id);
    }
    #[cfg(feature = "dev-runtime")]
    if let (Some(hmr_registry), Some(worker_hmr_runtime_id)) =
        (&hmr_registry, &worker_hmr_runtime_id)
    {
        unregister_hmr_runtime(hmr_registry, worker_hmr_runtime_id);
    }
    shutdown_all_fetch_requests(&fetch_state);
    shutdown_all_websockets(&websocket_state);
    shutdown_all_webtransports(&webtransport_state);

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
    let executable =
        std::env::current_exe().context("failed to resolve current executable path")?;
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

#[cfg(feature = "dev-runtime")]
fn spawn_inspector_server(socket_addr: SocketAddr) -> Result<InspectorServerHandle> {
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

#[cfg(feature = "dev-runtime")]
async fn inspector_json_version(_state: State<InspectorServerState>) -> Json<serde_json::Value> {
    Json(json!({
        "Browser": "goldlight",
        "Protocol-Version": "1.3",
        "V8-Version": deno_core::v8::VERSION_STRING,
    }))
}

#[cfg(feature = "dev-runtime")]
async fn inspector_json_protocol() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json; charset=UTF-8")],
        INSPECTOR_PROTOCOL_JSON,
    )
}

#[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
async fn inspector_websocket(
    websocket: IncomingUpgrade,
    AxumPath(target_id): AxumPath<String>,
    State(state): State<InspectorServerState>,
) -> Response {
    let Ok((response, upgrade_fut)) = websocket.upgrade() else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    tokio::spawn(async move {
        match upgrade_fut.await {
            Ok(socket) => handle_inspector_websocket(socket, state, target_id).await,
            Err(error) => eprintln!("goldlight inspector websocket upgrade failed: {error}"),
        }
    });
    response.into_response()
}

#[cfg(feature = "dev-runtime")]
struct AttachedWorkerSession {
    record: InspectorTargetRecord,
    session_id: String,
    context_namespace: i64,
    frontend_to_worker_tx: mpsc::UnboundedSender<String>,
    worker_to_frontend_rx: mpsc::UnboundedReceiver<InspectorMsg>,
    request_methods: HashMap<i64, String>,
    attached_announced: bool,
}

#[cfg(feature = "dev-runtime")]
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
    record.session_sender.clone().unbounded_send(proxy).ok()?;
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

#[cfg(feature = "dev-runtime")]
fn websocket_text_frame(message: String) -> FastWebSocketFrame<'static> {
    FastWebSocketFrame::text(message.into_bytes().into())
}

#[cfg(feature = "dev-runtime")]
fn ignore_websocket_obligation<'a>(
    _: FastWebSocketFrame<'a>,
) -> std::future::Ready<Result<(), std::io::Error>> {
    std::future::ready(Ok(()))
}

#[cfg(feature = "dev-runtime")]
async fn send_worker_session_message(
    websocket_sender: &mut FastWebSocketWrite<tokio::io::WriteHalf<TokioIo<Upgraded>>>,
    message: String,
) -> bool {
    websocket_sender
        .write_frame(websocket_text_frame(message))
        .await
        .is_ok()
}

#[cfg(feature = "dev-runtime")]
async fn maybe_attach_main_worker_sessions(
    websocket_sender: &mut FastWebSocketWrite<tokio::io::WriteHalf<TokioIo<Upgraded>>>,
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
        let worker = attached_workers
            .entry(record.target_id.clone())
            .or_insert_with(|| {
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

#[cfg(feature = "dev-runtime")]
fn strip_session_id(message: &str) -> Option<(String, String)> {
    let mut value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    let session_id = value.get("sessionId")?.as_str()?.to_string();
    value.as_object_mut()?.remove("sessionId");
    Some((session_id, value.to_string()))
}

#[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
fn worker_call_frame_id(namespace: &str, raw: &str) -> String {
    format!("gl-worker-callframe:{namespace}:{raw}")
}

#[cfg(feature = "dev-runtime")]
fn parse_worker_call_frame_id(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("gl-worker-callframe:")?;
    rest.split_once(':')
}

#[cfg(feature = "dev-runtime")]
fn worker_object_id(namespace: &str, raw: &str) -> String {
    format!("gl-worker-object:{namespace}:{raw}")
}

#[cfg(feature = "dev-runtime")]
fn parse_worker_object_id(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("gl-worker-object:")?;
    rest.split_once(':')
}

#[cfg(feature = "dev-runtime")]
fn encode_worker_execution_context_id(namespace: i64, raw: i64) -> i64 {
    namespace * 1_000_000 + raw
}

#[cfg(feature = "dev-runtime")]
fn decode_worker_execution_context_id(value: i64) -> Option<(i64, i64)> {
    if value < 1_000_000 {
        return None;
    }
    Some((value / 1_000_000, value % 1_000_000))
}

#[cfg(feature = "dev-runtime")]
fn worker_script_id(context_namespace: i64, raw: &str) -> String {
    let raw = raw.parse::<i64>().ok().unwrap_or_default();
    encode_worker_script_id(context_namespace, raw).to_string()
}

#[cfg(feature = "dev-runtime")]
fn parse_worker_script_id(value: &str) -> Option<(i64, String)> {
    decode_worker_script_id(value)
}

#[cfg(feature = "dev-runtime")]
fn encode_worker_script_id(namespace: i64, raw: i64) -> i64 {
    namespace * 1_000_000 + raw
}

#[cfg(feature = "dev-runtime")]
fn decode_worker_script_id(value: &str) -> Option<(i64, String)> {
    let encoded = value.parse::<i64>().ok()?;
    let (namespace, raw) = decode_worker_execution_context_id(encoded)?;
    Some((namespace, raw.to_string()))
}

#[cfg(feature = "dev-runtime")]
enum WorkerRouteKey {
    TargetId(String),
    ContextNamespace(i64),
}

#[cfg(feature = "dev-runtime")]
fn rewrite_worker_outbound_value(
    value: &mut serde_json::Value,
    namespace: &str,
    context_namespace: i64,
) {
    match value {
        serde_json::Value::Object(object) => {
            for (key, child) in object.iter_mut() {
                match key.as_str() {
                    "scriptId" => {
                        let Some(script_id) = child.as_str() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child = serde_json::Value::String(worker_script_id(
                            context_namespace,
                            script_id,
                        ));
                    }
                    "callFrameId" => {
                        let Some(call_frame_id) = child.as_str() else {
                            rewrite_worker_outbound_value(child, namespace, context_namespace);
                            continue;
                        };
                        *child = serde_json::Value::String(worker_call_frame_id(
                            namespace,
                            call_frame_id,
                        ));
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

#[cfg(feature = "dev-runtime")]
fn rewrite_worker_inbound_value(value: &mut serde_json::Value) -> Option<WorkerRouteKey> {
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

#[cfg(feature = "dev-runtime")]
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

#[cfg(feature = "dev-runtime")]
async fn handle_inspector_websocket(
    socket: FastWebSocket<TokioIo<Upgraded>>,
    state: InspectorServerState,
    target_id: String,
) {
    let (mut websocket_receiver, mut websocket_sender) = socket.split(tokio::io::split);
    let target_record = state
        .registry
        .lock()
        .expect("inspector registry mutex poisoned")
        .get(&target_id)
        .cloned();
    let Some(target_record) = target_record else {
        let _ = websocket_sender
            .write_frame(FastWebSocketFrame::close(1000, b""))
            .await;
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
    let mut ignore_obligation = ignore_websocket_obligation;

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
            message = websocket_receiver.read_frame(&mut ignore_obligation) => {
                let Ok(message) = message else {
                    break;
                };

                match message.opcode {
                    FastOpCode::Text => {
                        let Ok(text) = std::str::from_utf8(&message.payload).map(str::to_string) else {
                            continue;
                        };
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
                                            if websocket_sender.write_frame(websocket_text_frame(response)).await.is_err() {
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
                                                if websocket_sender.write_frame(websocket_text_frame(response)).await.is_err() {
                                                    break;
                                                }
                                            }
                                            continue;
                                        }
                                        "NodeWorker.disable" => {
                                            nodeworker_enabled = false;
                                            if let Some(id) = value.get("id") {
                                                let response = json!({ "id": id, "result": {} }).to_string();
                                                if websocket_sender.write_frame(websocket_text_frame(response)).await.is_err() {
                                                    break;
                                                }
                                            }
                                            continue;
                                        }
                                        "NodeWorker.detach" => {
                                            if let Some(id) = value.get("id") {
                                                let response = json!({ "id": id, "result": {} }).to_string();
                                                if websocket_sender.write_frame(websocket_text_frame(response)).await.is_err() {
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
                                    .write_frame(websocket_text_frame(response))
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                    FastOpCode::Binary => {
                        if let Ok(text) = String::from_utf8(message.payload.to_vec()) {
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
                                        .write_frame(websocket_text_frame(response))
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    FastOpCode::Close => break,
                    FastOpCode::Ping => {
                        if websocket_sender.write_frame(FastWebSocketFrame::pong(message.payload.to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                    FastOpCode::Pong => {}
                    _ => {}
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
                            .write_frame(websocket_text_frame(backend_message))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    BackendProtocolAction::Rewrite(outbound) => {
                        if websocket_sender.write_frame(websocket_text_frame(outbound)).await.is_err() {
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
                                            .write_frame(websocket_text_frame(outbound))
                                            .await
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                    BackendProtocolAction::Rewrite(rewritten) => {
                                        if websocket_sender
                                            .write_frame(websocket_text_frame(rewritten))
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
                                    if websocket_sender.write_frame(websocket_text_frame(notification)).await.is_err() {
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

    let _ = websocket_sender
        .write_frame(FastWebSocketFrame::close(1000, b""))
        .await;
}

#[cfg(feature = "dev-runtime")]
enum BackendProtocolAction {
    Passthrough,
    Rewrite(String),
    Suppress,
}

#[cfg(feature = "dev-runtime")]
fn patch_get_script_source_response(message: &str) -> Option<String> {
    let mut value = serde_json::from_str::<serde_json::Value>(message).ok()?;
    let script_source = value
        .get_mut("result")
        .and_then(|result| result.get_mut("scriptSource"))
        .and_then(|script_source| script_source.as_str())
        .map(strip_inline_source_map)?;
    if let Some(result) = value
        .get_mut("result")
        .and_then(|result| result.as_object_mut())
    {
        result.insert(
            "scriptSource".to_string(),
            serde_json::Value::String(script_source),
        );
        return serde_json::to_string(&value).ok();
    }
    None
}

#[cfg(feature = "dev-runtime")]
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
            let Some(script_id) = params
                .get("scriptId")
                .and_then(|script_id| script_id.as_str())
            else {
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

#[cfg(feature = "dev-runtime")]
enum FrontendProtocolAction {
    Forward(String),
    Respond(String),
}

#[cfg(feature = "dev-runtime")]
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
        let Some(script_id) = params
            .get("scriptId")
            .and_then(|script_id| script_id.as_str())
        else {
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
        let Some(params) = rewritten
            .get_mut("params")
            .and_then(|params| params.as_object_mut())
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

#[cfg(feature = "dev-runtime")]
fn remember_inspector_request_method(message: &str, request_methods: &mut HashMap<i64, String>) {
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
