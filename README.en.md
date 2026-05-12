# ServicePilot

[![Test](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml)
[![Release](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml)

[中文](README.md) | [English](README.en.md)

ServicePilot is a Windows-first desktop workbench for starting, stopping, and observing local development projects. It keeps Spring Boot and Vue/Rust frontend dev services in one console, so local multi-service debugging does not have to be split across many terminals and scattered logs.

ServicePilot has a strict local-development boundary: launch, stop, import, and restart flows must not run Git operations, publish artifacts, or deploy anything to remote systems.

## Design Goals

- Make local multi-service debugging lighter: one desktop window for services, groups, logs, and runtime state.
- Keep launches predictable: prefer built-in presets, and validate guarded custom commands in the backend.
- Avoid mutating user projects: app-owned state is stored in ServicePilot's own data directory, not in source-controlled project files.
- Work well for Chinese and English development environments: the UI can switch languages, and Maven, IDEA projects, and Windows process management are first-class scenarios.
- Keep updates simple: signed updater packages can be checked and applied from the version badge when a new version is available.

## Highlights

- Manage local `Spring Boot` and `Vue/Rust` frontend dev services in one desktop app.
- Support `maven`, `java-main`, `vue-preset`, and guarded `custom` launch types.
- Start, stop, and restart single services, plus batch start/stop by group.
- Organize related services into groups for domain-based or debugging-session workflows, with drag-to-reorder support.
- Scan a directory to auto-discover Spring Boot sub-projects and batch import them.
- Configure JVM arguments (`-Xms`, `-Xmx`, etc.) and Spring Profiles (e.g. `dev, local`).
- Maven advanced options: force dependency refresh (`-U`), debug mode (`-e -X`), disable fork (`-Dspring-boot.run.fork=false`).
- Stream real-time logs, keep recent logs per service, search logs, jump between matches, and filter by log level.
- Optionally clear a service's old logs before starting or restarting it.
- Read IDEA/Maven project settings and provide a quick "select project and start" flow.
- Configure global Maven `settings.xml` and local repository paths.
- Detect ports and access URLs from startup logs.
- Switch the app UI between Chinese and English.
- Package with Tauri 2 on Windows, including tray support, custom window controls, and local process management.

## Safety Boundary

ServicePilot launch flows are only for local development.

Allowed startup examples:

- `mvn spring-boot:run`
- `mvn -DskipTests compile dependency:build-classpath`
- `java -cp ... com.example.Application`
- `npm run dev`
- `pnpm dev`

Launch, stop, import, and restart flows should not run:

- Git operations such as `git push`, `git pull`, or `git commit`
- Maven `install`, `deploy`, release goals, or Gradle publish/release tasks
- Package install, version, or publish commands such as `npm install`, `npm publish`, `npm version`, or `pnpm add`
- Remote deployment or mutation commands such as `kubectl`, `helm`, `ssh`, `scp`, or `rsync`
- Registry publish or login commands such as `docker push` or `docker login`

## How To Use

1. Start the app and click "Select Project & Start". Pick a local IDEA/Maven or frontend project directory, and ServicePilot will try to detect the project type and create a service.
2. Or click "Scan & Import" to auto-discover Spring Boot sub-projects in a directory and batch import them. You can also click "Add Service" to manually configure the service name, working directory, launch type, arguments, port, JVM arguments, Profiles, environment variables, and related fields.
3. Use the home service list to start, stop, or restart services, and monitor status, port, runtime, and last start time.
4. Select a service in the log panel to view real-time output, search logs, filter levels, or clear the current service log manually.
5. Use "Group Workspace" to create groups and batch start or stop related services.
6. Use Settings to configure Maven `settings.xml`, the local repository path, and whether old logs should be cleared before start/restart.
7. Use the language switch in the top-right corner to switch between Chinese and English.
8. When a signed update is available, an update icon appears next to the version badge on the home screen.

## Local Development

### Requirements

- Node.js
- Rust toolchain with Cargo
- Windows WebView2 Runtime

### Common Scripts

```bash
npm install
npm run dev
npm run lint
npm run test:unit
npm run test:rust
npm run test
npm run build:renderer
npm run build
```

### Publish Updates

One-command release (recommended):

```bash
npm run release -- 1.0.4
```

This automatically: updates version numbers → commits and pushes → creates a tag → GitHub Actions builds and creates the Release.

Local manual release:

```bash
npm run release:update
```

This builds signed installer artifacts locally, generates the updater `latest.json`, and creates or updates the GitHub Release via GitHub CLI. Requires GitHub CLI authenticated (`gh auth login`) and a clean working tree.

Signing key setup: create a local `.env.release.local` file (ignored by `.gitignore`):

```ini
TAURI_SIGNING_PRIVATE_KEY_FILE=secrets/tauri-signing.key
# If the key has a password:
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-password
```

## Tech Stack

- Desktop host: `Tauri 2`
- Frontend: `React 19 + TypeScript + Vite 7`
- Backend: `Rust + Tokio`
- Tests: `Vitest` and Rust unit tests

## Data And Limits

- Local app state is persisted under the application data directory as `service-pilot-state.json`.
- Runtime log history is kept in memory and capped per service.
- The backend is currently optimized for Windows process management semantics.

