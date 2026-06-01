use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex as StdMutex,
    },
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
    io::{AsyncBufReadExt, BufReader},
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
const MAX_LOG_ENTRIES: usize = 2000;
const MAX_MERGE_TEXT_LENGTH: usize = 100 * 1024; // 100 KB
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_QUIT_ID: &str = "tray-quit";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
