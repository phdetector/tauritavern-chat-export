# TauriTavern Chat Export

[中文](#中文说明) · [English](#english)

## 中文说明

**聊天导出（单文件）**是一个面向 TauriTavern / SillyTavern 兼容扩展接口的独立插件。它把当前打开的聊天导出为可阅读的 TXT 对话稿或单文件 HTML，并在真正下载之前提供预览。

### v0.1.0 功能

- 导出当前打开的聊天，不扫描历史 `.jsonl` 文件；
- 每个楼层保留全部 swipe，并标记当前选中的 swipe；
- 默认排除 `is_system === true` 的隐藏楼层；
- 仅删除独立元数据 `extra.reasoning`，正文里的 `<think>`、`<analysis>` 等文本不会被自动删除；
- TXT：包含标题、导出时间、角色名、消息时间、楼层和 swipe 标记，尽量保留段落、列表和代码块换行；
- HTML：单个自包含文件，使用宿主渲染器（不可用时使用内置 Markdown 渲染器）和插件自己的响应式 CSS；
- 图片尽量转换为 `data:` URL，无法内嵌时保留外链并添加外链标记；音频和视频不内嵌；
- 导出前预览 TXT 或 HTML；“同时导出”生成两个独立文件；
- 通过 Blob 下载，不修改聊天数组、聊天内容或酒馆设置；
- HTML 会移除脚本、事件属性、危险 URL、iframe、object、SVG 等主动内容。

### 安装

#### 方式一：TauriTavern 扩展安装入口

1. 打开 TauriTavern 的扩展管理界面。
2. 选择从 GitHub / URL 安装扩展（不同版本的文字可能略有不同）。
3. 填入仓库地址：`https://github.com/phdetector/tauritavern-chat-export`
4. 安装后刷新扩展列表或重启 TauriTavern。

#### 方式二：手动复制

1. 下载本仓库 ZIP 并解压。
2. 将仓库目录复制到 TauriTavern 当前用户的扩展目录，通常形如 `data/<用户>/extensions/tauritavern-chat-export/`。如果当前版本的安装器使用其他扩展目录，以扩展管理器显示的路径为准。
3. 确保 `manifest.json`、`index.js`、`export-core.mjs` 和 `style.css` 位于插件目录根部。
4. 在 TauriTavern 中重新加载扩展。

首版不自动安装到本机当前 TauriTavern；正式发布前后的真实安装、真实聊天导出和手机端验证应单独执行。

### 使用

1. 打开要导出的聊天。
2. 点击左下角 **导出聊天**。
3. 选择 **TXT**、**单文件 HTML** 或 **同时导出**。
4. 在预览弹窗中检查文件名、文本或渲染结果。
5. 点击 **下载** 才会生成本地文件。

导出的文件名由清理后的聊天标题和导出时间组成。HTML 文件只有一个文件，不会额外创建资源目录。

### 微信分享说明

TXT 和 HTML 都可以作为文件发送。HTML 能否在微信内直接预览取决于微信版本、系统版本和当前设备的文件处理方式；如果微信不直接渲染 HTML，可以先保存文件，再使用手机浏览器或文件应用打开。HTML 里的未能内嵌图片仍可能需要网络或原始图片地址可用。

### 支持范围与已知限制

- 首版只导出当前聊天，不提供批量聊天导出；
- 不读取或扫描历史 `.jsonl`，不访问或修改 TauriTavern 数据目录；
- 不能把模型正文中已经出现的 reasoning / `<think>` 内容可靠地判断为“独立思考字段”，因此只移除 `extra.reasoning` 等独立元数据；
- 跨域图片、需要登录态的图片和受 CSP 限制的图片可能无法转换为 `data:` URL，插件会保留外链并标记；
- 音频、视频只保留原标签或原地址，不做单文件内嵌；
- 宿主渲染器 API 在不同 TauriTavern / SillyTavern 版本间可能变化，插件提供内置 Markdown 回退渲染器；
- 真实安装和不同设备浏览器的兼容性需要在目标版本上手动确认。

### 从源码验证

要求 Node.js 20 或更高版本：

```bash
npm test
npm run check
```

本仓库没有运行时 npm 依赖。发布压缩包至少包含：

```text
manifest.json
index.js
export-core.mjs
style.css
```

## English

**TauriTavern Chat Export** is a standalone TauriTavern / SillyTavern-compatible extension that exports the currently open chat as a readable TXT transcript or a single self-contained HTML file. It always builds the export in memory and shows a preview before downloading.

### Features in v0.1.0

- Exports the current open chat only;
- Keeps every swipe grouped under its original floor and marks the selected swipe;
- Excludes `is_system === true` floors by default;
- Removes only independent `extra.reasoning` metadata; it does not rewrite `<think>` or `<analysis>` text that is part of the message body;
- Produces readable TXT with title, export time, speaker, message time, floor, and swipe markers;
- Produces one self-contained HTML file with host rendering when available and a built-in Markdown fallback;
- Attempts to inline accessible images as `data:` URLs, while marking failed inlining as external; audio and video are not inlined;
- Provides TXT/HTML preview and a two-file export option;
- Uses Blob downloads without changing chat data or Tavern settings;
- Removes scripts, event attributes, dangerous URLs, iframe/object content, and other active HTML from rendered message content.

### Installation

Use the extension installer in TauriTavern with:

```text
https://github.com/phdetector/tauritavern-chat-export
```

Alternatively, download the repository ZIP and copy its directory into the current user's TauriTavern extension directory. Keep `manifest.json`, `index.js`, `export-core.mjs`, and `style.css` at the extension root, then reload extensions.

### Scope and limitations

This first release does not batch-export chats, scan historical `.jsonl` files, save extension settings, or install itself into an existing TauriTavern installation. Only independent reasoning metadata is hidden; reasoning text that is already part of the message body is preserved. Browser and WeChat HTML preview behavior depends on the target device and application version.

### Development

```bash
npm test
npm run check
```

The project is MIT-licensed and has no runtime npm dependencies.
