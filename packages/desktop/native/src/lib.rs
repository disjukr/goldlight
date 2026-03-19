use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::ffi::c_char;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::EventLoop;
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowAttributes};

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
}

struct HostRuntime {
    event_loop: EventLoop<()>,
    app: DesktopHostApplication,
    next_window_id: u64,
}

thread_local! {
    static HOST_RUNTIME: RefCell<Option<HostRuntime>> = const { RefCell::new(None) };
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
                let elapsed = self.start_time.elapsed();
                self.push_event(DesktopHostEvent {
                    kind: EVENT_FRAME,
                    reserved: 0,
                    window_id: state.id,
                    arg0: elapsed.as_micros() as i64,
                    arg1: 0,
                    arg2: 0,
                    arg3: 0,
                });
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
                let key_code = match event.physical_key {
                    winit::keyboard::PhysicalKey::Code(code) => code as i64,
                    winit::keyboard::PhysicalKey::Unidentified(_) => -1,
                };
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
            },
            next_window_id: 1,
        });
        HOST_INIT_OK
    })
}

#[no_mangle]
pub extern "C" fn desktop_host_shutdown() {
    HOST_RUNTIME.with(|runtime| {
        runtime.borrow_mut().take();
    });
}

#[no_mangle]
pub extern "C" fn desktop_host_create_window(
    title: *const c_char,
    title_len: usize,
    width: u32,
    height: u32,
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
            .with_inner_size(LogicalSize::new(width as f64, height as f64));

        #[allow(deprecated)]
        let window = match runtime.event_loop.create_window(attributes) {
            Ok(window) => window,
            Err(_) => return 0,
        };

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
