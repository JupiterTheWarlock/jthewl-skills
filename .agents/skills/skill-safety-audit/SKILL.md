---
name: skill-safety-audit
description: Audit agent skill folders before public release for privacy, credential, and local-machine leakage. Use when publishing, copying, marketplace-packaging, reviewing, or open-sourcing skills; when checking whether a skill is safe to include in a public repository; or when the user asks to confirm a skill is desensitized.
---

# Skill Safety Audit

Use this skill before publishing or copying skills into a public marketplace.

## Workflow

1. Identify each candidate skill directory.
2. Run the bundled scanner:

```bash
node .agents/skills/skill-safety-audit/scripts/audit-skill-safety.mjs "<skill-dir>"
```

Use JSON output when another script needs to consume the result:

```bash
node .agents/skills/skill-safety-audit/scripts/audit-skill-safety.mjs "<skill-dir>" --json
```

To check private codenames, handles, domains, or other user-specific terms without committing them, set `SKILL_SAFETY_PRIVATE_TERMS` locally:

```bash
SKILL_SAFETY_PRIVATE_TERMS="private-term-1,private-term-2" node .agents/skills/skill-safety-audit/scripts/audit-skill-safety.mjs "<skill-dir>"
```

3. Treat `status: fail` as a publishing blocker until every finding is reviewed.
4. Remove or generalize private material rather than masking it in place.
5. Re-run the scanner after edits.

## What To Check Manually

The scanner is a guardrail, not a complete proof. Also read the skill for:

- Personal identity details that are not meant to be public.
- Private project names, internal URLs, local absolute paths, and client data.
- Real credentials, cookies, API keys, `.env` files, and private keys.
- Examples that reveal private repository names, domains, usernames, or infrastructure.
- Scripts that call private services by default.

## Release Rule

Only move a skill into `plugins/` after the scanner passes and a quick manual read finds no private context that should stay local.
