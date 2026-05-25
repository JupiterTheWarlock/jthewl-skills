---
name: git-sync
description: 通用 Git 仓库同步治理 skill，用于让当前仓库、其子模块、以及当前仓库目录下的独立 Git 仓库尽可能与远端对齐。适用于 /git-sync、同步仓库、同步子模块、提交并推送、处理 Git 冲突等请求。
---

# Git Sync

## 核心目标

一次 `/git-sync` 尽可能完成三类仓库的拉取、提交和推送，让本地与远端基本对齐：

- 当前主仓库
- 当前主仓库声明的 git submodules
- 当前主仓库根目录下的独立 Git 仓库

这是通用 skill，不包含任何项目特化逻辑、白名单逻辑或硬编码仓库名。

## 工作模型

脚本采用两阶段模式：

1. 阶段 1：发现仓库、fetch 远端、检查本地改动；没有本地改动的仓库会尝试 `pull --rebase --autostash` 和 `push`。
2. 阶段 2：AI 根据阶段 1 输出，为每个有改动的仓库分别写 commit message；脚本逐仓库 `add`、`commit`、`pull --rebase --autostash`、`push`。

阶段 1 不会自动暂存文件。阶段 2 才会暂存并提交。

## 标准流程

### 1. 执行阶段 1

```bash
.agents/skills/git-sync/git-sync.sh
```

退出码含义：

| 退出码 | 含义 | 下一步 |
|---|---|---|
| 0 | 有仓库需要提交 | 阅读每个仓库的状态和摘要，填写提交信息文件 |
| 1 | 无本地改动，已尽量同步 | 直接向用户汇报结果 |
| 2 | 检测到冲突 | 停止自动流程，手动解决冲突 |

如只需要检查发现逻辑或当前状态，不希望触发远端同步，可使用：

```bash
.agents/skills/git-sync/git-sync.sh --status-only
```

### 2. 为每个仓库分别写提交信息

阶段 1 会输出一个 `messages.template.tsv` 路径。格式固定为：

```text
repo<TAB>commit message
```

示例：

```text
github-readme	更新 GitHub 主页内容
personal-website	调整个人网站展示信息
.	更新子模块引用
```

要求：

- 每个仓库单独写提交信息，不要把所有仓库共用同一句。
- 使用中文。
- 简洁说明本仓库做了什么。
- 不添加 `Co-Authored-By:`。

### 3. 执行阶段 2

```bash
.agents/skills/git-sync/git-sync.sh --continue-file "<messages.template.tsv 路径>"
```

旧用法仍可用，但只用于临时兼容，不作为默认流程：

```bash
.agents/skills/git-sync/git-sync.sh --continue "所有仓库共用的提交信息"
```

## 冲突处理

脚本检测到冲突时会输出冲突文件列表并返回退出码 2。此时不要继续自动提交。

处理方式：

```bash
git diff --name-only --diff-filter=U
git add <冲突文件>
git rebase --continue
git push
```

如果多个仓库发生冲突，先处理脚本当前提示的仓库，再重新运行 `/git-sync`。

## 安全约束

禁止在此 skill 中执行：

- `git reset --hard`
- `git push --force`
- `git clean -fd`
- `git checkout --theirs`
- `git checkout --ours`

主仓库根目录下的独立 Git 仓库会被当作独立仓库处理，不会被主仓库 `git add -A` 收进去。

## 附属文件

| 文件 | 说明 |
|---|---|
| `git-sync.sh` | 通用多仓库同步脚本 |
