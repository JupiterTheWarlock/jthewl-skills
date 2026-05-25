# jthewl-skills

JupiterTheWarlock's public Claude Code skill marketplace.

## Marketplace

Add the marketplace in Claude Code:

```text
/plugin marketplace add JupiterTheWarlock/jthewl-skills
```

Install one plugin:

```text
/plugin install git-sync@jthewl-skills
/plugin install project-skill-governance@jthewl-skills
/plugin install xhs-note-scraper@jthewl-skills
```

## Structure

```text
jthewl-skills/
├── .claude-plugin/
│   └── marketplace.json
└── plugins/
    ├── git-sync/
    │   ├── .claude-plugin/plugin.json
    │   └── skills/git-sync/SKILL.md
    ├── project-skill-governance/
    │   ├── .claude-plugin/plugin.json
    │   └── skills/project-skill-governance/SKILL.md
    └── xhs-note-scraper/
        ├── .claude-plugin/plugin.json
        └── skills/xhs-note-scraper/SKILL.md
```

One marketplace can list many plugins. Each plugin can contain one or more skills. This repository starts with one skill per plugin so each skill can be installed and updated independently.

## Included Plugins

| Plugin | Skill | Purpose |
|---|---|---|
| `git-sync` | `git-sync` | Sync a main repo, submodules, and nested Git repos with remote. |
| `project-skill-governance` | `project-skill-governance` | Consolidate repo-local skills into `.agents/skills` and generate compatibility routers. |
| `xhs-note-scraper` | `xhs-note-scraper` | Export public Xiaohongshu/XHS note pages through public HTTP fetches. |

## Validation

```bash
claude plugin validate .
```

Before adding a skill to `plugins/`, audit the skill directory:

```bash
node .agents/skills/skill-safety-audit/scripts/audit-skill-safety.mjs "<skill-dir>"
```

Use local-only private terms for personal codenames, handles, or domains:

```bash
SKILL_SAFETY_PRIVATE_TERMS="private-term-1,private-term-2" node .agents/skills/skill-safety-audit/scripts/audit-skill-safety.mjs "<skill-dir>"
```
