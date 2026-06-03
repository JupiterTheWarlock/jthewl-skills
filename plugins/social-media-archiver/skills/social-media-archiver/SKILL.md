---
name: social-media-archiver
description: >
  收集 X/Twitter 和小红书的公开社交内容，整理为博客随笔。
  当用户请求归档、整理、收集社交媒体上发布的内容时触发。
  Triggers: "归档推文", "整理推特", "推文收集", "归档小红书",
  "社媒归档", "收集公域内容", "帮我整理最近发的推",
  "把这条小红书发到博客", "archive tweets", "tweet to blog",
  "收集", "公域内容", "推文转随笔"
---

# Social Media Archiver — 公域内容收集

将公域社交媒体上的零散公开内容收集、整理为博客随笔（Quartz Markdown）。

## Core Rule

1. **只处理用户自己的公开内容**（X: @JupiterTheWL, XHS: 术士木星）
2. **生成后须用户确认**再写入博客目录，不可静默发布
3. **图片上传至 R2 CDN**，不保留本地副本
4. **不修改已有随笔**，只新增

## 支持平台与工作流

| 平台 | 工作流文档 | 核心工具 |
|------|-----------|---------|
| X/Twitter | [references/workflow-x.md](references/workflow-x.md) | `opencli twitter` + `thread_x.js` |
| 小红书 | [references/workflow-xhs.md](references/workflow-xhs.md) | `xhs-note-scraper` |

根据用户请求的平台，阅读对应的工作流文档执行操作。

## 共享依赖

| 工具 | 位置 | 用途 |
|------|------|------|
| `r2-manage-skill` | `.agents/skills/r2-manage-skill/` | 上传图片到 CDN |
| `generate_essay.js` | 本 skill `scripts/` | 统一的 Markdown 生成 |

## 输出路径约定

```
jthewl-blog/content/随笔/{YY-MM-DD}-{中文标题}.md
```

- 所有随笔平铺在 `随笔/` 目录下，不按日期建子目录
- 文件名格式为 `日期前缀-标题`，日期取 `YY-MM-DD`（短年份）
- 日期取原帖发布日期（非收集日期）
- 文件名为纯中文标题（可含英文/数字），与 frontmatter title 一致

## 编辑规范

### 标题

- Agent 根据内容语义拟定，不机械截取首句
- 应简洁有力，通常 10-25 字
- 示例：`AI将极大降低Jam游戏的demo实现成本`、`对比Qoder与Cursor-Tab的体验`

### 标签 (Tags)

- 2-4 个标签
- 使用中文标签为主，专有名词保持原文
- 常用标签参考：`AI`、`游戏开发`、`工具`、`思考`、`独立游戏`、`模型`

### 图片命名

- `--name` 必须为英文 kebab-case slug（如 `ai-jam-demo-1`）
- `--desc` 必须为纯 ASCII 英文（中文会导致 R2 的 HTTP header 报错）
- 命名应语义化，描述图片内容

### 正文处理

- `t.co` 短链接：如果指向外部资源，保留上下文说明；如果是推文自身的媒体链接，直接删除
- 保留原文的换行结构
- 线程内各条推文以 `---` 分隔
- emoji 保留原样

## generate_essay.js 输入格式

所有平台的工作流最终都汇聚到 `generate_essay.js`，使用统一的输入格式：

```json
{
  "title": "文章标题",
  "date": "YYYY/MM/DD",
  "tags": ["标签1", "标签2"],
  "source_platform": "x | xhs | ...",
  "source_url": "原文链接",
  "segments": [
    {
      "text": "段落正文",
      "images": [
        { "url": "图片URL或本地路径", "name": "english-slug", "desc": "English description" }
      ]
    }
  ],
  "output_dir": "输出目录绝对路径（随笔/ 目录）",
  "output_filename": "YY-MM-DD-中文标题.md",
  "r2_prefix": "blog/essays",
  "upload_to_r2": true,
  "r2_skill_dir": "<project-root>/.agents/skills/r2-manage-skill"
}
```

## 脚本参考

```bash
# X 推文线程检测
node scripts/thread_x.js <tweets.json> [--window 10]

# 生成随笔（含图片下载和 R2 上传）
node scripts/generate_essay.js <input.json>

# 预览模式（不写入文件）
node scripts/generate_essay.js <input.json> --dry-run
```

## 自检清单

Agent 生成随笔后应自行检查：

- [ ] frontmatter `date` 是原帖日期而非今天
- [ ] 所有 `---` 分隔符存在于线程段落之间
- [ ] 所有图片 URL 可访问（R2 CDN 链接）
- [ ] `原文链接：[平台名](url)` 在文末
- [ ] 无残留的 `https://t.co/...` 链接
- [ ] tags 数量 2-4 个且与内容相关
- [ ] 文件名与 frontmatter title 一致

## 扩展新平台

添加新的社交平台收集支持：

1. 在 `references/` 下新建 `workflow-<platform>.md`
2. 文档中定义：前置依赖、工作流步骤、平台特殊处理规则
3. 在本文件「支持平台与工作流」表格中添加一行
4. 确保最终输出都走 `generate_essay.js` 的统一输入格式
