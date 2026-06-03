# 小红书笔记收集工作流

## 概述

通过 `xhs-note-scraper` skill 抓取小红书公开笔记，提取结构化数据后生成博客随笔。

## 前置依赖

- `xhs-note-scraper` skill（`.agents/skills/xhs-note-scraper/`）
- `scripts/generate_essay.js`（本 skill 内置）
- `r2-manage-skill`（图片上传）

## 工作流步骤

### Step 1: 抓取笔记

```bash
node <xhs-skill-dir>/scripts/scrape_xhs_note.js "<url>" --out "<tmp-dir>"
```

URL 格式：`https://www.xiaohongshu.com/explore/<note-id>`

脚本输出到 `<tmp-dir>`：
- `note.md` — 可读 Markdown（含元数据和本地图片引用）
- `note.json` — 结构化数据
- `page.html` — 原始 HTML
- `assets/image-XX.jpg` — 下载的图片

### Step 2: 读取结构化数据

读取 `note.json`，提取关键字段：

```json
{
  "title": "笔记标题",
  "desc": "正文内容",
  "tags": ["标签1", "标签2"],
  "createdAt": "ISO时间",
  "images": [
    { "index": 1, "urlDefault": "https://...", "localPath": "assets/image-01.jpg" }
  ]
}
```

### Step 3: 构造 generate_essay.js 输入

Agent 将 note.json 数据映射为标准输入格式：

```json
{
  "title": "笔记标题（或 agent 重新拟定）",
  "date": "YYYY/MM/DD（取自 createdAt）",
  "tags": ["从 note.tags 选取 + agent 补充"],
  "source_platform": "xhs",
  "source_url": "https://www.xiaohongshu.com/explore/<note-id>",
  "segments": [
    {
      "text": "note.desc 正文内容",
      "images": [
        { "url": "<tmp-dir>/assets/image-01.jpg 的绝对路径或原始CDN URL", "name": "english-slug", "desc": "English description" }
      ]
    }
  ],
  "output_dir": ".../content/随笔/YYYY-MM-DD",
  "output_filename": "中文标题.md",
  "r2_prefix": "blog/essays",
  "upload_to_r2": true,
  "r2_skill_dir": "<project-root>/.agents/skills/r2-manage-skill"
}
```

**图片处理：** 优先使用已下载的本地文件路径（`<tmp-dir>/assets/image-XX.jpg`），generate_essay.js 会直接上传本地文件到 R2。

### Step 4: 生成随笔

```bash
node <skill-dir>/scripts/generate_essay.js input.json
```

### Step 5: 确认与清理

展示生成结果给用户确认，删除临时抓取目录。

## 正文处理规则

- 小红书笔记通常只有一个段落（desc），不需要 `---` 分隔
- 如果笔记很长或有多个话题，agent 可以适当拆分为多个 segments
- 保留原文 emoji 和话题标签

## 已知限制

- 仅支持公开笔记（需要 SSR 数据存在于 `window.__INITIAL_STATE__`）
- 部分笔记的原始分辨率图片可能返回 403，脚本会使用公开 CDN 默认尺寸
- 评论数据为动态加载，不保证可获取
- PowerShell 管道可能导致 UTF-8 中文显示异常，以脚本写入的文件为准
