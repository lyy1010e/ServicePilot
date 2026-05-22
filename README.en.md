# ServicePilot

[![Test](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml)
[![Release](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml)

[中文](README.md) | [English](README.en.md)

ServicePilot is a Windows-first desktop workbench for starting, stopping, and observing local development projects. It keeps Spring Boot, frontend, and Rust dev services in one console, so local multi-service debugging does not have to be split across many terminals, scattered logs, and unclear runtime states.

It also solves a very practical problem: reducing the need to keep multiple IDEA windows open just to inspect configurations, launch services, or watch logs. For large Java/Spring projects, that can meaningfully reduce memory pressure and keep daily debugging inside a lighter desktop console.

ServicePilot has a strict local-development boundary: launch, stop, import, and restart flows must not run Git operations, publish artifacts, or deploy anything to remote systems.

## Highlights

- Manage local Spring Boot, frontend, and Rust dev services in one app, with `maven`, `java-main`, `vue-preset`, `cargo-run`, and guarded `custom` launch types.
- Start, stop, and restart single services, with service groups, membership management, and batch operations.
- Select a project directory to auto-detect Spring Boot, frontend, or Rust projects; multi-module projects are scanned for batch import.
- Read IDEA/Maven project configuration to reduce the need to open several IDEA windows for launch details.
- JVM arguments, Spring Profiles, Maven advanced options, and global Maven config.
- Real-time log streaming, search, level filtering, backend log clearing, and optional auto-clear before startup or restart.
- Detect ports and access URLs from startup logs, with Chinese/English UI support.
- Packaged with Tauri 2 on Windows, with tray and window controls.

## How To Use

1. Add a service by selecting a project directory. ServicePilot auto-detects the type and creates the service; multi-module projects are scanned for batch import.
2. Start, stop, restart, and view logs from the home screen.
3. Use groups to manage common debugging sets and batch start or stop related services.
4. Configure global Maven `settings.xml`, local repository paths, and log behavior in Settings.

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

## Architecture Boundaries

ServicePilot is split by frontend and backend domains, with no compatibility layer for the old flat API.

The frontend API is exposed by namespace: `app`, `services`, `groups`, `logs`, `settings`, `dialog`, `window`, and `events`. New features should also get their own frontend API namespace and feature folder.

The Rust backend is split by responsibility:

- `commands`: Tauri command adapter; argument mapping and delegation only
- `app`: Tauri shell, tray, and exit flow
- `models`: DTOs and state models
- `store`: in-memory state, snapshots, and persistence
- `services`: service CRUD, import, and scanning
- `runtime`: process lifecycle, start, stop, and restart
- `groups`: group domain logic
- `logs`: log domain logic
- `settings`: system settings, import, and export
- `runtime_support`, `log_parsing`, `idea_support`, `frontend_support`, `service_detection`, and `common`: domain support helpers

New modules should not be added back into `App.tsx` or `lib.rs`; they need explicit frontend feature/API boundaries and backend command/domain files.

## Design Goals

- Make local multi-service debugging lighter: one desktop window for services, groups, logs, and runtime state.
- Reduce development-machine memory pressure: avoid opening multiple IDEA instances just to launch services or inspect configuration.
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

One-command release:

```bash
npm run release -- 1.0.4
```

Before publishing, create matching release notes such as `docs/releases/v1.0.4.md`. The notes are written into the updater `latest.json` and used as the GitHub Release body.

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
