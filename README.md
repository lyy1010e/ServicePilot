# ServicePilot

[![Test](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/test.yml)
[![Release](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml/badge.svg)](https://github.com/lyy1010e/ServicePilot/actions/workflows/release.yml)

[中文](README.md) | [English](README.en.md)

ServicePilot 是一个面向 Windows 本地开发的桌面工作台，用来启动、停止和观察本机开发项目。它把 Spring Boot、Vue/Rust 前端开发服务放在同一个控制台里管理，重点解决多服务联调时“窗口太多、日志分散、状态不清楚”的问题。

ServicePilot 的边界很明确：它只做本地开发启动和本地进程管理，不会在启动、停止、导入或重启流程中执行 Git 操作、发布构建产物或部署到远程系统。

## 设计目标

- 让本地多服务联调更轻量：一个桌面窗口管理多个项目、分组、日志和运行状态。
- 保持启动行为可控：优先使用固定预设，受保护的自定义命令也会经过后端安全策略检查。
- 不污染用户项目：应用状态写入 ServicePilot 自己的数据目录，不为了启动服务改动用户源码或项目配置。
- 对中文开发环境友好：界面支持中英文切换，Maven、IDEA 项目和 Windows 进程管理作为一等场景处理。
- 更新体验简洁：应用可检查签名校验的更新包，有新版本时在首页版本号旁提示更新。

## 功能亮点

- 统一管理本地 `Spring Boot` 和 `Vue/Rust` 前端开发服务。
- 支持 `maven`、`java-main`、`vue-preset` 和受安全策略约束的 `custom` 启动类型。
- 单服务启动、停止、重启，以及分组批量启动/停止。
- 支持服务分组，便于按业务域或联调场景组织服务，支持拖拽排序。
- 扫描目录自动发现 Spring Boot 子项目并批量导入。
- 支持配置 JVM 参数（`-Xms`、`-Xmx` 等）和 Spring Profiles（如 `dev, local`）。
- Maven 高级选项：强制更新依赖（`-U`）、调试模式（`-e -X`）、禁用 Fork（`-Dspring-boot.run.fork=false`）。
- 实时日志流、按服务保留近期日志、日志搜索、匹配跳转和日志级别过滤。
- 可在启动或重启服务前自动清空该服务旧日志，避免新旧输出混在一起。
- 支持从 IDEA/Maven 项目读取配置，并提供”选择项目并启动”的快速入口。
- 支持全局 Maven `settings.xml` 和本地仓库路径配置。
- 从启动日志中识别端口和访问地址，方便快速打开本地服务。
- 支持中文和英文界面切换。
- Windows 上使用 Tauri 2 打包，提供托盘、窗口控制和本地进程管理能力。

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

## 如何使用

1. 启动应用后，点击”选择项目并启动”，选择一个本地 IDEA/Maven 或前端项目目录，ServicePilot 会尝试识别项目类型并创建服务。
2. 也可以点击”扫描导入”，自动扫描目录下的 Spring Boot 子项目并批量导入；或点击”新建服务”手动配置服务名称、工作目录、启动类型、命令参数、端口、JVM 参数、Profiles、环境变量等信息。
3. 在首页服务列表中启动、停止或重启服务，并查看运行状态、端口、运行时长和最近启动时间。
4. 在日志区选择服务查看实时输出，可搜索日志、过滤级别，或手动清空当前服务日志。
5. 在“分组管理”里创建分组，把相关服务放在一起批量启动或停止。
6. 在“设置”里配置 Maven `settings.xml`、本地仓库路径，以及是否在启动/重启前清空旧日志。
7. 通过右上角语言切换控件在中文和英文界面之间切换。
8. 如果检测到新版本，首页版本号旁会出现更新图标，点击后可直接更新。

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

一键发布（推荐）：

```bash
npm run release -- 1.0.4
```

该命令会自动完成：更新版本号 → 提交推送 → 打 tag → GitHub Actions 自动构建并创建 Release。

本地手动发布：

```bash
npm run release:update
```

该命令在本地构建签名安装包、生成 updater 使用的 `latest.json`，并通过 GitHub CLI 创建或更新当前版本对应的 Release。发布前需要已安装并登录 GitHub CLI（`gh auth login`），且工作区没有未提交改动。

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
