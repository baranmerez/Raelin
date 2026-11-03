//! Who is on the other end of the pipe. The app locks its pipe to the current user; the
//! bridge checks the reverse, so it never hands the token or MCP traffic to a pipe that
//! another account created first under the predictable name.

use std::io;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, LocalFree};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// String SID ("S-1-5-21-…") of the user a process runs as.
///
/// # Safety
/// `process` must be a valid process handle with query access.
unsafe fn process_user_sid(process: HANDLE) -> io::Result<String> {
    // SAFETY: standard token query; every handle and buffer is checked and released
    // before returning.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut needed = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buffer = vec![0u8; needed as usize];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
        );
        CloseHandle(token);
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut text) == 0 {
            return Err(io::Error::last_os_error());
        }
        let len = (0..).take_while(|&i| *text.add(i) != 0).count();
        let sid = String::from_utf16_lossy(std::slice::from_raw_parts(text, len));
        LocalFree(text as _);
        Ok(sid)
    }
}

pub fn current_user_sid() -> io::Result<String> {
    // SAFETY: the pseudo handle of our own process is always valid.
    unsafe { process_user_sid(GetCurrentProcess()) }
}

/// Whether the process serving the connected pipe `pipe` runs as the current user.
/// Anything that cannot be checked counts as "no".
///
/// # Safety
/// `pipe` must be the handle of a connected named pipe client.
pub unsafe fn pipe_server_is_current_user(pipe: HANDLE) -> bool {
    // SAFETY: the caller guarantees `pipe`; the process handle is closed on every path.
    unsafe {
        let mut pid = 0u32;
        if GetNamedPipeServerProcessId(pipe, &mut pid) == 0 {
            return false;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let server = process_user_sid(process);
        CloseHandle(process);
        matches!((server, current_user_sid()), (Ok(a), Ok(b)) if a == b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_current_user_sid() {
        assert!(current_user_sid().unwrap().starts_with("S-1-"));
    }

    #[test]
    fn a_handle_that_is_not_a_pipe_is_rejected() {
        // SAFETY: an invalid handle only makes the API call fail.
        assert!(!unsafe { pipe_server_is_current_user(std::ptr::null_mut()) });
    }
}
