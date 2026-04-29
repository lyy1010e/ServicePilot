# ServicePilot

[中文](README.md) | [English](README.en.md)

ServicePilot is a Windows-first desktop workbench for local development startup and process observation. It manages local development projects and services from one desktop console.

ServicePilot is intentionally scoped to local development. It does not deploy, publish, or run source-control operations as part of launch, stop, import, or restart flows.

## Features

- Manage multiple local development projects and services in one desktop app
- Provide built-in presets for common local startup scenarios such as `Spring Boot`, Java Main, Maven projects, and frontend dev servers
- Support `maven`, `java-main`, `vue-preset`, and guarded `custom` launch types
- Start, stop, and restart single services
- Create service groups and start or stop them in batches
- Stream real-time logs and keep recent in-memory log history per service
- Search logs with match count, previous/next navigation, current-match focus, and log-level filtering
- Configure global Maven `settings.xml` and local repository paths
- Clear a service's old logs before restart; enabled by default
- Import local IDEA/Maven project settings and import/export app-owned configuration
- Detect local ports and access URLs from startup logs
- Switch the app UI between Chinese and English
- Use native file and folder pickers for path selection

## Local-Only Safety Boundary

ServicePilot launch flows are only for local development.

Allowed startup examples:

- `mvn spring-boot:run`
- `mvn -DskipTests compile dependency:build-classpath`
- `java -cp ... com.example.Application`
- `npm run dev`
- `pnpm dev`

Commands that should not run during launch, stop, import, or restart flows:

- Git operations such as `git push`, `git pull`, or `git commit`
- Maven `install`, `deploy`, release goals, or Gradle publish/release tasks
- Package mutation or publishing commands such as `npm install`, `npm publish`, `npm version`, or `pnpm add`
- Remote deployment or mutation commands such as `kubectl`, `helm`, `ssh`, `scp`, `rsync`, or `docker push`

App-owned state is written to the application data directory, not to user project source files.

## Tech Stack

- Desktop host: `Tauri 2`
- Frontend: `React 19 + TypeScript + Vite 7`
- Desktop backend: `Rust + Tokio`

## Local Requirements

- `Node.js`
- `Rust` toolchain with `cargo`
- WebView2 Runtime on Windows

## Development Scripts

```bash
npm install
npm run lint
npm run build:renderer
npm run dev
npm run build
```

## Settings

- Maven Settings: global `settings.xml` path reused by Maven preset services
- Local Repository: global Maven local repository override
- Clear logs on restart: enabled by default; clears that service's old logs before writing new stop/start output

## Notes

- Local state is persisted under the app data directory as `service-pilot-state.json`
- Runtime log history is kept in memory and capped per service
- The desktop backend is currently optimized for Windows process management semantics
