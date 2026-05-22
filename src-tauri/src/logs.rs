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
            inner.log_history.remove(service_id);
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
            let text = strip_ansi_sequences(&text);
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

            {
                let mut inner = self.inner.lock().await;
                let history = inner.log_history.entry(service_id.to_string()).or_default();
                if let Some(previous) = history.last_mut() {
                    if should_merge_log_line(previous, &entry) {
                        previous.text.push('\n');
                        previous.text.push_str(&entry.text);
                        if previous.text.len() > MAX_MERGE_TEXT_LENGTH {
                            let excess = previous.text.len() - MAX_MERGE_TEXT_LENGTH;
                            previous.text.drain(..excess);
                        }
                        let merged = previous.clone();
                        drop(inner);
                        let _ = self.app.emit("log:entry", merged);
                        self.detect_access_info(service_id, &text).await;
                        self.detect_failure_summary(service_id, &source, &text)
                            .await;
                        continue;
                    }
                }
                history.push(entry.clone());
                if history.len() > MAX_LOG_ENTRIES {
                    let remove = history.len() - MAX_LOG_ENTRIES;
                    history.drain(0..remove);
                }
            }

            let _ = self.app.emit("log:entry", entry.clone());
            self.detect_access_info(service_id, &text).await;
            self.detect_failure_summary(service_id, &source, &text)
                .await;
        }
    }

    async fn append_log_entry(&self, service_id: &str, source: LogSource, text: String) {
        let text = strip_ansi_sequences(&text);
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
            let history = inner.log_history.entry(service_id.to_string()).or_default();
            history.push(entry.clone());
            if history.len() > MAX_LOG_ENTRIES {
                let remove = history.len() - MAX_LOG_ENTRIES;
                history.drain(0..remove);
            }
        }

        let _ = self.app.emit("log:entry", entry);
    }

    async fn detect_access_info(&self, service_id: &str, text: &str) {
        let mut notice = None;
        let mut changed = false;
        {
            let mut inner = self.inner.lock().await;
            let Some(runtime) = inner.runtime.get_mut(service_id) else {
                return;
            };

            let detected_url = extract_url(text);
            let detected_port = extract_port(text);

            if detected_url.is_some() && runtime.detected_url != detected_url {
                runtime.detected_url = detected_url.clone();
                changed = true;
            }

            if detected_port.is_some() && runtime.detected_port != detected_port {
                runtime.detected_port = detected_port;
                changed = true;
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
