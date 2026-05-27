# jthewl-skills

JupiterTheWarlock's public Claude Code skill marketplace.

Browse the marketplace on the public hub: [skills.jthewl.cc](https://skills.jthewl.cc)

Related repositories:

- [jthewl-skills](https://github.com/JupiterTheWarlock/jthewl-skills) — this Claude Code skills marketplace.
- [jthewl-skills-hub](https://github.com/JupiterTheWarlock/jthewl-skills-hub) — the public web UI for browsing and previewing plugins.

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

## Hub Metadata

The public web hub reads extra display metadata from `.jthewl-hub/plugins/<plugin-name>.json`.
This data is intentionally separate from Claude Code plugin manifests:

- `.claude-plugin/marketplace.json` and `plugins/*/.claude-plugin/plugin.json` stay focused on Claude Code installation and validation.
- `.jthewl-hub/plugins/*.json` stores human-facing descriptions, provenance, maintainer/original author fields, links, use cases, warnings, and update dates for the web hub.
- Third-party, adapted, mirrored, or curated plugins must declare their origin in `provenance`.

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

## Auto Refresh Hub

Push to `main` in this repository now triggers `.github/workflows/trigger-skills-hub-deploy.yml`, which calls a Vercel Deploy Hook for `jthewl-skills-hub`.

Required setup (once):

1. In Vercel `jthewl-skills-hub` project settings, create a Deploy Hook for `main`.
2. In this repository settings, add GitHub Actions secret `SKILLS_HUB_DEPLOY_HOOK`.
3. Set the secret value to that Deploy Hook URL.

After setup, changes to `.claude-plugin/**`, `.jthewl-hub/**`, or `plugins/**` will auto-trigger hub redeploy after each push.
