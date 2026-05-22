use super::*;
use serde_json::json;

fn service(
    launch_type: LaunchType,
    service_kind: ServiceKind,
    command: &str,
    args: &[&str],
) -> ServiceConfig {
    ServiceConfig {
        id: "service-1".to_string(),
        name: "service".to_string(),
        service_kind,
        framework: None,
        launch_type,
        working_dir: "D:\\workspace\\service".to_string(),
        command: command.to_string(),
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        env: HashMap::new(),
        profiles: Vec::new(),
        port: None,
        url: None,
        frontend_script: None,
        maven_force_update: false,
        maven_debug_mode: false,
        maven_disable_fork: false,
        main_class: None,
        classpath: None,
        jvm_args: Vec::new(),
    }
}

fn package_with_scripts(scripts: &[(&str, serde_json::Value)]) -> PackageJson {
    PackageJson {
        name: Some("fixture".to_string()),
        scripts: scripts
            .iter()
            .map(|(name, value)| ((*name).to_string(), value.clone()))
            .collect(),
        dependencies: HashMap::new(),
        dev_dependencies: HashMap::new(),
        peer_dependencies: HashMap::new(),
    }
}

#[test]
fn safe_launch_policy_allows_local_development_commands() {
    let maven = service(
        LaunchType::Maven,
        ServiceKind::Spring,
        "mvn",
        &["spring-boot:run"],
    );
    assert!(validate_safe_launch_policy(&maven).is_ok());

    let java = service(
        LaunchType::JavaMain,
        ServiceKind::Spring,
        "java",
        &["-cp", "target/classes", "com.example.Application"],
    );
    assert!(validate_safe_launch_policy(&java).is_ok());

    let mut npm = service(
        LaunchType::VuePreset,
        ServiceKind::Vue,
        "npm",
        &["run", "dev"],
    );
    npm.frontend_script = Some("dev".to_string());
    assert!(validate_safe_launch_policy(&npm).is_ok());

    let mut pnpm = service(
        LaunchType::VuePreset,
        ServiceKind::Vue,
        "pnpm",
        &["run", "dev"],
    );
    pnpm.frontend_script = Some("dev".to_string());
    assert!(validate_safe_launch_policy(&pnpm).is_ok());
}

#[test]
fn safe_launch_policy_blocks_dangerous_commands() {
    let cases = [
        service(LaunchType::Custom, ServiceKind::Spring, "git", &["push"]),
        service(LaunchType::Maven, ServiceKind::Spring, "mvn", &["install"]),
        service(LaunchType::Maven, ServiceKind::Spring, "mvn", &["deploy"]),
        service(
            LaunchType::Custom,
            ServiceKind::Spring,
            "gradle",
            &["publish"],
        ),
        service(LaunchType::VuePreset, ServiceKind::Vue, "npm", &["install"]),
        service(LaunchType::VuePreset, ServiceKind::Vue, "npm", &["publish"]),
        service(LaunchType::Custom, ServiceKind::Vue, "kubectl", &["apply"]),
        service(LaunchType::Custom, ServiceKind::Vue, "ssh", &["host"]),
        service(
            LaunchType::Custom,
            ServiceKind::Vue,
            "docker",
            &["push", "repo/image"],
        ),
        service(LaunchType::Custom, ServiceKind::Vue, "docker", &["login"]),
    ];

    for case in cases {
        assert!(
            validate_safe_launch_policy(&case).is_err(),
            "expected command to be blocked: {} {:?}",
            case.command,
            case.args
        );
    }
}

#[test]
fn maven_launch_spec_includes_managed_local_startup_args() {
    let mut maven = service(LaunchType::Maven, ServiceKind::Spring, "", &["-DskipTests"]);
    maven.maven_force_update = true;
    maven.profiles = vec!["dev".to_string(), "local".to_string()];
    maven.port = Some(8080);

    let settings = AppSettings {
        language: AppLanguage::ZhCn,
        maven_settings_file: "D:\\environment\\settings.xml".to_string(),
        maven_local_repository: "D:\\environment\\repository".to_string(),
        clear_logs_on_restart: true,
    };
    let launch = create_launch_spec(&maven, &settings);

    assert_eq!(launch.command, "mvn");
    assert!(launch.args.contains(&"-s".to_string()));
    assert!(launch
        .args
        .contains(&"D:\\environment\\settings.xml".to_string()));
    assert!(launch
        .args
        .contains(&"-Dmaven.repo.local=D:\\environment\\repository".to_string()));
    assert!(launch.args.contains(&"-U".to_string()));
    assert!(launch.args.contains(&"spring-boot:run".to_string()));
    assert!(launch
        .args
        .contains(&"-Dspring-boot.run.profiles=dev,local".to_string()));
    assert!(launch
        .args
        .contains(&"-Dspring-boot.run.arguments=--server.port=8080".to_string()));
    assert!(launch
        .args
        .contains(&"-Dspring-boot.run.fork=false".to_string()));
    assert_eq!(
        launch.env.get("MAVEN_OPTS"),
        Some(&"-Dfile.encoding=UTF-8".to_string())
    );
}

