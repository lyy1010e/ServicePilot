use super::*;

pub(crate) fn file_path_to_string(file_path: FilePath) -> Option<String> {
    file_path_to_path(file_path).map(|path| path.to_string_lossy().to_string())
}

pub(crate) fn file_path_to_path(file_path: FilePath) -> Option<PathBuf> {
    file_path.into_path().ok()
}

pub(crate) fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn decode_process_line(bytes: &[u8]) -> String {
    let bytes = trim_line_end(bytes);
    decode_process_output(bytes)
}

pub(crate) fn decode_process_output(bytes: &[u8]) -> String {
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    decode_platform_ansi(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).to_string())
}

pub(crate) fn classpath_preparation_failed_message() -> String {
    "Failed to prepare Java classpath. See service logs for details.".to_string()
}

pub(crate) fn trim_line_end(mut bytes: &[u8]) -> &[u8] {
    if bytes.ends_with(b"\n") {
        bytes = &bytes[..bytes.len() - 1];
    }
    if bytes.ends_with(b"\r") {
        bytes = &bytes[..bytes.len() - 1];
    }
    bytes
}

#[cfg(windows)]
pub(crate) fn decode_platform_ansi(bytes: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::{MultiByteToWideChar, CP_ACP};

    if bytes.is_empty() {
        return Some(String::new());
    }

    let input_len = i32::try_from(bytes.len()).ok()?;
    let required = unsafe {
        MultiByteToWideChar(
            CP_ACP,
            0,
            bytes.as_ptr(),
            input_len,
            std::ptr::null_mut(),
            0,
        )
    };
    if required <= 0 {
        return None;
    }

    let mut wide = vec![0u16; required as usize];
    let written = unsafe {
        MultiByteToWideChar(
            CP_ACP,
            0,
            bytes.as_ptr(),
            input_len,
            wide.as_mut_ptr(),
            required,
        )
    };
    if written <= 0 {
        return None;
    }

    Some(String::from_utf16_lossy(&wide[..written as usize]))
}

#[cfg(not(windows))]
pub(crate) fn decode_platform_ansi(_bytes: &[u8]) -> Option<String> {
    None
}

pub(crate) fn compute_elapsed_seconds(started_at: &str) -> Option<u64> {
    let started = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
    let elapsed = Utc::now().signed_duration_since(started.with_timezone(&Utc));
    Some(elapsed.num_seconds().max(0) as u64)
}

pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn default_settings() -> AppSettings {
    AppSettings {
        language: AppLanguage::ZhCn,
        maven_settings_file: String::new(),
        maven_local_repository: String::new(),
        clear_logs_on_restart: true,
    }
}

pub(crate) fn default_true() -> bool {
    true
}
