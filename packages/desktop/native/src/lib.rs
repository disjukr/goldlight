use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
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
    window_state: Option<SharedWindowState>,
    window: Option<Window>,
    pending_close_window_id: Option<u64>,
    #[cfg(target_os = "windows")]
    background_brush: Option<HBRUSH>,
    #[cfg(target_os = "windows")]
    original_wnd_proc: Option<isize>,
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
    static WINDOW_BACKGROUND_BRUSH: Cell<HBRUSH> = const { Cell::new(std::ptr::null_mut()) };
    #[cfg(target_os = "windows")]
    static ORIGINAL_WND_PROC: Cell<isize> = const { Cell::new(0) };
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn background_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_ERASEBKGND {
        let handled = WINDOW_BACKGROUND_BRUSH.with(|background_brush| {
            let brush = background_brush.get();
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

    let original_proc = ORIGINAL_WND_PROC.with(|original_wnd_proc| original_wnd_proc.get());
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

fn resolve_surface_info(
    window: &Window,
    window_id: u64,
    width: u32,
    height: u32,
) -> Option<SharedWindowState> {
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
                width,
                height,
                scale_factor: window.scale_factor(),
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
    WINDOW_BACKGROUND_BRUSH.with(|background_brush| background_brush.set(brush));
    ORIGINAL_WND_PROC.with(|stored_original_proc| stored_original_proc.set(original_proc));
    (Some(brush), if original_proc == 0 { None } else { Some(original_proc) })
}

#[cfg(not(target_os = "windows"))]
fn install_window_background(_window: &Window, _rgba: u32) -> (Option<()>, Option<()>) {
    (None, None)
}

#[cfg(target_os = "windows")]
fn destroy_background_brush(brush: HBRUSH) {
    if !brush.is_null() {
        unsafe {
            DeleteObject(brush);
        }
    }
    WINDOW_BACKGROUND_BRUSH.with(|background_brush| background_brush.set(std::ptr::null_mut()));
    ORIGINAL_WND_PROC.with(|original_wnd_proc| original_wnd_proc.set(0));
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
        _window_id: winit::window::WindowId,
        event: WindowEvent,
    ) {
        let Some(mut state) = self.window_state else {
            return;
        };

        match event {
            WindowEvent::CloseRequested => {
                self.pending_close_window_id = Some(state.id);
                if let Some(window) = self.window.as_ref() {
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
                event_loop.exit();
            }
            WindowEvent::RedrawRequested => {
                self.push_frame_event(state.id);
            }
            WindowEvent::Resized(size) => {
                state.width = size.width;
                state.height = size.height;
                state.surface_info.width = size.width;
                state.surface_info.height = size.height;
                self.window_state = Some(state);
                self.push_event(DesktopHostEvent {
                    kind: EVENT_RESIZED,
                    reserved: 0,
                    window_id: state.id,
                    arg0: size.width as i64,
                    arg1: size.height as i64,
                    arg2: 0,
                    arg3: 0,
                });
                self.push_frame_event(state.id);
            }
            WindowEvent::Moved(_) => {
                self.window_state = Some(state);
                self.push_frame_event(state.id);
            }
            WindowEvent::Focused(focused) => {
                state.focused = focused;
                self.window_state = Some(state);
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
                window_state: None,
                window: None,
                pending_close_window_id: None,
                #[cfg(target_os = "windows")]
                background_brush: None,
                #[cfg(target_os = "windows")]
                original_wnd_proc: None,
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
            if let Some(brush) = runtime.app.background_brush.take() {
                destroy_background_brush(brush);
            }
            runtime.app.original_wnd_proc = None;
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
        if runtime.app.window.is_some() {
            return 0;
        }

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
            let (brush, original_wnd_proc) =
                install_window_background(&window, background_color_rgba);
            runtime.app.background_brush = brush;
            runtime.app.original_wnd_proc = original_wnd_proc;
        }

        let Some(shared_window_state) = resolve_surface_info(&window, window_id, width, height)
        else {
            return 0;
        };

        runtime.app.window_state = Some(shared_window_state);
        runtime.app.window = Some(window);
        window_id
    })
    .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn desktop_host_show_window(window_id: u64) -> u8 {
    with_runtime_mut(|runtime| {
        if runtime.app.window_state.map(|entry| entry.id) != Some(window_id) {
            return 0;
        }

        if let Some(window) = runtime.app.window.as_ref() {
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
        let current_id = runtime.app.window_state.map(|entry| entry.id);
        if current_id != Some(window_id) {
            return if current_id.is_none() {
                HOST_RESULT_OK
            } else {
                0
            };
        }

        runtime.app.window = None;
        runtime.app.window_state = None;
        runtime.app.pending_close_window_id = None;
        #[cfg(target_os = "windows")]
        {
            if let Some(brush) = runtime.app.background_brush.take() {
                destroy_background_brush(brush);
            }
            runtime.app.original_wnd_proc = None;
        }
        runtime
            .app
            .events
            .retain(|event| event.window_id != window_id);
        HOST_RESULT_OK
    })
    .unwrap_or_default()
}

#[no_mangle]
pub extern "C" fn desktop_host_request_redraw(window_id: u64) -> u8 {
    with_runtime_mut(|runtime| {
        if runtime.app.window_state.map(|entry| entry.id) != Some(window_id) {
            return 0;
        }

        if let Some(window) = runtime.app.window.as_ref() {
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
        if matches!(status, PumpStatus::Exit(_)) || runtime.app.pending_close_window_id.is_some() {
            let window_id = runtime.app.pending_close_window_id.take();
            runtime.app.window = None;
            runtime.app.window_state = None;
            #[cfg(target_os = "windows")]
            {
                if let Some(brush) = runtime.app.background_brush.take() {
                    destroy_background_brush(brush);
                }
                runtime.app.original_wnd_proc = None;
            }
            if let Some(window_id) = window_id {
                runtime.app.events.retain(|event| {
                    event.kind == EVENT_CLOSE_REQUESTED || event.window_id != window_id
                });
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
        let Some(window_state) = runtime.app.window_state else {
            return 0;
        };
        if window_state.id != window_id {
            return 0;
        }
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
        let Some(window_state) = runtime.app.window_state else {
            return 0;
        };
        if window_state.id != window_id {
            return 0;
        }

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
