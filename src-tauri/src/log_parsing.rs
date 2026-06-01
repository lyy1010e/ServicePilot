use super::*;

pub(crate) fn extract_url(text: &str) -> Option<String> {
    let cleaned = strip_ansi_sequences(text);
    if let Some(url) = extract_local_url(&cleaned) {
        return Some(url);
    }

    if !should_detect_url_from_line(&cleaned) {
        return None;
    }

    extract_local_url(&cleaned)
}

pub(crate) fn extract_local_url(text: &str) -> Option<String> {
    let prefixes = [
        "http://localhost:",
        "https://localhost:",
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://0.0.0.0:",
        "https://0.0.0.0:",
    ];
    let lower = text.to_ascii_lowercase();
    prefixes.iter().find_map(|prefix| {
        lower.find(prefix).map(|start| {
            text[start..]
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_end_matches(|ch: char| matches!(ch, '"' | '\'' | ',' | ';' | ')' | '/'))
                .to_string()
        })
    })
}

pub(crate) fn should_detect_url_from_line(text: &str) -> bool {
    let cleaned = strip_ansi_sequences(text);
    let trimmed = cleaned.trim();
    let lower = trimmed.to_ascii_lowercase();

    let allow_markers = [
        "tomcat started on port",
        "netty started on port",
        "started on port",
        "listening on 0.0.0.0 port",
        "listening on port",
        "local: http://",
        "local: https://",
        "access url",
        "available at",
        "open your browser",
    ];

    if allow_markers.iter().any(|marker| lower.contains(marker)) {
        return true;
    }

    let deny_markers = [
        "url:",
        "-url:",
        "_url:",
        "dataid:",
        "parse data from nacos error",
    ];

    if deny_markers.iter().any(|marker| lower.contains(marker)) {
        return false;
    }

    false
}

pub(crate) fn extract_port(text: &str) -> Option<u16> {
    let cleaned = strip_ansi_sequences(text);
    if let Some(port) = extract_port_from_local_url(&cleaned) {
        return Some(port);
    }

    if !should_detect_port_from_line(&cleaned) {
        return None;
    }

    let patterns = [
        "Tomcat started on port(s):",
        "Tomcat started on port ",
        "Netty started on port ",
        "started on port:",
        "started on port ",
        "Local: http://localhost:",
        "Local: https://localhost:",
        "listening on 0.0.0.0 port ",
        "listening on port ",
    ];

    for pattern in patterns {
        if let Some(index) = cleaned.find(pattern) {
            let remainder = &cleaned[index + pattern.len()..];
            let digits = remainder
                .chars()
                .skip_while(|char| !char.is_ascii_digit())
                .take_while(|char| char.is_ascii_digit())
                .collect::<String>();
            if let Ok(port) = digits.parse::<u16>() {
                if port > 0 {
                    return Some(port);
                }
            }
        }
    }
    None
}

pub(crate) fn extract_port_from_local_url(text: &str) -> Option<u16> {
    let prefixes = [
        "http://localhost:",
        "https://localhost:",
        "http://127.0.0.1:",
        "https://127.0.0.1:",
        "http://0.0.0.0:",
        "https://0.0.0.0:",
    ];

    let lower = text.to_ascii_lowercase();
    prefixes.iter().find_map(|prefix| {
        lower.find(prefix).and_then(|start| {
            let port_start = start + prefix.len();
            let digits = lower[port_start..]
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>();
            digits.parse::<u16>().ok().filter(|port| *port > 0)
        })
    })
}

pub(crate) fn extract_failure_summary(text: &str) -> Option<FailureInsight> {
    if text.contains("MalformedInputException") {
        return Some(FailureInsight {
      category: FailureCategory::Config,
      summary: "Nacos配置编码错误：请检查Nacos控制台中umsp-dev.yml、umsp.yml、share-module.yml等配置文件，确保使用UTF-8编码，无GBK/中文特殊字符".to_string(),
      score: 10,
    });
    }

    if text.contains("parse data from Nacos error") {
        return Some(FailureInsight {
            category: FailureCategory::Config,
            summary: "Nacos配置解析失败：请检查Nacos控制台中的YAML配置文件格式是否正确".to_string(),
            score: 9,
        });
    }

    if text.contains("Failed to determine a suitable driver class") {
        return Some(FailureInsight {
            category: FailureCategory::Config,
            summary: "Datasource configuration was not loaded successfully".to_string(),
            score: 7,
        });
    }

    if text.contains("Failed to configure a DataSource") {
        return Some(FailureInsight {
            category: FailureCategory::Config,
            summary: "Datasource configuration is missing or invalid".to_string(),
            score: 6,
        });
    }

    if !text.contains("[ERROR]") && !text.contains("BUILD FAILURE") {
        return None;
    }

    if text.contains("BUILD FAILURE") {
        return Some(FailureInsight {
            category: FailureCategory::Process,
            summary: "Build failure".to_string(),
            score: 1,
        });
    }

    let cleaned = text.trim_start_matches("[ERROR]").trim().to_string();
    if cleaned.is_empty()
        || cleaned.starts_with("To see the full stack trace")
        || cleaned.starts_with("Re-run Maven")
        || cleaned.starts_with("For more information")
        || cleaned.starts_with("[Help")
    {
        return None;
    }

    Some(classify_failure_insight(&cleaned))
}

