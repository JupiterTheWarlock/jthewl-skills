#!/usr/bin/env bash
# Generic multi-repository Git sync helper.
#
# Usage:
#   ./git-sync.sh
#   ./git-sync.sh --continue-file /path/to/messages.tsv
#   ./git-sync.sh --continue "message shared by all changed repos"
#
# Exit codes:
#   0 - sync completed, or phase 1 found changes requiring commit messages
#   1 - phase 1 found no changes after syncing clean repos, or usage/runtime error
#   2 - conflict detected and manual resolution is required

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
STATE_KEY="$(printf '%s' "$MAIN_REPO" | cksum | awk '{print $1}')"
STATE_DIR="${TMPDIR:-/tmp}/git-sync-$STATE_KEY"
STATE_FILE="$STATE_DIR/state.tsv"
MESSAGE_TEMPLATE="$STATE_DIR/messages.template.tsv"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$STATE_DIR"

say() {
    printf '%b\n' "$*"
}

repo_label() {
    local repo="$1"
    if [[ "$repo" == "." ]]; then
        printf '主仓库'
    else
        printf '%s' "$repo"
    fi
}

repo_path() {
    local repo="$1"
    if [[ "$repo" == "." ]]; then
        printf '%s' "$MAIN_REPO"
    else
        printf '%s/%s' "$MAIN_REPO" "$repo"
    fi
}

is_git_repo() {
    git -C "$1" rev-parse --is-inside-work-tree >/dev/null 2>&1
}

get_submodules() {
    git -C "$MAIN_REPO" config --file .gitmodules --get-regexp '^submodule\..*\.path$' 2>/dev/null |
        awk '{print $2}' || true
}

is_submodule_path() {
    local candidate="$1"
    local submodule
    while IFS= read -r submodule; do
        [[ -z "$submodule" ]] && continue
        if [[ "$candidate" == "$submodule" ]]; then
            return 0
        fi
    done < <(get_submodules)
    return 1
}

