# X/Twitter 推文收集工作流

## 概述

通过 `opencli twitter` 获取推文数据，使用 `thread_x.js` 脚本检测线程结构，最终生成博客随笔。

## 前置依赖

- `opencli` CLI（系统 PATH 已安装，使用浏览器桥接）
- `scripts/thread_x.js`（本 skill 内置）
- `scripts/generate_essay.js`（本 skill 内置）
- `r2-manage-skill`（图片上传）

## 工作流步骤

### Step 1: 获取推文

```bash
opencli twitter tweets JupiterTheWL --limit <N> -f json
```

将输出保存为临时文件（如 `tmp_tweets.json`）。

**输出字段：** id, author, created_at, is_retweet, text, likes, retweets, replies, views, url, has_media, media_urls

### Step 2: 检测线程

```bash
node <skill-dir>/scripts/thread_x.js tmp_tweets.json [--window 10]
```

脚本基于时间窗口启发式检测自回复线程：
- 同一作者、前后推文间隔 ≤ 10 分钟则归为同一线程
- 输出到 stdout：`threads[]`（2+ 条连续推文）和 `standalone[]`（独立推文）

**注意：** 该启发式有已知局限——间隔 >10 分钟但内容相关的推文会被拆分。Agent 应在展示结果时审查，必要时手动合并。

### Step 3: 展示结果供用户选择

向用户展示检测到的线程和独立推文列表：

```
线程 1 [4条, 12.2min]: ai将极大程度的降低小体量/jam游戏的α demo实现成本...
线程 2 [2条, 7.2min]: 我试用了一下我们公司近期给全员报销的Qoder...
独立 1: unity ai进入开放测试了...
独立 2: 不知道是不是只有我有这个问题...
```

用户选择要归档的条目。

### Step 4: 构造 generate_essay.js 输入

Agent 根据选中的线程/推文，构造 JSON 输入：

```json
{
  "title": "agent根据内容拟定的标题",
  "date": "YYYY/MM/DD（取自root推文的created_at）",
  "tags": ["agent根据内容分析的2-4个标签"],
  "source_platform": "x",
  "source_url": "root推文的url",
  "segments": [
    {
      "text": "推文正文（清理后）",
      "images": [
        { "url": "https://pbs.twimg.com/...", "name": "english-slug", "desc": "English only description" }
      ]
    }
  ],
  "output_dir": ".../content/随笔",
  "output_filename": "YY-MM-DD-中文标题.md",
  "r2_prefix": "blog/essays",
  "upload_to_r2": true,
  "r2_skill_dir": "<project-root>/.agents/skills/r2-manage-skill"
}
```

### Step 5: 生成随笔

```bash
node <skill-dir>/scripts/generate_essay.js input.json
```

预览模式：

```bash
node <skill-dir>/scripts/generate_essay.js input.json --dry-run
```

### Step 6: 确认与清理

展示生成结果给用户确认，删除临时文件。

## 批量模式

1. 获取较多推文（`--limit 50` 或更多）
2. 运行线程检测
3. 展示全部线程和独立推文，用户多选
4. 对每个选中的条目依次执行 Step 4-6
5. 汇报完成情况

## 正文处理规则

- `t.co` 短链接：如果是推文自身的媒体链接，直接删除；如果指向外部资源，保留上下文说明
- 保留原文的换行结构
- emoji 保留原样

## 已知限制

- opencli twitter API 不返回 `in_reply_to` 字段，线程检测纯靠时间窗口推断
- 浏览器桥接需要本地浏览器处于活跃状态
- 每次 fetch 有数量上限，超大量推文需分批获取
