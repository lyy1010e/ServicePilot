use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, Window, WindowEvent, Wry, RESTART_EXIT_CODE,
};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::{
    fs,
    io::{AsyncBufRead, AsyncBufReadExt, BufReader},
    process::Command,
    sync::Mutex,
    time::{sleep, Duration},
};

mod app;
mod commands;
mod common;
mod frontend_support;
mod groups;
mod idea_support;
mod log_parsing;
mod logs;
mod models;
mod runtime;
mod runtime_support;
mod service_detection;
mod services;
mod settings;
mod store;
#[cfg(test)]
mod tests;

pub use app::run;
use app::show_main_window;
use common::*;
use frontend_support::*;
use idea_support::*;
use log_parsing::*;
use models::*;
use runtime_support::*;

const DATA_FILE: &str = "service-pilot-state.json";
const RESUME_FILE: &str = "service-pilot-resume.json";
const MAX_LOG_ENTRIES: usize = 500;
const MAX_LOG_ENTRY_BYTES: usize = 16 * 1024;
const MAX_LOG_EVENT_ENTRIES: usize = 50;
const MAX_TOTAL_LOG_BYTES: usize = 64 * 1024 * 1024;
const LOG_HISTORY_TRIM_TARGET_BYTES: usize = MAX_TOTAL_LOG_BYTES - 1024 * 1024;
const LOG_EVENT_DEBOUNCE: Duration = Duration::from_millis(100);
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_millis(500);
const HEALTH_CHECK_FAILURE_THRESHOLD: u8 = 3;
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_QUIT_ID: &str = "tray-quit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
