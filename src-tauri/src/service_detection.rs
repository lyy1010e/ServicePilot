use super::*;

pub(crate) fn extract_maven_modules(pom: &str) -> Vec<String> {
    let Some(modules_start) = pom.find("<modules>") else {
        return Vec::new();
    };
    let Some(modules_end) = pom[modules_start..].find("</modules>") else {
        return Vec::new();
    };
    let modules_block = &pom[modules_start..modules_start + modules_end];
    let mut modules = Vec::new();
    let mut remaining = modules_block;
    while let Some(start) = remaining.find("<module>") {
        remaining = &remaining[start + "<module>".len()..];
        if let Some(end) = remaining.find("</module>") {
            let name = remaining[..end].trim().to_string();
            if !name.is_empty() {
                modules.push(name);
            }
            remaining = &remaining[end + "</module>".len()..];
        } else {
            break;
        }
    }
    modules
}

/// Check if a directory is a runnable Spring Boot service by looking for `@SpringBootApplication`.
/// Strategy: pom.xml quick pre-filter first, then scan .java files line-by-line with early exit.
pub(crate) async fn has_spring_application_entry(dir: &Path) -> bool {
    // Quick pre-filter: pom.xml must mention spring-boot at all
    let pom_path = dir.join("pom.xml");
    if let Ok(pom) = fs::read_to_string(&pom_path).await {
        if !pom.contains("spring-boot") {
            return false;
        }
    }

    let src_main_java = dir.join("src").join("main").join("java");
    if !src_main_java.is_dir() {
        return false;
    }
    has_spring_entry_recursive(&src_main_java).await
}

pub(crate) fn has_spring_entry_recursive(
    dir: &Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + '_>> {
    Box::pin(async move {
        let mut entries = match fs::read_dir(dir).await {
            Ok(e) => e,
            Err(_) => return false,
        };
        while let Some(entry) = match entries.next_entry().await {
            Ok(e) => e,
            Err(_) => return false,
        } {
            let path = entry.path();
            if path.is_dir() {
                if has_spring_entry_recursive(&path).await {
                    return true;
                }
            } else if path.extension().map_or(false, |ext| ext == "java") {
                if java_file_contains_spring_entry(&path).await {
                    return true;
                }
            }
        }
        false
    })
}

/// Line-by-line scan with early exit — stops as soon as `@SpringBootApplication` is found.
pub(crate) async fn java_file_contains_spring_entry(path: &Path) -> bool {
    let file = match fs::File::open(path).await {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => return false, // EOF
            Ok(_) => {
                if line.contains("@SpringBootApplication") {
                    return true;
                }
            }
            Err(_) => return false,
        }
    }
}

pub(crate) fn extract_maven_artifact_id(pom: &str) -> Option<String> {
    // Find the first <artifactId> that is NOT inside a <parent> block
    let mut remaining = pom;
    while let Some(start) = remaining.find("<artifactId>") {
        let before = &remaining[..start];
        // Check if we're inside a <parent>...</parent> block
        let parent_open_count = before.matches("<parent>").count();
        let parent_close_count = before.matches("</parent>").count();
        remaining = &remaining[start + "<artifactId>".len()..];
        if let Some(end) = remaining.find("</artifactId>") {
            let artifact_id = remaining[..end].trim().to_string();
            if !artifact_id.is_empty() && parent_open_count <= parent_close_count {
                return Some(artifact_id);
            }
            remaining = &remaining[end + "</artifactId>".len()..];
        } else {
            break;
        }
    }
    None
}

pub(crate) async fn extract_server_port_from_dir(dir: &Path) -> Option<u16> {
    // Try application.yml first, then application.properties
    let resource_dir = dir.join("src").join("main").join("resources");

    let yml_path = resource_dir.join("application.yml");
    if let Ok(content) = fs::read_to_string(&yml_path).await {
        if let Some(port) = extract_port_from_yaml(&content) {
            return Some(port);
        }
    }

    let yaml_path = resource_dir.join("application.yaml");
    if let Ok(content) = fs::read_to_string(&yaml_path).await {
        if let Some(port) = extract_port_from_yaml(&content) {
            return Some(port);
        }
    }

    let properties_path = resource_dir.join("application.properties");
    if let Ok(content) = fs::read_to_string(&properties_path).await {
        if let Some(port) = extract_port_from_properties(&content) {
            return Some(port);
        }
    }

    None
}

pub(crate) fn extract_port_from_yaml(content: &str) -> Option<u16> {
    // Simple YAML parser for server.port
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        // Match "server:" followed by "  port: XXXX" on next lines
        if trimmed == "server:" {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("port:") {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if let Ok(port) = value.parse::<u16>() {
                if port > 0 {
                    return Some(port);
                }
            }
        }
    }
    None
}

pub(crate) fn extract_port_from_properties(content: &str) -> Option<u16> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.starts_with('!') {
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("server.port=") {
            let value = rest.trim().trim_matches('"').trim_matches('\'');
            if let Ok(port) = value.parse::<u16>() {
                if port > 0 {
                    return Some(port);
                }
            }
        }
    }
    None
}
