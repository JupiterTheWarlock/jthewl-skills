import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { auditSkillDirectory } from "./audit-skill-safety.mjs";

function makeSkill(files) {
  const root = mkdtempSync(join(tmpdir(), "skill-safety-audit-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(full.split(/[\\/]/).slice(0, -1).join("/"), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

test("passes a generic public skill with no private markers", async () => {
  const root = makeSkill({
    "SKILL.md": [
      "---",
      "name: generic-skill",
      "description: A generic workflow for public use.",
      "---",
      "",
      "# Generic Skill",
      "",
      "Use this skill for repository maintenance.",
    ].join("\n"),
    "scripts/example.sh": "echo ok\n",
  });

  const result = await auditSkillDirectory(root);

  assert.equal(result.status, "pass");
  assert.equal(result.findings.length, 0);
});

test("fails when a skill contains credentials or personal/private markers", async () => {
  const root = makeSkill({
    "SKILL.md": [
      "---",
      "name: unsafe-skill",
      "description: Upload to my private bucket.",
      "---",
      "",
      "api_key=abc123",
      "Contact maintainer@example.com",
      "Use D:\\Users\\ExampleUser\\private-project",
      "Call http://192.168.1.10/private/repo.git",
    ].join("\n"),
  });

  const result = await auditSkillDirectory(root);

  assert.equal(result.status, "fail");
  assert.ok(result.findings.some((finding) => finding.ruleId === "credential"));
  assert.ok(result.findings.some((finding) => finding.ruleId === "personal-identity"));
  assert.ok(result.findings.some((finding) => finding.ruleId === "local-private-path"));
  assert.ok(result.findings.some((finding) => finding.ruleId === "private-infrastructure"));
});

test("ignores dependency locks and git internals by default", async () => {
  const root = makeSkill({
    "SKILL.md": [
      "---",
      "name: dependency-skill",
      "description: A skill with generated dependency metadata.",
      "---",
      "",
      "# Dependency Skill",
    ].join("\n"),
    "package-lock.json": "\"@aws-sdk/token-providers\": \"1.0.0\"",
    ".git/config": "url = git@github.com:example/private.git",
  });

  const result = await auditSkillDirectory(root);

  assert.equal(result.status, "pass");
  assert.equal(result.findings.length, 0);
});

test("supports caller-provided private terms without committing them to the scanner", async () => {
  const root = makeSkill({
    "SKILL.md": [
      "---",
      "name: codename-skill",
      "description: A skill with a private codename.",
      "---",
      "",
      "Internal codename: ProjectZephyr",
    ].join("\n"),
  });

  const result = await auditSkillDirectory(root, { privateTerms: ["ProjectZephyr"] });

  assert.equal(result.status, "fail");
  assert.ok(result.findings.some((finding) => finding.ruleId === "custom-private-term"));
});