get_independent_repos() {
    local child rel
    while IFS= read -r child; do
        [[ -z "$child" ]] && continue
        rel="${child#$MAIN_REPO/}"
        [[ "$rel" == ".git" || "$rel" == ".agents" || "$rel" == ".Codex" ]] && continue
        is_submodule_path "$rel" && continue
        [[ -e "$child/.git" ]] || continue
        is_git_repo "$child" || continue
        printf '%s\n' "$rel"
    done < <(find "$MAIN_REPO" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
}

get_repos() {
    {
        get_submodules
        get_independent_repos
        printf '.\n'
    } | awk 'NF && !seen[$0]++'
}

get_independent_pathspec_excludes() {
    local repo
    while IFS= read -r repo; do
        [[ -z "$repo" ]] && continue
        printf ':(exclude)%s\n' "$repo"
    done < <(get_independent_repos)
}

git_add_all_for_repo() {
    local repo="$1"
    local path
    path="$(repo_path "$repo")"

    if [[ "$repo" != "." ]]; then
        git -C "$path" add -A
        return
    fi

    local pathspec=(".")
    local exclude
    while IFS= read -r exclude; do
        [[ -n "$exclude" ]] && pathspec+=("$exclude")
    done < <(get_independent_pathspec_excludes)

    git -C "$path" add -u -- "${pathspec[@]}"

    local untracked=()
    while IFS= read -r -d '' file; do
        untracked+=("$file")
    done < <(git -C "$path" ls-files --others --exclude-standard -z -- "${pathspec[@]}")

    if (( ${#untracked[@]} > 0 )); then
        git -C "$path" add -- "${untracked[@]}"
    fi
}

has_conflicts() {
    local path="$1"
    [[ -n "$(git -C "$path" diff --name-only --diff-filter=U 2>/dev/null || true)" ]]
}

print_conflicts_and_exit() {
    local repo="$1"
    local path
    path="$(repo_path "$repo")"

    say "${RED}[$(repo_label "$repo")] 检测到冲突。${NC}"
    say ""
    say "冲突文件:"
    git -C "$path" diff --name-only --diff-filter=U 2>/dev/null | sed 's/^/  - /'
    say ""
    say "${RED}退出码: 2 (有冲突)${NC}"
    say "解决冲突后在对应仓库内执行:"
    say "  git add <冲突文件>"
    say "  git rebase --continue"
    say "  git push"
    exit 2
}

current_branch() {
    git -C "$1" branch --show-current 2>/dev/null || true
}

has_origin() {
    git -C "$1" remote get-url origin >/dev/null 2>&1
}

sync_clean_or_committed_repo() {
    local repo="$1"
    local path branch upstream
    path="$(repo_path "$repo")"
    branch="$(current_branch "$path")"

    if ! has_origin "$path"; then
        say "${YELLOW}[$(repo_label "$repo")] 没有 origin，跳过远端同步。${NC}"
        return 0
    fi

    git -C "$path" fetch origin --prune

    if [[ -z "$branch" ]]; then
        say "${YELLOW}[$(repo_label "$repo")] 当前是 detached HEAD，已 fetch，跳过 pull/push。${NC}"
        return 0
    fi

    upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
    if [[ -n "$upstream" ]]; then
        git -C "$path" pull --rebase --autostash
    else
        git -C "$path" pull --rebase --autostash origin "$branch"
    fi

    if has_conflicts "$path"; then
        print_conflicts_and_exit "$repo"
    fi

    git -C "$path" push origin "$branch"
}

repo_status_porcelain() {
    local repo="$1"
    local path
    path="$(repo_path "$repo")"

    if [[ "$repo" != "." ]]; then
        git -C "$path" status --porcelain
        return
    fi

    local pathspec=(".")
    local exclude
    while IFS= read -r exclude; do
        [[ -n "$exclude" ]] && pathspec+=("$exclude")
    done < <(get_independent_pathspec_excludes)
    git -C "$path" status --porcelain -- "${pathspec[@]}"
}

repo_has_changes() {
    [[ -n "$(repo_status_porcelain "$1")" ]]
}

print_change_summary() {
    local repo="$1"
    local path
    path="$(repo_path "$repo")"

    say "  状态:"
    repo_status_porcelain "$repo" | sed 's/^/    /' | head -40

    say "  改动摘要:"
    git -C "$path" diff --stat 2>/dev/null | sed 's/^/    /' | head -20 || true
    git -C "$path" diff --cached --stat 2>/dev/null | sed 's/^/    /' | head -20 || true
    say ""
}

cleanup_state() {
    rm -f "$STATE_FILE" "$MESSAGE_TEMPLATE"
}

phase1_check() {
    cleanup_state
    : > "$STATE_FILE"
    : > "$MESSAGE_TEMPLATE"

    say "${BLUE}========================================${NC}"
    say "${BLUE}Git 同步 - 阶段1：发现仓库并检查状态${NC}"
    say "${BLUE}========================================${NC}"
    say ""

    local has_changes=0
    local repo path

    while IFS= read -r repo; do
        [[ -z "$repo" ]] && continue
        path="$(repo_path "$repo")"
        [[ -d "$path" ]] || continue
        is_git_repo "$path" || continue

        say "${BLUE}[$(repo_label "$repo")]${NC}"
        git -C "$path" fetch origin --prune 2>/dev/null || true

        if repo_has_changes "$repo"; then
            has_changes=1
            printf '%s\t%s\n' "$repo" "$path" >> "$STATE_FILE"
            printf '%s\t%s\n' "$repo" "" >> "$MESSAGE_TEMPLATE"
            say "${GREEN}  需要提交。${NC}"
            print_change_summary "$repo"
        else
            say "${YELLOW}  无本地改动，尝试和远端对齐。${NC}"
            if sync_clean_or_committed_repo "$repo"; then
                say "${GREEN}  同步完成。${NC}"
            fi
            say ""
        fi
    done < <(get_repos)

    say "${BLUE}========================================${NC}"

    if [[ "$has_changes" -eq 1 ]]; then
        say "${GREEN}检测到需要提交的仓库。${NC}"
        say "请为每个仓库分别填写提交信息:"
        say "  $MESSAGE_TEMPLATE"
        say ""
        say "格式: repo<TAB>commit message"
        say "继续执行:"
        say "  $0 --continue-file \"$MESSAGE_TEMPLATE\""
        say ""
        say "退出码: 0 (需要 commit message)"
        exit 0
    fi

    say "${GREEN}同步完成，无本地改动。${NC}"
    say "退出码: 1 (无需 commit)"
    cleanup_state
    exit 1
}

message_for_repo() {
    local repo="$1"
    local message_file="$2"
    awk -F '\t' -v repo="$repo" '$1 == repo { sub(/^[^\t]*\t/, ""); print; found=1; exit } END { if (!found) exit 1 }' "$message_file"
}

phase2_continue_file() {
    local message_file="$1"
    local repo path message

    if [[ ! -f "$STATE_FILE" ]]; then
        say "${RED}错误: 找不到状态文件，请先运行阶段1。${NC}"
        exit 1
    fi
    if [[ ! -f "$message_file" ]]; then
        say "${RED}错误: 找不到提交信息文件: $message_file${NC}"
        exit 1
    fi

    say "${BLUE}========================================${NC}"
    say "${BLUE}Git 同步 - 阶段2：逐仓库提交并同步${NC}"
    say "${BLUE}========================================${NC}"
    say ""

    while IFS=$'\t' read -r repo path; do
        [[ -z "$repo" ]] && continue
        [[ -d "$path" ]] || continue
        is_git_repo "$path" || continue

        message="$(message_for_repo "$repo" "$message_file" || true)"
        if [[ -z "$message" ]]; then
            say "${RED}[$(repo_label "$repo")] 缺少提交信息。${NC}"
            say "请在 $message_file 中填写 repo<TAB>commit message。"
            exit 1
        fi

        say "${YELLOW}[$(repo_label "$repo")] 暂存并提交。${NC}"
        git_add_all_for_repo "$repo"

        if git -C "$path" diff --cached --quiet; then
            say "${YELLOW}[$(repo_label "$repo")] 暂存区无改动，跳过 commit。${NC}"
        else
            git -C "$path" commit -m "$message"
        fi

        say "${YELLOW}[$(repo_label "$repo")] 拉取并推送。${NC}"
        if ! sync_clean_or_committed_repo "$repo"; then
            if has_conflicts "$path"; then
                print_conflicts_and_exit "$repo"
            fi
            exit 1
        fi

        say "${GREEN}[$(repo_label "$repo")] 同步完成。${NC}"
        say ""
    done < "$STATE_FILE"

    say "${BLUE}========================================${NC}"
    say "${GREEN}全部同步完成。${NC}"
    cleanup_state
    exit 0
}

phase2_continue_shared_message() {
    local message="$1"
    local shared_file="$STATE_DIR/messages.shared.tsv"

    if [[ -z "$message" ]]; then
        say "${RED}错误: 缺少 commit message。${NC}"
        exit 1
    fi
    if [[ ! -f "$STATE_FILE" ]]; then
        say "${RED}错误: 找不到状态文件，请先运行阶段1。${NC}"
        exit 1
    fi

    while IFS=$'\t' read -r repo _path; do
        [[ -n "$repo" ]] && printf '%s\t%s\n' "$repo" "$message"
    done < "$STATE_FILE" > "$shared_file"

    phase2_continue_file "$shared_file"
}

show_help() {
    cat <<EOF
Git 同步脚本 - 通用多仓库两阶段模式

用法:
  $0
      阶段1：发现子模块、根目录下独立仓库和主仓库，检查状态并同步干净仓库

  $0 --status-only
      只读检查：发现仓库并输出当前状态，不 fetch、不 pull、不 push

  $0 --continue-file <messages.tsv>
      阶段2：按 repo<TAB>commit message 文件逐仓库提交、rebase、push

  $0 --continue "message"
      兼容旧用法：所有需要提交的仓库共用同一条提交信息，不建议日常使用

退出码:
  0 - 阶段1发现需要提交的改动，或阶段2同步完成
  1 - 阶段1无改动，或运行错误
  2 - 检测到冲突，需要手动解决
EOF
}

status_only() {
    local repo path

    say "${BLUE}========================================${NC}"
    say "${BLUE}Git 同步 - 只读状态检查${NC}"
    say "${BLUE}========================================${NC}"
    say ""

    while IFS= read -r repo; do
        [[ -z "$repo" ]] && continue
        path="$(repo_path "$repo")"
        [[ -d "$path" ]] || continue
        is_git_repo "$path" || continue

        say "${BLUE}[$(repo_label "$repo")]${NC} $path"
        if repo_has_changes "$repo"; then
            say "${GREEN}  有本地改动。${NC}"
            repo_status_porcelain "$repo" | sed 's/^/    /' | head -40
        else
            say "${YELLOW}  无本地改动。${NC}"
        fi
        say ""
    done < <(get_repos)
}

main() {
    cd "$MAIN_REPO"

    case "${1:-}" in
        "")
            phase1_check
            ;;
        --status-only)
            status_only
            ;;
        --continue-file)
            phase2_continue_file "${2:-}"
            ;;
        --continue)
            phase2_continue_shared_message "${2:-}"
            ;;
        --help|-h)
            show_help
            ;;
        *)
            say "${RED}未知参数: $1${NC}"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
