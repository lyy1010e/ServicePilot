use super::*;

pub(crate) fn extract_xml_option_value(content: &str, option_name: &str) -> Option<String> {
    let marker = format!(r#"name="{option_name}""#);
    let index = content.find(&marker)?;
    let remainder = &content[index..];
    let value_marker = r#"value=""#;
    let value_index = remainder.find(value_marker)?;
    let value_start = value_index + value_marker.len();
    let value_end = remainder[value_start..].find('"')?;
    let value = &remainder[value_start..value_start + value_end];
    Some(decode_xml_value(value))
}

pub(crate) fn extract_xml_attribute(content: &str, attribute_name: &str) -> Option<String> {
    let marker = format!(r#"{attribute_name}=""#);
    let index = content.find(&marker)?;
    let remainder = &content[index + marker.len()..];
    let value_end = remainder.find('"')?;
    Some(decode_xml_value(&remainder[..value_end]))
}

pub(crate) fn decode_xml_value(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&apos;", "'")
}

pub(crate) fn extract_component_block(content: &str, component_name: &str) -> Option<String> {
    let marker = format!(r#"<component name="{component_name}""#);
    let start = content.find(&marker)?;
    let remainder = &content[start..];
    let end = remainder.find("</component>")?;
    Some(remainder[..end + "</component>".len()].to_string())
}

pub(crate) fn extract_idea_spring_run_configs(content: &str) -> Vec<IdeaSpringRunConfig> {
    let Some(run_manager) = extract_component_block(content, "RunManager") else {
        return Vec::new();
    };

    let mut configs = Vec::new();
    let mut offset = 0;
    while let Some(relative_start) = run_manager[offset..].find("<configuration ") {
        let start = offset + relative_start;
        let remainder = &run_manager[start..];
        let Some(header_end) = remainder.find('>') else {
            break;
        };
        let header = &remainder[..header_end + 1];
        let Some(block_end) = remainder.find("</configuration>") else {
            break;
        };
        let block = &remainder[..block_end + "</configuration>".len()];
        offset = start + block_end + "</configuration>".len();

        if extract_xml_attribute(header, "type").as_deref()
            != Some("SpringBootApplicationConfigurationType")
        {
            continue;
        }
        if extract_xml_attribute(header, "default").as_deref() == Some("true") {
            continue;
        }

        let Some(name) = extract_xml_attribute(header, "name") else {
            continue;
        };
        let Some(main_class) = extract_xml_option_value(block, "SPRING_BOOT_MAIN_CLASS") else {
            continue;
        };

        configs.push(IdeaSpringRunConfig {
            name,
            module_name: extract_module_name(block),
            main_class,
            working_directory: extract_named_option_value(block, &["WORKING_DIRECTORY"]),
            jvm_args: extract_named_option_value(block, &["VM_PARAMETERS"])
                .map(|value| split_command_line_args(&value))
                .unwrap_or_default(),
            program_args: extract_named_option_value(block, &["PROGRAM_PARAMETERS"])
                .map(|value| split_command_line_args(&value))
                .unwrap_or_default(),
            env: extract_env_map(block),
        });
    }

    configs
}

pub(crate) fn select_idea_run_config(
    configs: &[IdeaSpringRunConfig],
    workspace_content: &str,
    selected_path: &Path,
    project_root: &Path,
) -> Option<IdeaSpringRunConfig> {
    let selected_name = extract_component_selection(workspace_content);

    configs.iter().cloned().max_by_key(|config| {
        score_idea_run_config(
            config,
            selected_name.as_deref(),
            selected_path,
            project_root,
        )
    })
}

pub(crate) fn extract_component_selection(content: &str) -> Option<String> {
    let run_manager = extract_component_block(content, "RunManager")?;
    extract_xml_attribute(&run_manager, "selected")
}

pub(crate) fn score_idea_run_config(
    config: &IdeaSpringRunConfig,
    selected_name: Option<&str>,
    selected_path: &Path,
    project_root: &Path,
) -> u16 {
    let mut score = 0;

    if let Some(selected) = selected_name {
        let expected = format!("Spring Boot.{}", config.name);
        if selected == config.name || selected == expected {
            score += 100;
        }
    }

    if let Some(module_dir) =
        resolve_idea_working_dir_lightweight(project_root, selected_path, config)
    {
        if selected_path == module_dir {
            score += 300;
        } else if selected_path.starts_with(&module_dir) || module_dir.starts_with(selected_path) {
            score += 150;
        }
    }

    if let Some(module_name) = &config.module_name {
        let selected_text = selected_path.to_string_lossy();
        if selected_text.ends_with(module_name) {
            score += 80;
        }
    }

    score
}

pub(crate) fn resolve_idea_working_dir_lightweight(
    project_root: &Path,
    selected_path: &Path,
    config: &IdeaSpringRunConfig,
) -> Option<PathBuf> {
    if let Some(explicit) = config
        .working_directory
        .as_ref()
        .map(|value| PathBuf::from(expand_idea_path(value, Some(project_root))))
        .filter(|path| path.exists())
    {
        return Some(explicit);
    }

    // 通过 main_class 查找实际目录（最可靠）
    if let Some(found) = find_module_dir_by_main_class(project_root, &config.main_class) {
        return Some(found);
    }

    if selected_path.join("pom.xml").exists() {
        return Some(selected_path.to_path_buf());
    }

    // 兜底：module_name 模糊匹配
    config
        .module_name
        .as_ref()
        .and_then(|module_name| {
            std::fs::read_dir(project_root).ok().and_then(|entries| {
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .find(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with(module_name))
                            .unwrap_or(false)
                            && p.join("pom.xml").exists()
                    })
            })
        })
        .or_else(|| {
            project_root
                .join("pom.xml")
                .exists()
                .then(|| project_root.to_path_buf())
        })
}

pub(crate) fn extract_module_name(content: &str) -> Option<String> {
    let marker = "<module ";
    let index = content.find(marker)?;
    let remainder = &content[index..];
    let end = remainder.find('>')?;
    extract_xml_attribute(&remainder[..end + 1], "name")
}

pub(crate) fn extract_named_option_value(content: &str, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| extract_xml_option_value(content, name))
}

