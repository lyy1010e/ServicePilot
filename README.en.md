# ServicePilot

[![Test](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml)
[![Release](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml)

[中文](README.md) | [English](README.en.md)

ServicePilot is a Windows-first desktop workbench for starting, stopping, and observing local development projects. It keeps Spring Boot and Vue/Rust frontend dev services in one console, so local multi-service debugging does not have to be split across many terminals and scattered logs.

ServicePilot has a strict local-development boundary: launch, stop, import, and restart flows must not run Git operations, publish artifacts, or deploy anything to remote systems.

## Highlights

- Manage local Spring Boot, frontend, and Rust dev services in one app, with `maven`, `java-main`, `vue-preset`, `cargo-run`, and guarded `custom` launch types.
- Start, stop, and restart single services, with groups and batch operations.
- Select a project directory to auto-detect type (Spring Boot, frontend, Rust) and create services; multi-module projects are scanned for batch import.
- JVM arguments, Spring Profiles, Maven advanced options (force refresh, debug mode, disable fork), and global Maven config.
- Real-time log streaming, search, level filtering, with optional auto-clear before restart.
- Detect ports and access URLs from startup logs, with Chinese/English UI support.
- Packaged with Tauri 2 on Windows, with tray and window controls.

## How To Use

1. Add a service by selecting a project directory — ServicePilot auto-detects the type (Spring Boot, frontend, Rust) and creates the service; multi-module projects are scanned for batch import.
2. Start, stop, and view logs from the home screen, with batch operations via groups.
3. Configure global Maven `settings.xml`, local repository paths, and other options in Settings.

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

## Design Goals

- Make local multi-service debugging lighter: one desktop window for services, groups, logs, and runtime state.
- Keep launches predictable: prefer built-in presets, and validate guarded custom commands in the backend.
- Avoid mutating user projects: app-owned state is stored in ServicePilot's own data directory, not in source-controlled project files.
- Work well for Chinese and English development environments: the UI can switch languages, and Maven, IDEA projects, and Windows process management are first-class scenarios.
- Keep updates simple: signed updater packages can be checked and applied from the version badge when a new version is available.

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

Before publishing, create matching release notes such as `docs/releases/v1.0.4.md`. The notes are written into the updater `latest.json` and used as the GitHub Release body. List new feature points concretely; page and style refinements can be summarized.

This automatically: updates version numbers → commits and pushes → creates a tag → GitHub Actions builds and creates the Release. If `docs/releases/v1.0.4.md` exists, it is committed too.

Local manual release:

```bash
npm run release:update
```

This builds signed installer artifacts locally, generates the updater `latest.json`, and creates or updates the GitHub Release via GitHub CLI. Requires GitHub CLI authenticated (`gh auth login`) and a clean working tree.

To use a non-default release notes path:

```bash
npm run release:update -- --notes-file docs/releases/v1.0.4.md
```

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

