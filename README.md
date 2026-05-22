# ServicePilot

[![Test](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml)
[![Release](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml)

[中文](README.md) | [English](README.en.md)

ServicePilot 是一个面向 Windows 本地开发的桌面工作台，用来启动、停止和观察本地开发项目。它把 Spring Boot、前端和 Rust 开发服务放在同一个控制台里管理，重点解决多服务联调时“窗口太多、日志分散、状态不清楚”的问题。

它还有一个很现实的目标：减少为了看配置、启动服务、观察日志而同时打开多个 IDEA 窗口的需要。对于大型 Java/Spring 项目，这可以明显降低内存占用，让联调工作更多发生在一个轻量桌面控制台里。

ServicePilot 的边界很明确：它只做本地开发启动和本地进程管理，不会在启动、停止、导入或重启流程中执行 Git 操作、发布构建产物或部署到远程系统。

## 功能亮点

- 统一管理本地 Spring Boot、前端和 Rust 开发服务，支持 `maven`、`java-main`、`vue-preset`、`cargo-run` 和受安全策略约束的 `custom` 启动类型。
- 单服务启动、停止、重启，支持服务分组、成员管理和批量启停。
- 选择项目目录后自动识别类型，支持 Spring Boot、前端、Rust 项目；多模块项目可扫描子项目并批量导入。
- 支持从 IDEA/Maven 项目读取配置，减少反复打开多个 IDEA 窗口查启动配置的成本。
- 支持 JVM 参数、Spring Profiles、Maven 高级选项和全局 Maven 配置。
- 实时日志流、日志搜索、级别过滤、后端日志清理，并支持启动或重启前自动清空旧日志。
- 从启动日志中识别端口和访问地址，支持中英文界面切换。
- Windows 上使用 Tauri 2 打包，提供托盘和窗口控制。

## 如何使用

1. 新建服务，选择项目目录后 ServicePilot 自动识别类型并创建服务；多模块项目会扫描子项目供批量导入。
2. 在首页启动、停止、重启服务，查看日志和运行状态。
3. 使用分组管理常用联调组合，并对一组服务执行批量启动或停止。
4. 在“设置”中配置全局 Maven `settings.xml`、本地仓库路径和日志策略。

## 安全边界

ServicePilot 的启动流程只允许本地开发用途。

允许的启动形态示例：

- `mvn spring-boot:run`
- `mvn -DskipTests compile dependency:build-classpath`
- `java -cp ... com.example.Application`
- `npm run dev`
- `pnpm dev`

启动、停止、导入、重启等流程不应执行这些操作：

- Git 操作，例如 `git push`、`git pull`、`git commit`
- Maven `install`、`deploy`、release 相关目标，或 Gradle publish/release 任务
- 包管理器安装、版本变更或发布命令，例如 `npm install`、`npm publish`、`npm version`、`pnpm add`
- 远程部署或远程变更命令，例如 `kubectl`、`helm`、`ssh`、`scp`、`rsync`
- 注册表发布或登录命令，例如 `docker push`、`docker login`

## 架构边界

ServicePilot 已按领域拆分前后端模块，不再保留旧的扁平 API 兼容层。

前端 API 按 namespace 暴露：`app`、`services`、`groups`、`logs`、`settings`、`dialog`、`window`、`events`。新增功能也应该拥有自己的前端 API namespace 和 feature 目录。

后端 Rust 按职责拆分：

- `commands`：Tauri command adapter，只做参数转换和委托
- `app`：Tauri 启动壳、托盘、退出流程
- `models`：DTO 和状态模型
- `store`：内存状态、快照和持久化
- `services`：服务 CRUD、导入、扫描
- `runtime`：进程生命周期、启动/停止/重启
- `groups`：分组领域逻辑
- `logs`：日志领域逻辑
- `settings`：系统设置、导入导出
- `runtime_support`、`log_parsing`、`idea_support`、`frontend_support`、`service_detection`、`common`：领域支撑函数

新模块不能继续堆进 `App.tsx` 或 `lib.rs`；必须有明确的前端 feature/API 边界和后端 command/domain 文件。

## 设计目标

- 让本地多服务联调更轻量：一个桌面窗口管理多个项目、分组、日志和运行状态。
- 降低开发机内存压力：减少同时打开多个 IDEA 实例来启动服务或观察配置的需求。
- 保持启动行为可控：优先使用固定预设，受保护的自定义命令也会经过后端安全策略检查。
- 不污染用户项目：应用状态写入 ServicePilot 自己的数据目录，不为了启动服务改动用户源码或项目配置。
- 对中文开发环境友好：界面支持中英文切换，Maven、IDEA 项目和 Windows 进程管理作为一等场景处理。
- 更新体验简洁：应用可检查签名校验的更新包，有新版本时在首页版本号旁提示更新。

## 本地开发

### 环境要求

- Node.js
- Rust toolchain 和 Cargo
- Windows WebView2 Runtime

### 常用脚本

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

### 发布更新

一键发布：

```bash
npm run release -- 1.0.4
```

发布前建议先创建对应版本的更新说明，例如 `docs/releases/v1.0.4.md`。发布说明会自动写入 updater 使用的 `latest.json`，并作为 GitHub Release 正文展示。

本地手动发布：

```bash
npm run release:update
```

该命令会在本地构建签名安装包、生成 updater 使用的 `latest.json`，并通过 GitHub CLI 创建或更新当前版本对应的 Release。发布前需要已安装并登录 GitHub CLI（`gh auth login`），且工作区没有未提交改动。

如需指定非默认路径的发布说明：

```bash
npm run release:update -- --notes-file docs/releases/v1.0.4.md
```

签名密钥配置：推荐创建本地文件 `.env.release.local`（已被 `.gitignore` 忽略）：

```ini
TAURI_SIGNING_PRIVATE_KEY_FILE=secrets/tauri-signing.key
# 如果私钥有密码：
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-password
```

## 技术栈

- Desktop host: `Tauri 2`
- Frontend: `React 19 + TypeScript + Vite 7`
- Backend: `Rust + Tokio`
- Tests: `Vitest` 和 Rust unit tests

## 数据与限制

- 应用本地状态保存在应用数据目录下的 `service-pilot-state.json`。
- 运行日志历史保存在内存中，并按服务限制保留数量。
- 当前后端主要针对 Windows 进程管理语义优化。
