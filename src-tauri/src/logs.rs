use super::*;

impl ServicePilotBackend {
    pub(crate) async fn get_log_history(&self, service_id: &str) -> BackendResult<Vec<LogEntry>> {
        let inner = self.inner.lock().await;
        if !inner
            .services
            .iter()
            .any(|service| service.id == service_id)
        {
            return Err("Service not found.".to_string());
        }
        Ok(inner
            .log_history
            .get(service_id)
            .cloned()
            .unwrap_or_default())
    }

    pub(crate) async fn clear_log_history(&self, service_id: &str) -> BackendResult<()> {
        {
            let mut inner = self.inner.lock().await;
            if !inner
                .services
                .iter()
                .any(|service| service.id == service_id)
            {
                return Err("Service not found.".to_string());
            }
            inner.remove_log_history(service_id);
            inner.pending_log_entries.remove(service_id);
            inner.pending_log_emits.remove(service_id);
        }
        self.emit_snapshot().await;
        Ok(())
    }

    pub(crate) async fn append_log(&self, service_id: &str, source: LogSource, raw_text: String) {
        let parts = raw_text
            .replace('\r', "")
            .split('\n')
            .map(str::trim_end)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();

        if parts.is_empty() {
            return;
        }

        for text in parts {
            let text = truncate_log_text(strip_ansi_sequences(&text));
            if text.is_empty() {
                continue;
            }
            let entry = LogEntry {
                id: new_id(),
                service_id: service_id.to_string(),
                timestamp: now_iso_string(),
                source: source.clone(),
                text: text.clone(),
            };

            let merged = {
                let mut inner = self.inner.lock().await;
                let merged = {
                    let history = inner.log_history.entry(service_id.to_string()).or_default();
                    if let Some(previous) = history.last_mut() {
                        if should_merge_log_line(previous, &entry) {
                            let previous_bytes = previous.text.len();
                            previous.text.push('\n');
                            previous.text.push_str(&entry.text);
                            trim_log_text(&mut previous.text);
                            Some((previous.clone(), previous_bytes, previous.text.len()))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some((_, previous_bytes, merged_bytes)) = &merged {
                    inner.log_history_bytes = inner
                        .log_history_bytes
                        .saturating_sub(*previous_bytes)
                        .saturating_add(*merged_bytes);
                    inner.trim_log_history(service_id);
                }
                merged.map(|(entry, _, _)| entry)
            };

            if let Some(merged) = merged {
                self.queue_log_event(merged).await;
                self.detect_access_info(service_id, &text).await;
                self.detect_failure_summary(service_id, &source, &text)
                    .await;
                continue;
            }

            {
                let mut inner = self.inner.lock().await;
                inner.log_history_bytes = inner.log_history_bytes.saturating_add(entry.text.len());
                inner
                    .log_history
                    .entry(service_id.to_string())
                    .or_default()
                    .push(entry.clone());
                inner.trim_log_history(service_id);
            }

            self.queue_log_event(entry.clone()).await;
            self.detect_access_info(service_id, &text).await;
            self.detect_failure_summary(service_id, &source, &text)
                .await;
        }
    }

    async fn append_log_entry(&self, service_id: &str, source: LogSource, text: String) {
        let text = truncate_log_text(strip_ansi_sequences(&text));
        if text.is_empty() {
            return;
        }
        let entry = LogEntry {
            id: new_id(),
            service_id: service_id.to_string(),
            timestamp: now_iso_string(),
            source,
            text,
        };

        {
            let mut inner = self.inner.lock().await;
            inner.log_history_bytes = inner.log_history_bytes.saturating_add(entry.text.len());
            inner
                .log_history
                .entry(service_id.to_string())
                .or_default()
                .push(entry.clone());
            inner.trim_log_history(service_id);
        }

        self.queue_log_event(entry).await;
    }

    async fn queue_log_event(&self, entry: LogEntry) {
        let service_id = entry.service_id.clone();
        let should_schedule = {
            let mut inner = self.inner.lock().await;
            let pending = inner.pending_log_entries.entry(service_id.clone()).or_default();
            if pending.last().is_some_and(|previous| previous.id == entry.id) {
                *pending.last_mut().expect("pending log entry exists") = entry;
            } else {
                pending.push(entry);
                if pending.len() > MAX_LOG_EVENT_ENTRIES {
                    let remove = pending.len() - MAX_LOG_EVENT_ENTRIES;
                    pending.drain(0..remove);
                }
            }
            inner.pending_log_emits.insert(service_id.clone())
        };

        if !should_schedule {
            return;
        }

        let backend = self.clone();
        tauri::async_runtime::spawn(async move {
            sleep(LOG_EVENT_DEBOUNCE).await;
            let entries = {
                let mut inner = backend.inner.lock().await;
                inner.pending_log_emits.remove(&service_id);
                inner.pending_log_entries.remove(&service_id).unwrap_or_default()
            };
            if !entries.is_empty() {
                let _ = backend.app.emit("log:batch", entries);
            }
        });
    }

    async fn detect_access_info(&self, service_id: &str, text: &str) {
        let mut notice = None;
        let mut changed = false;
        let detected_url = extract_url(text);
        let detected_port = extract_port(text);
        {
            let mut inner = self.inner.lock().await;
            let service_kind = inner
                .services
                .iter()
                .find(|service| service.id == service_id)
                .map(|service| service.service_kind.clone());
            let Some(runtime) = inner.runtime.get_mut(service_id) else {
                return;
            };

            if detected_url.is_some() && runtime.detected_url != detected_url {
                runtime.detected_url = detected_url.clone();
                changed = true;
            }

            if detected_port.is_some() && runtime.detected_port != detected_port {
                runtime.detected_port = detected_port;
                changed = true;
            }

            if let Some(service_kind) = service_kind {
                if is_spring_startup_access_signal(
                    &runtime.status,
                    &service_kind,
                    detected_url.as_deref(),
                    detected_port,
                ) {
                    runtime.status = RuntimeStatus::Running;
                    changed = true;
                }
            }

            if let Some(url) = detected_url {
                notice = Some(format!("Detected access URL: {url}"));
            } else if let Some(port) = detected_port {
                notice = Some(format!("Detected access URL: http://localhost:{port}"));
            }
        }

        if changed {
            self.emit_snapshot().await;
        }

        if let Some(message) = notice {
            self.append_system_notice_once(service_id, &message).await;
        }
    }

    async fn append_system_notice_once(&self, service_id: &str, text: &str) {
        let exists = {
            let inner = self.inner.lock().await;
            inner
                .log_history
                .get(service_id)
                .map(|entries| {
                    entries.iter().any(|entry| {
                        matches!(entry.source, LogSource::System) && entry.text == text
                    })
                })
                .unwrap_or(false)
        };
        if !exists {
            self.append_log_entry(service_id, LogSource::System, text.to_string())
                .await;
        }
    }

    async fn detect_failure_summary(&self, service_id: &str, source: &LogSource, text: &str) {
        if matches!(source, LogSource::System) {
            return;
        }

        let Some(summary) = extract_failure_summary(text) else {
            return;
        };

        let should_update = {
            let inner = self.inner.lock().await;
            let current = inner.runtime.get(service_id);
            let current_score = current
                .and_then(|item| item.failure_summary.clone())
                .map(|message| classify_failure_insight(&message).score)
                .unwrap_or(0);
            summary.score >= current_score
        };

        if !should_update {
            return;
        }

        {
            let mut inner = self.inner.lock().await;
            if let Some(runtime) = inner.runtime.get_mut(service_id) {
                runtime.failure_summary = Some(summary.summary);
                runtime.failure_category = Some(summary.category);
            }
        }
        self.emit_snapshot().await;
    }
}

fn truncate_log_text(mut text: String) -> String {
    trim_log_text(&mut text);
    text
}

fn trim_log_text(text: &mut String) {
    if text.len() <= MAX_LOG_ENTRY_BYTES {
        return;
    }

    let mut start = text.len() - MAX_LOG_ENTRY_BYTES;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    text.drain(..start);
}

impl BackendState {
    pub(crate) fn remove_log_history(&mut self, service_id: &str) {
        let BackendState {
            log_history,
            log_history_bytes,
            ..
        } = self;
        remove_log_history(log_history, log_history_bytes, service_id);
    }

    fn trim_log_history(&mut self, service_id: &str) {
        let BackendState {
            log_history,
            log_history_bytes,
            ..
        } = self;
        trim_log_history(log_history, log_history_bytes, service_id);
    }
}

fn remove_log_history(
    history: &mut HashMap<String, Vec<LogEntry>>,
    total_bytes: &mut usize,
    service_id: &str,
) {
    let removed_bytes = history
        .remove(service_id)
        .into_iter()
        .flatten()
        .map(|entry| entry.text.len())
        .sum::<usize>();
    *total_bytes = total_bytes.saturating_sub(removed_bytes);
}

fn trim_log_history(
    history: &mut HashMap<String, Vec<LogEntry>>,
    total_bytes: &mut usize,
    service_id: &str,
) {
    if let Some(entries) = history.get_mut(service_id) {
        if entries.len() > MAX_LOG_ENTRIES {
            let remove = entries.len() - MAX_LOG_ENTRIES;
            let removed_bytes = entries
                .drain(0..remove)
                .map(|entry| entry.text.len())
                .sum::<usize>();
            *total_bytes = total_bytes.saturating_sub(removed_bytes);
        }
    }

    if *total_bytes <= MAX_TOTAL_LOG_BYTES {
        return;
    }

    while *total_bytes > LOG_HISTORY_TRIM_TARGET_BYTES {
        let Some(service_id) = history
            .iter()
            .filter(|(_, entries)| !entries.is_empty())
            .min_by_key(|(_, entries)| &entries[0].timestamp)
            .map(|(service_id, _)| service_id.clone())
        else {
            break;
        };
        let removed = history
            .get_mut(&service_id)
            .and_then(|entries| (!entries.is_empty()).then(|| entries.remove(0)));
        let Some(entry) = removed else {
            break;
        };
        *total_bytes = total_bytes.saturating_sub(entry.text.len());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: usize, text: String) -> LogEntry {
        LogEntry {
            id: id.to_string(),
            service_id: "service-1".to_string(),
            timestamp: format!("2026-07-21T00:00:{id:02}.000Z"),
            source: LogSource::Stdout,
            text,
        }
    }

    #[test]
    fn trim_log_text_preserves_valid_utf8_at_the_size_limit() {
        let mut text = "中".repeat(MAX_LOG_ENTRY_BYTES);
        trim_log_text(&mut text);

        assert!(text.len() <= MAX_LOG_ENTRY_BYTES);
        assert!(text.is_char_boundary(0));
    }

    #[test]
    fn trim_log_history_keeps_only_the_recent_entries_per_service() {
        let mut history = HashMap::from([(
            "service-1".to_string(),
            (0..=MAX_LOG_ENTRIES)
                .map(|id| entry(id, "line".to_string()))
                .collect(),
        )]);
        let mut total_bytes = (MAX_LOG_ENTRIES + 1) * "line".len();

        trim_log_history(&mut history, &mut total_bytes, "service-1");

        let entries = history.get("service-1").expect("service history exists");
        assert_eq!(entries.len(), MAX_LOG_ENTRIES);
        assert_eq!(entries[0].id, "1");
        assert_eq!(total_bytes, MAX_LOG_ENTRIES * "line".len());
    }

    #[test]
    fn remove_log_history_updates_tracked_byte_count() {
        let mut history = HashMap::from([(
            "service-1".to_string(),
            vec![entry(1, "first".to_string()), entry(2, "second".to_string())],
        )]);
        let mut total_bytes = "first".len() + "second".len();

        remove_log_history(&mut history, &mut total_bytes, "service-1");

        assert!(history.is_empty());
        assert_eq!(total_bytes, 0);
    }
}
