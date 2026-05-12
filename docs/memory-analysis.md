# ServicePilot 内存占用分析报告

## 前端内存问题

### 1. 每秒强制全组件重渲染 ✅ 已修复

**位置**: `src/renderer/App.tsx:1644`

当有活跃服务时，`setNow(Date.now())` 每秒触发一次，而 `App` 是一个巨型单文件组件（5000+ 行），每次 `now` 变化都会导致整个组件树重新渲染。`now` 只用于 `formatDuration(runtime, now)` 一个地方（第 3113 行），但代价是全量 re-render。

**修复**: 新建 `ServiceRuntimeDuration` memo 组件，内部管理自己的 1 秒定时器，仅该组件每秒重渲染。

### 2. logsByService 无限累积 ✅ 已修复

**位置**: `src/renderer/App.tsx:1540`

`logsByService` 存储所有曾经查看过的服务的日志。切换服务时从后端加载历史日志（第 1829-1835 行），但切换离开后从不清理旧服务的日志。如果用户查看过 N 个服务，每个服务最多 2000 条日志，就会一直驻留内存。

**修复**: 新增 `useEffect` 监听 `selectedLogServiceId` 变化，切换时清理非当前服务的日志条目。

### 3. 日志条目合并产生大量临时对象 ⚪ 已知限制

**位置**: `src/renderer/App.tsx:1167-1183`

`mergeLogEntries` 每次都创建新的数组拷贝（`[...entries.slice(0, -1), entry].slice(-2000)`），高频日志输出时产生 GC 压力。

**说明**: 在 React 不可变更新模式下无法完全避免（`setLogsByService` 需要新引用触发 re-render）。实际影响远小于 #1，GC 可正常回收。

---

## 后端内存问题

### 4. emit_snapshot 频率过高且全量序列化 ✅ 已修复

**位置**: `src-tauri/src/lib.rs:1886-1889`

`emit_snapshot()` 每次都 clone 整个 `AppSnapshot`（services + groups + runtime + settings），并序列化为 JSON 发送。该函数在代码中被调用了 25+ 次，包括：

- 每条日志的 `detect_access_info` 和 `detect_failure_summary` 都可能触发 snapshot 发送
- 日志流式输出时，`emit_snapshot` 与 `emit("log:entry")` 同时发送，造成双重 IPC 开销

**修复**: `emit_snapshot` 增加 50ms 节流，连续请求被合并。

### 5. log_history 的 text 字段可无限增长 ✅ 已修复

**位置**: `src-tauri/src/lib.rs:1921-1923`

合并日志行时，`previous.text.push_str(&entry.text)` 直接追加，没有限制单条日志文本大小。虽然前端有 100KB 限制（`MAX_MERGE_TEXT_LENGTH`），但后端没有这个限制，单条合并日志可能无限增长。

**修复**: 后端新增 `MAX_MERGE_TEXT_LENGTH`（100KB）常量，合并时超过限制截断头部。

### 6. 进程 stdout/stderr 读取缓冲区 ⚪ 设计如此

**位置**: `src-tauri/src/lib.rs:1400-1420`

每个启动的服务产生 3 个独立的异步任务（stdout reader、stderr reader、exit watcher），每个任务持有 `ServicePilotBackend` 的 clone（包含 `Arc`），且 `Vec::new()` 缓冲区虽有 `bytes.clear()`，但 Tokio 的 `BufReader` 内部也有 8KB 默认缓冲区。

**说明**: 这是 Tokio 进程管理的正常开销，每个进程需要独立的读取任务以实现非阻塞流式处理。

### 7. 没有清理 launch-cache 目录 ✅ 已修复

**位置**: `src-tauri/src/lib.rs:1043-1047`

`app_cache_dir().join("launch-cache")` 写入缓存文件，但代码中没有任何清理逻辑，缓存文件会随时间累积。

**修复**: `shutdown` 方法末尾增加 `fs::remove_dir_all("launch-cache")` 清理。
