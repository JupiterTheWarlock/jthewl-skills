---
name: project-skill-governance
description: Govern repo-local agent skills by consolidating skills from .claude, .cursor, .qoder, .codex, and other agent config folders into .agents/skills as the canonical union, then rewriting per-agent skill folders as compatibility routers to the matching .agents/skills entry. Use when syncing, deduplicating, migrating, or repairing project-local skills across multiple agent ecosystems.
---

# Project Skill Governance

## Overview

Use this skill to keep `.agents/skills` as the project-local source of truth for skills while preserving compatibility with agent-specific folders such as `.claude/skills`.

## Workflow

1. Inspect project-local agent config folders: `.agents`, `.claude`, `.cursor`, `.qoder`, `.codex`, `.opencode`, and `.openclaw`.
2. Treat `.agents/skills` as canonical.
3. Copy any skill that exists only in another agent config folder into `.agents/skills`.
4. Do not overwrite an existing canonical skill with same-name content from another agent folder. Report the conflict and keep `.agents/skills` authoritative.
5. Rewrite every existing non-canonical agent `skills/<skill-name>` folder into a generated router skill that points to the corresponding canonical `.agents/skills/<skill-name>` folder.
6. Copy router frontmatter directly from the canonical `.agents/skills/<skill-name>/SKILL.md`; only the router body is generated.
7. Validate the canonical skill folders and router paths after changes.

## Commands

Preview without writing:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/project-skill-governance/scripts/govern-project-skills.ps1 -WhatIf
```

Apply the governance pass:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/project-skill-governance/scripts/govern-project-skills.ps1
```

Verify existing routers without writing:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/project-skill-governance/scripts/govern-project-skills.ps1 -VerifyOnly
```

Use `-CreateMissingAgentDirs` only when the project intentionally wants empty agent config folders such as `.cursor/skills` or `.qoder/skills` created.

## Router Contract

Router skills must be fully generated compatibility shims:

- Frontmatter must be copied directly from the canonical `.agents/skills/<skill-name>/SKILL.md`.
- Body must contain the relative canonical path and no substantive workflow instructions.
- The relative path must resolve from the router skill directory to the canonical skill folder.
- The router must tell the agent to read `SKILL.md` inside that canonical folder and treat bundled resources as part of the skill.

```text
../../../.agents/skills/<skill-name>
```

Do not maintain substantive workflow instructions in `.claude/skills`, `.cursor/skills`, `.qoder/skills`, `.codex/skills`, or other agent-specific copies after governance has been applied.

## Validation

After applying changes, run:

```powershell
python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py .agents\skills\project-skill-governance
```

If broad validation is needed, run the same validator against each folder under `.agents/skills`.
