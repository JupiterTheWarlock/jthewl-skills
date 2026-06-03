---
name: r2-manage-skill
description: >
  管理 Cloudflare R2 图床文件：上传、列出、查看元信息、重命名/移动。
  Triggers: "上传图片", "图床", "R2上传", "R2管理", "查看R2文件",
  "列出图床", "重命名R2", "upload image", "image hosting",
  "list R2 files", "rename R2", "R2 info", "图床管理".
---

# R2 Manage — Cloudflare R2 文件管理

通过 S3 兼容 API 管理 Cloudflare R2 bucket 中的文件。支持上传、列出、查看元信息和重命名操作。

## 前置条件

- 全局安装 `@aws-sdk/client-s3`: `npm install -g @aws-sdk/client-s3`
- 配置 `NODE_PATH` 环境变量指向全局 node_modules
- 在 `.env` 中配置 R2 凭证（参考 `.env.example`）

## 命令一览

```bash
# 统一入口
node scripts/r2.js <command> [args...]

# 也可直接调用各命令脚本
node scripts/r2-upload.js <file> [--path <prefix>] [--name <name>] [--desc <desc>]
node scripts/r2-list.js [<prefix>] [--max <N>] [--json]
node scripts/r2-info.js <key> [--json]
node scripts/r2-rename.js <source-key> <dest-key> [--force]
node scripts/r2-gallery.js [--host <host>] [--port <N>] [--prefix <prefix>] [--max <N>] [--open]
```

## 命令详情

### upload — 上传文件

上传本地文件到 R2，返回公开 URL。

```bash
node scripts/r2.js upload <文件路径> [--path <子目录>] [--name <语义化名称>] [--desc <描述>]
```

**命名规则:** `[prefix/]YYYY/MM/DD/<name>.<ext>`
- `--name` 指定语义化名称（不含扩展名），如 `--name "blog-cover"`
- 未指定 `--name` 时使用原始文件名（sanitize 后）
- AI agent 调用时**应始终提供 `--name`**，用简短英文描述图片内容

**元数据:**
- `--desc` 写入对象的自定义元数据（x-amz-meta-description），用于详细描述图片内容
- 可通过 `info` 命令查看已存储的 description

**示例:**
```bash
node scripts/r2.js upload screenshot.png --name "vscode-terminal-error" --desc "VS Code terminal showing MODULE_NOT_FOUND error"
# ✅ 上传成功: https://cdn.example.com/2024/05/08/vscode-terminal-error.png

node scripts/r2.js upload cover.jpg --path blog --name "homepage-hero" --desc "Blog homepage hero image with gradient background"
# ✅ 上传成功: https://cdn.example.com/blog/2024/05/08/homepage-hero.jpg
```

**支持的文件类型:** png, jpg, jpeg, gif, webp, svg, bmp, ico（其他类型以 application/octet-stream 上传）

### list — 列出文件

列出 bucket 中的对象，支持按前缀/日期过滤。

```bash
node scripts/r2.js list [<prefix>] [--max <N>] [--json]
```

**参数:**
- `prefix` — 按前缀过滤，如 `blog/`、`2024/01/`
- `--max N` — 最多返回 N 个结果（默认 100）
- `--json` — 输出 JSON 格式

**示例:**
```bash
node scripts/r2.js list --max 10
node scripts/r2.js list blog/ --json
node scripts/r2.js list 2024/05/
```

### gallery — 本地预览前端

启动一个只监听本机的 Web UI，用于浏览 R2 bucket 中的图片和其他公开资产。R2 凭证只在本地 Node 服务端使用，浏览器端只接收对象 key、大小、修改时间和公开 CDN URL。

```bash
node scripts/r2.js gallery [--host 127.0.0.1] [--port 8787] [--prefix <prefix>] [--max <N>] [--open]
```

