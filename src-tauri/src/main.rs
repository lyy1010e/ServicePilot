#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  service_pilot_lib::run();
}
