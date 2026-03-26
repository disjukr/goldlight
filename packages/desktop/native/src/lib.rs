use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::ffi::c_char;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::EventLoop;
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowAttributes};

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{CreateSolidBrush, DeleteObject, FillRect, HBRUSH};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetClientRect, SetWindowLongPtrW, GWLP_WNDPROC, WM_ERASEBKGND,
};

const HOST_INIT_OK: u8 = 1;
const HOST_RESULT_OK: u8 = 1;
const EVENT_FRAME: u32 = 1;
const EVENT_RESIZED: u32 = 2;
const EVENT_CLOSE_REQUESTED: u32 = 3;
const EVENT_FOCUS_CHANGED: u32 = 4;
const EVENT_POINTER_MOVED: u32 = 5;
const EVENT_POINTER_BUTTON: u32 = 6;
const EVENT_KEYBOARD: u32 = 7;
const EVENT_SCALE_FACTOR_CHANGED: u32 = 9;
const SYSTEM_WIN32: u32 = 1;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct DesktopHostEvent {
    pub kind: u32,
    pub reserved: u32,
    pub window_id: u64,
    pub arg0: i64,
    pub arg1: i64,
    pub arg2: i64,
    pub arg3: i64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct DesktopWindowSurfaceInfo {
    pub system: u32,
    pub reserved: u32,
    pub window_handle: u64,
    pub display_handle: u64,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct DesktopWindowState {
    pub width: u32,
    pub height: u32,
    pub focused: u32,
    pub reserved: u32,
}

#[derive(Clone, Copy, Default)]
struct SharedWindowState {
    id: u64,
    width: u32,
    height: u32,
    focused: bool,
    surface_info: DesktopWindowSurfaceInfo,
}

struct DesktopHostApplication {
    start_time: Instant,
    events: VecDeque<DesktopHostEvent>,
    window_states: HashMap<winit::window::WindowId, SharedWindowState>,
    windows: HashMap<u64, Window>,
    window_id_by_winit_id: HashMap<winit::window::WindowId, u64>,
    pending_close_window_ids: Vec<u64>,
}

impl DesktopHostApplication {
    fn push_event(&mut self, event: DesktopHostEvent) {
        match event.kind {
            EVENT_RESIZED | EVENT_FOCUS_CHANGED | EVENT_POINTER_MOVED => {
                if let Some(existing_event) = self.events.iter_mut().rev().find(|existing_event| {
                    existing_event.window_id == event.window_id && existing_event.kind == event.kind
                }) {
                    *existing_event = event;
                    return;
                }
            }
            EVENT_FRAME => {
                if self.events.iter().rev().any(|existing_event| {
                    existing_event.window_id == event.window_id
                        && existing_event.kind == EVENT_FRAME
                }) {
                    return;
                }
            }
            _ => {}
        }

        self.events.push_back(event);
    }

    fn push_frame_event(&mut self, window_id: u64) {
        let elapsed = self.start_time.elapsed();
        self.push_event(DesktopHostEvent {
            kind: EVENT_FRAME,
            reserved: 0,
            window_id,
            arg0: elapsed.as_micros() as i64,
            arg1: 0,
            arg2: 0,
            arg3: 0,
        });
    }
}

struct HostRuntime {
    event_loop: EventLoop<()>,
    app: DesktopHostApplication,
    next_window_id: u64,
}

thread_local! {
    static HOST_RUNTIME: RefCell<Option<HostRuntime>> = const { RefCell::new(None) };
    #[cfg(target_os = "windows")]
    static WINDOW_BACKGROUND_BRUSHES: RefCell<HashMap<isize, HBRUSH>> = RefCell::new(HashMap::new());
    #[cfg(target_os = "windows")]
    static ORIGINAL_WND_PROCS: RefCell<HashMap<isize, isize>> = RefCell::new(HashMap::new());
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn background_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_ERASEBKGND {
        let handled = WINDOW_BACKGROUND_BRUSHES.with(|background_brushes| {
            let brush = background_brushes
                .borrow()
                .get(&(hwnd as isize))
                .copied()
                .unwrap_or(std::ptr::null_mut());
            if brush.is_null() {
                return false;
            }
            let mut rect = RECT::default();
            if unsafe { GetClientRect(hwnd, &mut rect) } == 0 {
                return false;
            }

            let hdc = wparam as *mut core::ffi::c_void;
            if hdc.is_null() {
                return false;
            }

            unsafe {
                FillRect(hdc, &rect, brush);
            }
            true
        });
        if handled {
            return 1;
        }
    }

    let original_proc = ORIGINAL_WND_PROCS.with(|original_wnd_procs| {
        original_wnd_procs
            .borrow()
            .get(&(hwnd as isize))
            .copied()
            .unwrap_or(0)
    });
    if original_proc != 0 {
        return unsafe {
            CallWindowProcW(
                Some(std::mem::transmute::<
                    isize,
                    unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
                >(original_proc)),
                hwnd,
                message,
                wparam,
                lparam,
            )
        };
    }

    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

fn read_utf8(bytes: *const c_char, length: usize) -> Option<String> {
    if bytes.is_null() {
        return None;
    }

    let slice = unsafe { std::slice::from_raw_parts(bytes as *const u8, length) };
    String::from_utf8(slice.to_vec()).ok()
}

fn with_runtime<T>(callback: impl FnOnce(&HostRuntime) -> T) -> Option<T> {
    HOST_RUNTIME.with(|runtime| runtime.borrow().as_ref().map(callback))
}

fn with_runtime_mut<T>(callback: impl FnOnce(&mut HostRuntime) -> T) -> Option<T> {
    HOST_RUNTIME.with(|runtime| runtime.borrow_mut().as_mut().map(callback))
}

fn destroy_window_in_runtime(runtime: &mut HostRuntime, window_id: u64, retain_close_event: bool) {
    let Some(window) = runtime.app.windows.remove(&window_id) else {
        return;
    };
    let winit_window_id = window.id();
    runtime.app.window_states.remove(&winit_window_id);
    runtime.app.window_id_by_winit_id.remove(&winit_window_id);
    runtime
        .app
        .pending_close_window_ids
        .retain(|pending_window_id| *pending_window_id != window_id);
    #[cfg(target_os = "windows")]
    {
        destroy_window_background(&window);
    }
    runtime.app.events.retain(|event| {
        if retain_close_event {
            event.kind == EVENT_CLOSE_REQUESTED || event.window_id != window_id
        } else {
            event.window_id != window_id
        }
    });
}

fn resolve_surface_info(
    window: &Window,
    window_id: u64,
    width: u32,
    height: u32,
) -> Option<SharedWindowState> {
    let scale_factor = window.scale_factor();
    let inner_size = window.inner_size();
    let raw_window = window.window_handle().ok()?.as_raw();
    let raw_display = window.display_handle().ok()?.as_raw();

    match (raw_window, raw_display) {
        (RawWindowHandle::Win32(handle), RawDisplayHandle::Windows(_)) => Some(SharedWindowState {
            id: window_id,
            width,
            height,
            focused: true,
            surface_info: DesktopWindowSurfaceInfo {
                system: SYSTEM_WIN32,
                reserved: 0,
                window_handle: handle.hwnd.get() as u64,
                display_handle: handle
                    .hinstance
                    .map(|value| value.get() as u64)
                    .unwrap_or(0),
                width: inner_size.width,
                height: inner_size.height,
                scale_factor,
            },
        }),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn install_window_background(window: &Window, rgba: u32) -> (Option<HBRUSH>, Option<isize>) {
    let raw_window = match window.window_handle().ok().map(|value| value.as_raw()) {
        Some(raw_handle) => raw_handle,
        None => return (None, None),
    };
    let RawWindowHandle::Win32(handle) = raw_window else {
        return (None, None);
    };

    let hwnd = handle.hwnd.get() as HWND;
    if hwnd.is_null() {
        return (None, None);
    }

    let red = (rgba & 0xff) as u8;
    let green = ((rgba >> 8) & 0xff) as u8;
    let blue = ((rgba >> 16) & 0xff) as u8;
    let color_ref = (red as u32) | ((green as u32) << 8) | ((blue as u32) << 16);

    let brush = unsafe { CreateSolidBrush(color_ref) };
    if brush.is_null() {
        return (None, None);
    }

    let original_proc = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            background_window_proc as *const () as isize,
        )
    };
    WINDOW_BACKGROUND_BRUSHES.with(|background_brushes| {
        background_brushes.borrow_mut().insert(hwnd as isize, brush);
    });
    ORIGINAL_WND_PROCS.with(|stored_original_procs| {
        stored_original_procs
            .borrow_mut()
            .insert(hwnd as isize, original_proc);
    });
    (Some(brush), if original_proc == 0 { None } else { Some(original_proc) })
}

#[cfg(not(target_os = "windows"))]
fn install_window_background(_window: &Window, _rgba: u32) -> (Option<()>, Option<()>) {
    (None, None)
}

#[cfg(target_os = "windows")]
fn destroy_window_background(window: &Window) {
    let raw_window = match window.window_handle().ok().map(|value| value.as_raw()) {
        Some(raw_handle) => raw_handle,
        None => return,
    };
    let RawWindowHandle::Win32(handle) = raw_window else {
        return;
    };
    let hwnd = handle.hwnd.get() as isize;
    let brush = WINDOW_BACKGROUND_BRUSHES.with(|background_brushes| {
        background_brushes.borrow_mut().remove(&hwnd)
    });
    if let Some(brush) = brush.filter(|brush| !brush.is_null()) {
        unsafe {
            DeleteObject(brush);
        }
    }
    ORIGINAL_WND_PROCS.with(|original_wnd_procs| {
        original_wnd_procs.borrow_mut().remove(&hwnd);
    });
}

fn to_desktop_key_code(physical_key: &PhysicalKey) -> i64 {
    match physical_key {
        PhysicalKey::Code(KeyCode::KeyA) => 65,
        PhysicalKey::Code(KeyCode::KeyB) => 66,
        PhysicalKey::Code(KeyCode::KeyC) => 67,
        PhysicalKey::Code(KeyCode::KeyD) => 68,
        PhysicalKey::Code(KeyCode::KeyE) => 69,
        PhysicalKey::Code(KeyCode::KeyF) => 70,
        PhysicalKey::Code(KeyCode::KeyG) => 71,
        PhysicalKey::Code(KeyCode::KeyH) => 72,
        PhysicalKey::Code(KeyCode::KeyI) => 73,
        PhysicalKey::Code(KeyCode::KeyJ) => 74,
        PhysicalKey::Code(KeyCode::KeyK) => 75,
        PhysicalKey::Code(KeyCode::KeyL) => 76,
        PhysicalKey::Code(KeyCode::KeyM) => 77,
        PhysicalKey::Code(KeyCode::KeyN) => 78,
        PhysicalKey::Code(KeyCode::KeyO) => 79,
        PhysicalKey::Code(KeyCode::KeyP) => 80,
        PhysicalKey::Code(KeyCode::KeyQ) => 81,
        PhysicalKey::Code(KeyCode::KeyR) => 82,
        PhysicalKey::Code(KeyCode::KeyS) => 83,
        PhysicalKey::Code(KeyCode::KeyT) => 84,
        PhysicalKey::Code(KeyCode::KeyU) => 85,
        PhysicalKey::Code(KeyCode::KeyV) => 86,
        PhysicalKey::Code(KeyCode::KeyW) => 87,
        PhysicalKey::Code(KeyCode::KeyX) => 88,
        PhysicalKey::Code(KeyCode::KeyY) => 89,
        PhysicalKey::Code(KeyCode::KeyZ) => 90,
        PhysicalKey::Code(KeyCode::Digit0) => 48,
        PhysicalKey::Code(KeyCode::Digit1) => 49,
        PhysicalKey::Code(KeyCode::Digit2) => 50,
        PhysicalKey::Code(KeyCode::Digit3) => 51,
        PhysicalKey::Code(KeyCode::Digit4) => 52,
        PhysicalKey::Code(KeyCode::Digit5) => 53,
        PhysicalKey::Code(KeyCode::Digit6) => 54,
        PhysicalKey::Code(KeyCode::Digit7) => 55,
        PhysicalKey::Code(KeyCode::Digit8) => 56,
        PhysicalKey::Code(KeyCode::Digit9) => 57,
        PhysicalKey::Code(KeyCode::Space) => 32,
        PhysicalKey::Code(KeyCode::Enter) => 13,
        PhysicalKey::Code(KeyCode::Escape) => 27,
        PhysicalKey::Code(KeyCode::Tab) => 9,
        PhysicalKey::Code(KeyCode::Backspace) => 8,
        PhysicalKey::Code(KeyCode::ArrowLeft) => 37,
        PhysicalKey::Code(KeyCode::ArrowUp) => 38,
        PhysicalKey::Code(KeyCode::ArrowRight) => 39,
        PhysicalKey::Code(KeyCode::ArrowDown) => 40,
        PhysicalKey::Unidentified(_) => -1,
        PhysicalKey::Code(code) => *code as i64,
    }
}

impl ApplicationHandler for DesktopHostApplication {
    fn resumed(&mut self, _event_loop: &winit::event_loop::ActiveEventLoop) {}

    fn window_event(
        &mut self,
        event_loop: &winit::event_loop::ActiveEventLoop,
        window_id: winit::window::WindowId,
        event: WindowEvent,
    ) {
        let Some(host_window_id) = self.window_id_by_winit_id.get(&window_id).copied() else {
            return;
        };
        let Some(mut state) = self.window_states.get(&window_id).copied() else {
            return;
        };

        match event {
            WindowEvent::CloseRequested => {
                self.pending_close_window_ids.push(state.id);
                if let Some(window) = self.windows.get(&host_window_id) {
                    window.set_visible(false);
                }
                self.push_event(DesktopHostEvent {
                    kind: EVENT_CLOSE_REQUESTED,
                    reserved: 0,
                    window_id: state.id,
                    arg0: 0,
                    arg1: 0,
                    arg2: 0,
                    arg3: 0,
                });
            }
            WindowEvent::RedrawRequested => {
                self.push_frame_event(state.id);
            }
            WindowEvent::Resized(size) => {
                let logical_size = size.to_logical::<f64>(state.surface_info.scale_factor);
                state.width = logical_size.width.round().max(1.0) as u32;
                state.height = logical_size.height.round().max(1.0) as u32;
                state.surface_info.width = size.width;
                state.surface_info.height = size.height;
                self.window_states.insert(window_id, state);
                self.push_event(DesktopHostEvent {
                    kind: EVENT_RESIZED,
                    reserved: 0,
                    window_id: state.id,
                    arg0: state.width as i64,
                    arg1: state.height as i64,
                    arg2: 0,
                    arg3: 0,
                });
                self.push_frame_event(state.id);
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                state.surface_info.scale_factor = scale_factor;
                self.window_states.insert(window_id, state);
                self.push_event(DesktopHostEvent {
                    kind: EVENT_SCALE_FACTOR_CHANGED,
                    reserved: 0,
                    window_id: state.id,
                    arg0: (scale_factor * 1000.0).round() as i64,
                    arg1: 0,
                    arg2: 0,
                    arg3: 0,
                });
                self.push_frame_event(state.id);
            }
            WindowEvent::Moved(_) => {
                self.window_states.insert(window_id, state);
                self.push_frame_event(state.id);
            }
            WindowEvent::Focused(focused) => {
                state.focused = focused;
                self.window_states.insert(window_id, state);
                self.push_event(DesktopHostEvent {
                    kind: EVENT_FOCUS_CHANGED,
                    reserved: 0,
                    window_id: state.id,
                    arg0: focused as i64,
                    arg1: 0,
                    arg2: 0,
                    arg3: 0,
                });
            }
            WindowEvent::CursorMoved { position, .. } => self.push_event(DesktopHostEvent {
                kind: EVENT_POINTER_MOVED,
                reserved: 0,
                window_id: state.id,
                arg0: position.x.round() as i64,
                arg1: position.y.round() as i64,
                arg2: 0,
                arg3: 0,
            }),
            WindowEvent::MouseInput {
                state: button_state,
                button,
                ..
            } => {
                let button_code = match button {
                    MouseButton::Left => 1,
                    MouseButton::Right => 2,
                    MouseButton::Middle => 3,
                    MouseButton::Back => 4,
                    MouseButton::Forward => 5,
                    MouseButton::Other(code) => code as i64,
                };
                self.push_event(DesktopHostEvent {
                    kind: EVENT_POINTER_BUTTON,
                    reserved: 0,
                    window_id: state.id,
                    arg0: button_code,
                    arg1: matches!(button_state, ElementState::Pressed) as i64,
                    arg2: 0,
                    arg3: 0,
                });
            }
            WindowEvent::KeyboardInput { event, .. } => {
                let key_code = to_desktop_key_code(&event.physical_key);
                self.push_event(DesktopHostEvent {
                    kind: EVENT_KEYBOARD,
                    reserved: 0,
                    window_id: state.id,
                    arg0: key_code,
                    arg1: matches!(event.state, ElementState::Pressed) as i64,
                    arg2: 0,
                    arg3: 0,
                });
            }
            _ => {}
        }

        let _ = event_loop;
    }
}

#[no_mangle]
pub extern "C" fn desktop_host_init() -> u8 {
    HOST_RUNTIME.with(|runtime| {
        if runtime.borrow().is_some() {
            return HOST_INIT_OK;
        }

        let event_loop = match EventLoop::new() {
            Ok(event_loop) => event_loop,
            Err(_) => return 0,
        };

        *runtime.borrow_mut() = Some(HostRuntime {
            event_loop,
            app: DesktopHostApplication {
                start_time: Instant::now(),
                events: VecDeque::new(),
                window_states: HashMap::new(),
                windows: HashMap::new(),
                window_id_by_winit_id: HashMap::new(),
                pending_close_window_ids: Vec::new(),
            },
            next_window_id: 1,
        });
        HOST_INIT_OK
    })
}

#[no_mangle]
pub extern "C" fn desktop_host_shutdown() {
    HOST_RUNTIME.with(|runtime| {
        #[cfg(target_os = "windows")]
        if let Some(runtime) = runtime.borrow_mut().as_mut() {
            for window in runtime.app.windows.values() {
                destroy_window_background(window);
            }
        }
        runtime.borrow_mut().take();
    });
}

#[no_mangle]
pub extern "C" fn desktop_host_create_window(
    title: *const c_char,
    title_len: usize,
    width: u32,
    height: u32,
    background_color_rgba: u32,
) -> u64 {
    let Some(window_title) = read_utf8(title, title_len) else {
        return 0;
    };

    with_runtime_mut(|runtime| {
        let window_id = runtime.next_window_id;
        runtime.next_window_id += 1;
        let attributes: WindowAttributes = Window::default_attributes()
            .with_title(window_title)
            .with_inner_size(LogicalSize::new(width as f64, height as f64))
            .with_visible(false);

        #[allow(deprecated)]
        let window = match runtime.event_loop.create_window(attributes) {
            Ok(window) => window,
            Err(_) => return 0,
        };

        #[cfg(target_os = "windows")]
        if background_color_rgba != 0 {
            let _ = install_window_background(&window, background_color_rgba);
        }

        let Some(shared_window_state) = resolve_surface_info(&window, window_id, width, height)
        else {
            return 0;
        };

        let winit_window_id = window.id();
        runtime
            .app
            .window_id_by_winit_id
            .insert(winit_window_id, window_id);
        runtime.app.window_states.insert(winit_window_id, shared_window_state);
        runtime.app.windows.insert(window_id, window);
        window_id
    })
    .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn desktop_host_show_window(window_id: u64) -> u8 {
    with_runtime_mut(|runtime| {
        if let Some(window) = runtime.app.windows.get(&window_id) {
            window.set_visible(true);
            window.request_redraw();
            HOST_RESULT_OK
        } else {
            0
        }
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_destroy_window(window_id: u64) -> u8 {
    with_runtime_mut(|runtime| {
        destroy_window_in_runtime(runtime, window_id, false);
        HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_request_redraw(window_id: u64) -> u8 {
    with_runtime_mut(|runtime| {
        if let Some(window) = runtime.app.windows.get(&window_id) {
            window.request_redraw();
            HOST_RESULT_OK
        } else {
            0
        }
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_poll_events(timeout_ms: u32) -> u32 {
    with_runtime_mut(|runtime| {
        let timeout = Some(Duration::from_millis(timeout_ms as u64));
        let status = runtime
            .event_loop
            .pump_app_events(timeout, &mut runtime.app);
        if matches!(status, PumpStatus::Exit(_)) {
            let window_ids: Vec<u64> = runtime.app.windows.keys().copied().collect();
            for window_id in window_ids {
                destroy_window_in_runtime(runtime, window_id, false);
            }
        }
        if !runtime.app.pending_close_window_ids.is_empty() {
            let pending_window_ids = std::mem::take(&mut runtime.app.pending_close_window_ids);
            for window_id in pending_window_ids {
                destroy_window_in_runtime(runtime, window_id, true);
            }
        }
        runtime.app.events.len() as u32
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_next_event(out_event: *mut DesktopHostEvent) -> u8 {
    if out_event.is_null() {
        return 0;
    }

    with_runtime_mut(|runtime| {
        let Some(event) = runtime.app.events.pop_front() else {
            return 0;
        };
        unsafe {
            *out_event = event;
        }
        HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_get_window_surface_info(
    window_id: u64,
    out_info: *mut DesktopWindowSurfaceInfo,
) -> u8 {
    if out_info.is_null() {
        return 0;
    }

    with_runtime(|runtime| {
        let Some(window_state) = runtime
            .app
            .window_states
            .values()
            .find(|window_state| window_state.id == window_id)
            .copied()
        else {
            return 0;
        };
        unsafe {
            *out_info = window_state.surface_info;
        }
        HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_get_window_state(
    window_id: u64,
    out_state: *mut DesktopWindowState,
) -> u8 {
    if out_state.is_null() {
        return 0;
    }

    with_runtime(|runtime| {
        let Some(window_state) = runtime
            .app
            .window_states
            .values()
            .find(|window_state| window_state.id == window_id)
            .copied()
        else {
            return 0;
        };

        unsafe {
            *out_state = DesktopWindowState {
                width: window_state.width,
                height: window_state.height,
                focused: window_state.focused as u32,
                reserved: 0,
            };
        }
        HOST_RESULT_OK
    })
    .unwrap_or_default()
}