**参数:**
- `--host` — 监听地址（默认 `127.0.0.1`）
- `--port` — 监听端口（默认 `8787`）
- `--prefix` — 初始前缀过滤，如 `blog/`、`2026/06/`
- `--max` — 每次最多加载对象数（默认 100，最大 1000）
- `--open` — 启动后自动打开浏览器

**示例:**
```bash
node scripts/r2.js gallery
node scripts/r2.js gallery --prefix blog/ --max 200 --open
npm run gallery -- --prefix 2026/06/
```

前端能力：
- 按 prefix 拉取对象列表
- 按路径生成最多两层 tree view（如 `blog/essays`）
- 通过 tree 节点筛选当前加载的资产
- 按图片/非图片过滤
- 在当前结果中按 key 搜索
- 网格预览图片，非图片显示扩展名
- 复制公开 URL、打开原始文件
- 点击资产查看 HEAD 元信息（content type、description、etag 等）

**Gallery UI 约束:**
- 优先使用 tree view 表达 R2 对象路径层级；路径树默认最多展开两层，避免日期/文件名把导航撑碎。
- 尽量少用渐变；按钮、面板和状态反馈优先使用暗色底、边框、轻量 glow 和单色 accent。
- Filter 类控件使用 `jthewl-skills-hub` 同款 `FilterMenu` 模式：`.filterMenu` 外层、`.filterTrigger` 触发按钮、`.filterMenuList` 弹层、`.filterOption` 选项；用按钮 + listbox 自绘菜单，不使用原生 `<select>`，也不要用 segmented control 替代下拉菜单。

### info — 查看元信息

获取指定对象的详细元数据。

```bash
node scripts/r2.js info <key> [--json]
```

**示例:**
```bash
node scripts/r2.js info blog/2024/01/15/a3f8c2d1.png
# 📄 blog/2024/01/15/a3f8c2d1.png
#    Type:     image/png
#    Size:     2.3 MB
#    Modified: 2024-01-15 08:30:00
#    ETag:     "abc123..."
#    URL:      https://cdn.example.com/blog/2024/01/15/a3f8c2d1.png
```

### rename — 重命名/移动

通过 Copy + Delete 实现对象重命名或移动到新路径。

```bash
node scripts/r2.js rename <source-key> <dest-key> [--force]
```

**参数:**
- `--force` — 如果目标已存在，强制覆盖

**安全机制:**
- 默认检查目标路径是否已有文件，已存在则拒绝
- 复制失败时不会删除源文件

**示例:**
```bash
node scripts/r2.js rename 2024/01/15/a3f8c2d1.png blog/cover.png
# ✅ 重命名成功:
#    https://cdn.example.com/2024/01/15/a3f8c2d1.png
#    → https://cdn.example.com/blog/cover.png
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `R2_ACCOUNT_ID` | ✅ | Cloudflare Account ID |
| `R2_ACCESS_KEY` | ✅ | R2 API Token Access Key |
| `R2_SECRET_KEY` | ✅ | R2 API Token Secret Key |
| `R2_BUCKET` | ⛔ | Bucket 名称（默认: `assets`） |
| `R2_ENDPOINT` | ⛔ | S3 端点（默认从 Account ID 推导） |
| `R2_PUBLIC_URL` | ⛔ | 自定义 CDN 域名（默认: `https://pub-{accountId}.r2.dev`） |

## Agent 使用指南

当用户请求涉及图床操作时：

1. **上传图片** → 使用 `upload` 命令，返回 URL 给用户
2. **查看图床有哪些图** → 使用 `list` 加 `--json` 获取结构化列表
3. **查看某张图的信息** → 使用 `info` 加 `--json`
4. **本地预览图床资产** → 使用 `gallery` 启动预览前端，默认地址 `http://127.0.0.1:8787/`
5. **重命名/移动图片** → 使用 `rename`，注意确认源 key 存在

脚本工作目录为 skill 根目录: `.agents/skills/r2-manage-skill/`