#[test]
fn java_main_launch_spec_includes_classpath_main_class_profiles_and_port() {
    let mut java = service(LaunchType::JavaMain, ServiceKind::Spring, "", &["--debug"]);
    java.main_class = Some("com.example.Application".to_string());
    java.classpath = Some("target/classes;target/dependency/*".to_string());
    java.jvm_args = vec!["-Xmx512m".to_string()];
    java.profiles = vec!["dev".to_string()];
    java.port = Some(9090);

    let launch = create_launch_spec(&java, &default_settings());

    assert_eq!(launch.command, "java");
    assert_eq!(
        launch.args,
        vec![
            "-Dfile.encoding=UTF-8",
            "-Xmx512m",
            "-cp",
            "target/classes;target/dependency/*",
            "com.example.Application",
            "--spring.profiles.active=dev",
            "--server.port=9090",
            "--debug"
        ]
    );
}

#[test]
fn default_spring_heap_args_are_added_only_when_missing() {
    let mut args = vec!["-Dfile.encoding=UTF-8".to_string()];
    add_default_spring_heap_args_if_missing(&mut args);
    assert!(args.contains(&"-Xms128m".to_string()));
    assert!(args.contains(&"-Xmx512m".to_string()));

    let mut configured = vec!["-Xms256m".to_string(), "-Xmx1024m".to_string()];
    add_default_spring_heap_args_if_missing(&mut configured);
    assert_eq!(configured, vec!["-Xms256m", "-Xmx1024m"]);
}

#[test]
fn vue_preset_launch_spec_adds_script_args_and_port_env() {
    let mut vue = service(
        LaunchType::VuePreset,
        ServiceKind::Vue,
        "pnpm",
        &["--", "--host", "127.0.0.1"],
    );
    vue.frontend_script = Some("dev".to_string());
    vue.port = Some(5173);

    let launch = create_launch_spec(&vue, &default_settings());

    assert_eq!(launch.command, "pnpm");
    assert_eq!(
        launch.args,
        vec!["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"]
    );
    assert_eq!(launch.env.get("PORT"), Some(&"5173".to_string()));
    assert!(launch.command_line.contains("pnpm run dev"));
}

#[test]
fn frontend_script_selection_prefers_safe_development_scripts() {
    let package = package_with_scripts(&[
        ("build", json!("vite build")),
        ("dev", json!("vite --host 127.0.0.1")),
        ("serve", json!("vite preview")),
    ]);
    assert_eq!(select_frontend_script(&package), Some("dev".to_string()));

    let package = package_with_scripts(&[
        ("start", json!("next dev")),
        ("storybook", json!("storybook dev -p 6006")),
    ]);
    assert_eq!(select_frontend_script(&package), Some("start".to_string()));
}

#[test]
fn frontend_script_selection_rejects_mutating_or_publish_scripts() {
    let package = package_with_scripts(&[
        ("install", json!("npm install")),
        ("build", json!("vite build")),
        ("deploy", json!("kubectl apply -f deployment.yaml")),
        ("publish", json!("npm publish")),
    ]);
    assert_eq!(select_frontend_script(&package), None);
}

#[test]
fn frontend_package_manager_detection_uses_lockfiles() {
    let root = std::env::temp_dir().join(format!("service-pilot-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).expect("create temp project");
    assert_eq!(detect_frontend_package_manager(&root), "npm");

    std::fs::write(root.join("pnpm-lock.yaml"), "").expect("write pnpm lock");
    assert_eq!(detect_frontend_package_manager(&root), "pnpm");
}

#[test]
fn log_parsing_extracts_local_urls_and_ports() {
    assert_eq!(
        extract_url("  Local:   http://localhost:5173/  "),
        Some("http://localhost:5173".to_string())
    );
    assert_eq!(
        extract_url(
            "Tomcat started on port(s): 8080 (http) with context path '' http://127.0.0.1:8080/api"
        ),
        Some("http://127.0.0.1:8080/api".to_string())
    );
    assert_eq!(
        extract_port("Tomcat started on port(s): 8080 (http)"),
        Some(8080)
    );
    assert_eq!(extract_port("Local: http://localhost:5173/"), Some(5173));
}

#[test]
fn log_parsing_ignores_unrelated_urls_and_ports() {
    assert_eq!(
        extract_url("remote api available at https://example.com/service"),
        None
    );
    assert_eq!(extract_port("management.server.port=9001"), None);
}

#[test]
fn spring_started_line_matches_standard_and_service_specific_logs() {
    assert!(is_spring_started_line(
        "Started Application in 9.234 seconds (JVM running for 10.001)",
        "CapfSealServiceApplication",
        Some("com.azt.easysign.capf.seal.service.CapfSealServiceApplication")
    ));
    assert!(is_spring_started_line(
        "Started CapfSealServiceApplication",
        "CapfSealServiceApplication",
        Some("com.azt.easysign.capf.seal.service.CapfSealServiceApplication")
    ));
    assert!(is_spring_started_line(
        "Started capf seal service",
        "Capf Seal Service",
        None
    ));
    assert!(!is_spring_started_line(
        "Starting CapfSealServiceApplication",
        "CapfSealServiceApplication",
        Some("com.azt.easysign.capf.seal.service.CapfSealServiceApplication")
    ));
}
