use super::*;

pub(crate) fn is_disallowed_frontend_script_name(script_name: &str) -> bool {
    matches!(
        script_name.trim().to_ascii_lowercase().as_str(),
        "install" | "postinstall" | "preinstall" | "publish" | "deploy" | "release" | "build"
    )
}

pub(crate) fn executable_stem(command: &str) -> String {
    let trimmed = command.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }

    Path::new(trimmed)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed)
        .to_ascii_lowercase()
}

pub(crate) fn is_java_command(command: &str) -> bool {
    executable_stem(command) == "java"
}

pub(crate) fn is_maven_command(command: &str) -> bool {
    matches!(executable_stem(command).as_str(), "mvn" | "mvnw")
}

pub(crate) fn is_gradle_command(command: &str) -> bool {
    matches!(executable_stem(command).as_str(), "gradle" | "gradlew")
}

pub(crate) fn is_cargo_command(command: &str) -> bool {
    executable_stem(command) == "cargo"
}

pub(crate) fn is_node_package_manager_command(command: &str) -> bool {
    matches!(
        executable_stem(command).as_str(),
        "npm" | "pnpm" | "yarn" | "bun"
    )
}

pub(crate) fn is_node_dev_command(command: &str) -> bool {
    matches!(executable_stem(command).as_str(), "node" | "npx" | "vite")
}

pub(crate) fn detect_frontend_package_manager(project_root: &Path) -> String {
    if project_root.join("pnpm-lock.yaml").exists() {
        return "pnpm".to_string();
    }
    if project_root.join("yarn.lock").exists() {
        return "yarn".to_string();
    }
    if project_root.join("bun.lock").exists() || project_root.join("bun.lockb").exists() {
        return "bun".to_string();
    }
    "npm".to_string()
}

pub(crate) fn detect_package_manager_framework(project_root: &Path) -> Option<String> {
    Some(detect_frontend_package_manager(project_root))
}

pub(crate) async fn detect_frontend_framework_from_dir(project_root: &Path) -> Option<String> {
    let package_file = project_root.join("package.json");
    let content = fs::read_to_string(&package_file).await.ok()?;
    let package = serde_json::from_str::<PackageJson>(&content).ok()?;
    detect_frontend_framework(&package, project_root)
        .or_else(|| detect_package_manager_framework(project_root))
}

pub(crate) fn detect_frontend_framework(
    package: &PackageJson,
    project_root: &Path,
) -> Option<String> {
    [
        ("nextjs", ["next"].as_slice()),
        ("nuxt", ["nuxt", "nuxi"].as_slice()),
        ("angular", ["@angular/core", "@angular/cli"].as_slice()),
        ("svelte", ["svelte", "@sveltejs/kit"].as_slice()),
        ("astro", ["astro"].as_slice()),
        ("remix", ["@remix-run/react", "@remix-run/dev"].as_slice()),
        (
            "storybook",
            [
                "storybook",
                "@storybook/react",
                "@storybook/vue3",
                "@storybook/svelte",
            ]
            .as_slice(),
        ),
        ("vue", ["vue", "@vitejs/plugin-vue"].as_slice()),
        (
            "react",
            ["react", "react-dom", "@vitejs/plugin-react"].as_slice(),
        ),
        ("vite", ["vite"].as_slice()),
        ("tauri", ["@tauri-apps/api", "@tauri-apps/cli"].as_slice()),
    ]
    .iter()
    .find_map(|(framework, packages)| {
        packages
            .iter()
            .any(|package_name| package_has_dependency(package, package_name))
            .then(|| (*framework).to_string())
    })
    .or_else(|| {
        if project_root.join("src-tauri").is_dir() {
            Some("tauri".to_string())
        } else {
            None
        }
    })
    .or_else(|| infer_script_framework(package))
}

pub(crate) fn package_has_dependency(package: &PackageJson, dependency: &str) -> bool {
    package.dependencies.contains_key(dependency)
        || package.dev_dependencies.contains_key(dependency)
        || package.peer_dependencies.contains_key(dependency)
}

pub(crate) fn infer_script_framework(package: &PackageJson) -> Option<String> {
    package.scripts.values().find_map(|script| {
        let command = script.as_str()?.to_ascii_lowercase();
        [
            ("nextjs", "next dev"),
            ("nuxt", "nuxt dev"),
            ("nuxt", "nuxi dev"),
            ("angular", "ng serve"),
            ("svelte", "svelte-kit dev"),
            ("astro", "astro dev"),
            ("remix", "remix dev"),
            ("storybook", "storybook"),
            ("vite", "vite"),
        ]
        .iter()
        .find_map(|(framework, token)| command.contains(token).then(|| (*framework).to_string()))
    })
}

pub(crate) fn infer_command_framework(command: &str) -> Option<String> {
    match executable_stem(command).as_str() {
        "node" | "npx" => Some("node".to_string()),
        "npm" => Some("npm".to_string()),
        "pnpm" => Some("pnpm".to_string()),
        "yarn" => Some("yarn".to_string()),
        "bun" => Some("bun".to_string()),
        "vite" => Some("vite".to_string()),
        "java" => Some("java".to_string()),
        "mvn" | "mvnw" => Some("maven".to_string()),
        "gradle" | "gradlew" => Some("gradle".to_string()),
        "cargo" => Some("rust".to_string()),
        _ => None,
    }
}

