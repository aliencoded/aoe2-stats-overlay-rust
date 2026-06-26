#[cfg(windows)]
use once_cell::sync::Lazy;
#[cfg(windows)]
use regex::Regex;

#[cfg(windows)]
static GAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)AoE2DE_s\.exe|Age.*Empires.*II|aoe2de").unwrap());

pub struct ActiveWin {
    pub pid: u32,
    pub title: Option<String>,
    pub process_name: Option<String>,
}

#[cfg(windows)]
pub fn active_window_info() -> ActiveWin {
    use windows::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows::Win32::System::ProcessStatus::GetModuleBaseNameW;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return ActiveWin { pid: 0, title: None, process_name: None };
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));

        let len = GetWindowTextLengthW(hwnd);
        let title = if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let n = GetWindowTextW(hwnd, &mut buf);
            Some(String::from_utf16_lossy(&buf[..n as usize]))
        } else {
            None
        };

        let process_name = if pid != 0 {
            let handle = OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                false,
                pid,
            );
            if let Ok(h) = handle {
                let mut buf = vec![0u16; MAX_PATH as usize];
                let n = GetModuleBaseNameW(h, None, &mut buf);
                let _ = CloseHandle(h);
                if n > 0 {
                    Some(String::from_utf16_lossy(&buf[..n as usize]))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        ActiveWin { pid, title, process_name }
    }
}

#[cfg(not(windows))]
pub fn active_window_info() -> ActiveWin {
    ActiveWin { pid: 0, title: None, process_name: None }
}

#[cfg(windows)]
pub fn is_game(proc_name: &str, title: &str) -> bool {
    GAME_RE.is_match(proc_name) || GAME_RE.is_match(title)
}

#[cfg(not(windows))]
pub fn is_game(_p: &str, _t: &str) -> bool { false }

// Re-pin a window to the top of the topmost z-band WITHOUT activating it. A
// fullscreen/borderless game keeps calling SetWindowPos(HWND_TOPMOST) on itself
// when it has focus, which buries any other topmost window (our overlay). Just
// setting always_on_top once at boot isn't enough — we must re-assert while the
// game is foreground. SWP_NOACTIVATE is critical: it re-raises the overlay
// without stealing focus from the game (no alt-tab flicker).
#[cfg(windows)]
pub fn reassert_topmost(hwnd: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
    };
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd as *mut core::ffi::c_void),
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
        );
    }
}

#[cfg(not(windows))]
pub fn reassert_topmost(_hwnd: isize) {}