pub(crate) fn classify_failure_insight(summary: &str) -> FailureInsight {
    let checks: &[(FailureCategory, u8, &[&str])] = &[
        (
            FailureCategory::Port,
            6,
            &[
                "Port ",
                "already in use",
                "Address already in use",
                "BindException",
                "Failed to bind",
            ],
        ),
        (
            FailureCategory::Plugin,
            6,
            &["No plugin found for prefix", "spring-boot-maven-plugin"],
        ),
        (
            FailureCategory::Dependency,
            6,
            &[
                "Could not resolve dependencies",
                "Failed to collect dependencies",
                "Failed to read artifact descriptor",
                "was not found",
                "Could not find artifact",
                "The POM for",
            ],
        ),
        (
            FailureCategory::Compile,
            6,
            &[
                "COMPILATION ERROR",
                "Compilation failure",
                "cannot find symbol",
                "package ",
            ],
        ),
        (
            FailureCategory::Config,
            5,
            &[
                "BeanCreationException",
                "ApplicationContextException",
                "UnsatisfiedDependencyException",
                "Failed to bind properties",
                "Invalid configuration",
                "Error creating bean",
            ],
        ),
    ];

    for (category, score, tokens) in checks {
        if tokens.iter().all(|token| summary.contains(token))
            || tokens.iter().any(|token| summary.contains(token))
        {
            return FailureInsight {
                category: category.clone(),
                summary: summary.to_string(),
                score: *score,
            };
        }
    }

    FailureInsight {
        category: FailureCategory::Unknown,
        summary: summary.to_string(),
        score: 3,
    }
}

pub(crate) fn should_merge_log_line(previous: &LogEntry, entry: &LogEntry) -> bool {
    if previous.service_id != entry.service_id || matches!(previous.source, LogSource::System) {
        return false;
    }
    if log_level(&previous.text, &previous.source) != "ERROR"
        && !matches!(previous.source, LogSource::Stderr)
    {
        return false;
    }

    let text = entry.text.trim_start();
    is_exception_start(text)
        || text.starts_with("at ")
        || text.starts_with("... ")
        || text.starts_with("Caused by:")
        || text.starts_with("Suppressed:")
}

pub(crate) fn strip_ansi_sequences(text: &str) -> String {
    let mut cleaned = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            cleaned.push(ch);
            continue;
        }

        match chars.peek().copied() {
            Some('[') => {
                chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            Some(']') => {
                chars.next();
                while let Some(next) = chars.next() {
                    if next == '\u{7}' {
                        break;
                    }
                    if next == '\u{1b}' && matches!(chars.peek(), Some('\\')) {
                        chars.next();
                        break;
                    }
                }
            }
            Some('@'..='Z') | Some('\\') | Some(']'..='_') => {
                chars.next();
            }
            _ => {}
        }
    }

    cleaned.trim_end().to_string()
}

pub(crate) fn log_level(text: &str, source: &LogSource) -> &'static str {
    if matches!(source, LogSource::Stderr) {
        return "ERROR";
    }
    if matches!(source, LogSource::System) {
        return "SYSTEM";
    }
    for level in ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"] {
        if text
            .split(|ch: char| !ch.is_ascii_alphabetic())
            .any(|part| part == level)
        {
            return level;
        }
    }
    "INFO"
}

pub(crate) fn is_spring_started_line(
    line: &str,
    service_name: &str,
    main_class: Option<&str>,
) -> bool {
    let line_lower = line.to_lowercase();
    if !line_lower.contains("started") {
        return false;
    }
    if line_lower.contains("application") || line_lower.contains("seconds") {
        return true;
    }

    let service_name_lower = service_name.to_lowercase();
    if !service_name_lower.trim().is_empty() && line_lower.contains(&service_name_lower) {
        return true;
    }

    let Some(main_class) = main_class else {
        return false;
    };
    let main_class_lower = main_class.to_lowercase();
    if main_class_lower.trim().is_empty() {
        return false;
    }
    if line_lower.contains(&main_class_lower) {
        return true;
    }
    main_class_lower
        .rsplit('.')
        .next()
        .filter(|simple_name| !simple_name.is_empty())
        .is_some_and(|simple_name| line_lower.contains(simple_name))
}

pub(crate) fn is_spring_startup_access_signal(
    status: &RuntimeStatus,
    service_kind: &ServiceKind,
    detected_url: Option<&str>,
    detected_port: Option<u16>,
) -> bool {
    matches!(status, RuntimeStatus::Starting)
        && matches!(service_kind, ServiceKind::Spring)
        && (detected_url.is_some() || detected_port.is_some())
}

pub(crate) fn is_exception_start(text: &str) -> bool {
    let Some(first) = text.split_whitespace().next() else {
        return false;
    };
    let class_name = first.trim_end_matches(':');
    class_name.ends_with("Exception") || class_name.ends_with("Error")
}