pub(crate) fn normalize_framework(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_ascii_lowercase();
    let normalized = match value.as_str() {
        "" => return None,
        "spring" | "springboot" | "spring-boot" => "spring-boot",
        "next" | "next.js" | "nextjs" => "nextjs",
        "node.js" | "nodejs" | "node" => "node",
        "vuejs" | "vue.js" | "vue" => "vue",
        "reactjs" | "react.js" | "react" => "react",
        "tauri-apps" | "tauri" => "tauri",
        "angular" | "svelte" | "astro" | "remix" | "storybook" | "vite" | "nuxt" | "npm"
        | "pnpm" | "yarn" | "bun" | "rust" | "java" | "maven" | "gradle" | "frontend"
        | "service" => value.as_str(),
        _ => value.as_str(),
    };
    Some(normalized.to_string())
}

pub(crate) fn build_frontend_dev_args(service: &ServiceConfig) -> Vec<String> {
    let script = service.frontend_script.as_deref().unwrap_or("dev");
    let mut script_args = normalize_frontend_script_args(&service.args);
    if let Some(port) = service.port {
        if !has_frontend_port_arg(&script_args) {
            script_args.push("--port".to_string());
            script_args.push(port.to_string());
        }
    }

    let mut args = vec!["run".to_string(), script.to_string()];
    if !script_args.is_empty() {
        args.push("--".to_string());
        args.extend(script_args);
    }
    args
}

pub(crate) fn select_frontend_script(package: &PackageJson) -> Option<String> {
    ["dev", "start", "serve", "storybook"]
        .iter()
        .find_map(|script_name| {
            package
                .scripts
                .get(*script_name)
                .filter(|script_value| is_allowed_frontend_script(script_name, script_value))
                .map(|_| (*script_name).to_string())
        })
        .or_else(|| {
            package
                .scripts
                .iter()
                .find_map(|(script_name, script_value)| {
                    if is_allowed_frontend_script(script_name, script_value) {
                        Some(script_name.clone())
                    } else {
                        None
                    }
                })
        })
}

pub(crate) fn is_allowed_frontend_script(
    script_name: &str,
    script_value: &serde_json::Value,
) -> bool {
    let name = script_name.trim().to_ascii_lowercase();
    if is_disallowed_frontend_script_name(&name) {
        return false;
    }

    let Some(command) = script_value.as_str() else {
        return false;
    };
    let command = command.trim().to_ascii_lowercase();
    if command.is_empty() || contains_disallowed_frontend_script_action(&command) {
        return false;
    }

    matches!(name.as_str(), "dev" | "serve" | "storybook") || is_known_frontend_dev_script(&command)
}

pub(crate) fn is_known_frontend_dev_script(command: &str) -> bool {
    [
        "vite",
        "next dev",
        "nuxt dev",
        "nuxi dev",
        "ng serve",
        "astro dev",
        "svelte-kit dev",
        "react-scripts start",
        "remix dev",
        "storybook",
        "vitepress dev",
        "vuepress dev",
    ]
    .iter()
    .any(|token| command.contains(token))
}

pub(crate) fn contains_disallowed_frontend_script_action(command: &str) -> bool {
    [
        "git ",
        "git\t",
        "git.exe",
        "npm install",
        "npm publish",
        "npm version",
        "pnpm add",
        "pnpm install",
        "yarn add",
        "yarn install",
        "yarn publish",
        "bun install",
        "kubectl",
        "helm",
        "ssh ",
        "scp ",
        "sftp ",
        "rsync",
        "docker push",
        "docker login",
        "mvn deploy",
        "mvn install",
        "gradle publish",
        "gradlew publish",
    ]
    .iter()
    .any(|token| command.contains(token))
}

pub(crate) fn normalize_frontend_script_args(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|arg| arg.trim() != "--")
        .cloned()
        .collect()
}

pub(crate) fn has_frontend_port_arg(args: &[String]) -> bool {
    args.iter().any(|arg| {
        let normalized = arg.trim().to_ascii_lowercase();
        normalized == "--port" || normalized.starts_with("--port=") || normalized == "-p"
    })
}

pub(crate) fn is_allowed_custom_launch_command(service: &ServiceConfig) -> bool {
    match service.service_kind {
        ServiceKind::Spring => {
            is_java_command(&service.command)
                || is_maven_command(&service.command)
                || is_gradle_command(&service.command)
        }
        ServiceKind::Vue => {
            is_node_package_manager_command(&service.command)
                || is_node_dev_command(&service.command)
        }
        ServiceKind::Rust => is_cargo_command(&service.command),
    }
}

pub(crate) fn is_disallowed_maven_goal(arg: &str) -> bool {
    matches!(
        arg.trim().to_ascii_lowercase().as_str(),
        "install"
            | "deploy"
            | "deploy:deploy-file"
            | "release:prepare"
            | "release:perform"
            | "site-deploy"
            | "gpg:sign-and-deploy-file"
    )
}

pub(crate) fn is_disallowed_gradle_task(arg: &str) -> bool {
    matches!(
        arg.trim().to_ascii_lowercase().as_str(),
        "publish" | "publishtomavenlocal" | "uploadarchives" | "artifactorypublish" | "release"
    )
}

pub(crate) fn is_disallowed_node_package_manager_action(arg: &str) -> bool {
    matches!(
        arg.trim().to_ascii_lowercase().as_str(),
        "install"
            | "i"
            | "add"
            | "remove"
            | "rm"
            | "update"
            | "upgrade"
            | "publish"
            | "version"
            | "login"
            | "logout"
            | "link"
            | "unlink"
    )
}