pub(crate) fn extract_env_map(content: &str) -> HashMap<String, String> {
    let Some(start) = content.find("<envs>") else {
        return HashMap::new();
    };
    let remainder = &content[start..];
    let Some(end) = remainder.find("</envs>") else {
        return HashMap::new();
    };
    let envs_block = &remainder[..end];
    let mut env = HashMap::new();
    let mut offset = 0;

    while let Some(relative_start) = envs_block[offset..].find("<env ") {
        let start_index = offset + relative_start;
        let fragment = &envs_block[start_index..];
        let Some(end_index) = fragment.find("/>") else {
            break;
        };
        let item = &fragment[..end_index + 2];
        offset = start_index + end_index + 2;

        let Some(name) = extract_xml_attribute(item, "name") else {
            continue;
        };
        let value = extract_xml_attribute(item, "value").unwrap_or_default();
        env.insert(name, value);
    }

    env
}

pub(crate) fn split_command_line_args(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in input.chars() {
        match quote {
            Some(active) if ch == active => quote = None,
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    args.push(current.clone());
                    current.clear();
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        args.push(current);
    }

    args
}

pub(crate) fn extract_project_jdk_name(content: &str) -> Option<String> {
    let marker = r#"<component name="ProjectRootManager""#;
    let start = content.find(marker)?;
    let remainder = &content[start..];
    let end = remainder.find('>')?;
    extract_xml_attribute(&remainder[..end + 1], "project-jdk-name")
}

pub(crate) fn resolve_idea_jdk_home(jdk_name: &str) -> Option<String> {
    let app_data = std::env::var("APPDATA").ok()?;
    let jetbrains_dir = PathBuf::from(app_data).join("JetBrains");
    let entries = std::fs::read_dir(jetbrains_dir).ok()?;

    for entry in entries.flatten() {
        let candidate = entry.path().join("options").join("jdk.table.xml");
        if !candidate.exists() {
            continue;
        }

        let Ok(content) = std::fs::read_to_string(&candidate) else {
            continue;
        };
        if let Some(home_path) = extract_jdk_home_from_table(&content, jdk_name) {
            return Some(home_path);
        }
    }

    None
}

pub(crate) fn infer_project_java_home(start: &Path) -> Option<String> {
    let workspace_file = find_idea_workspace(start)?;
    let project_root = workspace_file.parent()?.parent()?;
    let misc_file = project_root.join(".idea").join("misc.xml");
    let misc_content = std::fs::read_to_string(misc_file).ok()?;
    let jdk_name = extract_project_jdk_name(&misc_content);
    jdk_name
        .as_deref()
        .and_then(resolve_idea_jdk_home)
        .or_else(|| fallback_java_home(jdk_name.as_deref()))
}

pub(crate) fn has_env_key(env: &HashMap<String, String>, target: &str) -> bool {
    env.keys().any(|key| key.eq_ignore_ascii_case(target))
}

pub(crate) fn should_detect_port_from_line(text: &str) -> bool {
    let cleaned = strip_ansi_sequences(text);
    let lower = cleaned.trim().to_ascii_lowercase();
    [
        "tomcat started on port",
        "netty started on port",
        "started on port",
        "listening on 0.0.0.0 port",
        "listening on port",
        "local: http://",
        "local: https://",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub(crate) fn extract_jdk_home_from_table(content: &str, jdk_name: &str) -> Option<String> {
    let mut offset = 0;
    while let Some(relative_start) = content[offset..].find("<jdk ") {
        let start = offset + relative_start;
        let remainder = &content[start..];
        let end = remainder.find("</jdk>")?;
        let block = &remainder[..end + "</jdk>".len()];
        offset = start + end + "</jdk>".len();

        let Some(name_index) = block.find(r#"<name value=""#) else {
            continue;
        };
        let name_fragment = &block[name_index..];
        let Some(name_value_end) = name_fragment[r#"<name value=""#.len()..].find('"') else {
            continue;
        };
        let configured_name = decode_xml_value(
            &name_fragment[r#"<name value=""#.len()..r#"<name value=""#.len() + name_value_end],
        );
        if configured_name != jdk_name {
            continue;
        }

        let home_index = block.find(r#"<homePath value=""#)?;
        let home_fragment = &block[home_index..];
        let home_value_start = r#"<homePath value=""#.len();
        let home_value_end = home_fragment[home_value_start..].find('"')?;
        let home_value = &home_fragment[home_value_start..home_value_start + home_value_end];
        return Some(expand_idea_path(home_value, None));
    }

    None
}

pub(crate) fn fallback_java_home(jdk_name: Option<&str>) -> Option<String> {
    let prefers_java8 = jdk_name
        .map(|value| value.contains("1.8") || value.contains("8"))
        .unwrap_or(false);

    if prefers_java8 {
        std::env::var("JAVA_HOME8")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                std::env::var("JAVA_HOME")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
            })
    } else {
        std::env::var("JAVA_HOME")
            .ok()
            .filter(|value| !value.trim().is_empty())
    }
}

pub(crate) fn extract_idea_maven_settings(content: &str, project_root: &Path) -> AppSettings {
    AppSettings {
        language: AppLanguage::ZhCn,
        maven_settings_file: extract_xml_option_value(content, "userSettingsFile")
            .map(|value| expand_idea_path(&value, Some(project_root)))
            .unwrap_or_default(),
        maven_local_repository: extract_xml_option_value(content, "localRepository")
            .map(|value| expand_idea_path(&value, Some(project_root)))
            .unwrap_or_default(),
        clear_logs_on_restart: true,
        resume_services_on_launch: false,
    }
}

pub(crate) fn expand_idea_path(value: &str, project_root: Option<&Path>) -> String {
    let mut expanded = value.to_string();
    if let Some(user_home) = std::env::var("USERPROFILE")
        .ok()
        .or_else(|| std::env::var("HOME").ok())
    {
        expanded = expanded.replace("$USER_HOME$", &user_home);
    }
    if let Some(root) = project_root {
        expanded = expanded.replace("$PROJECT_DIR$", &root.to_string_lossy());
    }
    expanded.replace('/', "\\")
}

pub(crate) fn resolve_idea_working_dir(
    project_root: &Path,
    selected_path: &Path,
    config: &IdeaSpringRunConfig,
) -> Option<String> {
    if let Some(explicit) = config
        .working_directory
        .as_ref()
        .map(|value| PathBuf::from(expand_idea_path(value, Some(project_root))))
        .filter(|path| path.exists())
    {
        return Some(explicit.to_string_lossy().to_string());
    }

    if let Some(found) = find_module_dir_by_main_class(project_root, &config.main_class) {
        return Some(found.to_string_lossy().to_string());
    }

    if selected_path.join("pom.xml").exists() {
        return Some(selected_path.to_string_lossy().to_string());
    }

    config
        .module_name
        .as_ref()
        .map(|module_name| project_root.join(module_name))
        .filter(|path| path.join("pom.xml").exists())
        .map(|path| path.to_string_lossy().to_string())
        .or_else(|| {
            project_root
                .join("pom.xml")
                .exists()
                .then(|| project_root.to_string_lossy().to_string())
        })
}

pub(crate) fn find_module_dir_by_main_class(
    project_root: &Path,
    main_class: &str,
) -> Option<PathBuf> {
    let mut relative_source = PathBuf::from("src");
    relative_source.push("main");
    relative_source.push("java");
    for segment in main_class.split('.') {
        relative_source.push(segment);
    }
    relative_source.set_extension("java");

    find_source_file(project_root, &relative_source).and_then(find_ancestor_with_pom)
}

pub(crate) fn find_source_file(root: &Path, expected_suffix: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_source_file(&path, expected_suffix) {
                return Some(found);
            }
            continue;
        }
        if path.ends_with(expected_suffix) {
            return Some(path);
        }
    }
    None
}

pub(crate) fn find_ancestor_with_pom(path: PathBuf) -> Option<PathBuf> {
    for current in path.ancestors() {
        if current.join("pom.xml").exists() {
            return Some(current.to_path_buf());
        }
    }
    None
}
