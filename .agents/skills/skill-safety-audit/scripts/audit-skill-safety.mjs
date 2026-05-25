#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "uv.lock",
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".bash",
  ".bat",
  ".cjs",
  ".cmd",
  ".css",
  ".example",
  ".gitignore",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const RULES = [
  {
    id: "credential",
    severity: "blocker",
    pattern:
      /\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?key|private[_-]?key|password|token|R2_SECRET_KEY|R2_ACCESS_KEY)\b\s*[:=]\s*["']?[^"'\s<>{}]{4,}/i,
    message: "Potential credential or secret value found.",
  },
  {
    id: "private-key",
    severity: "blocker",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
    message: "Private key material found.",
  },
  {
    id: "personal-identity",
    severity: "high",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    message: "Personal identity or contact marker found; confirm it is intentional before public release.",
  },
  {
    id: "local-private-path",
    severity: "high",
    pattern: /\b[A-Z]:\\Users\\[^\\]+\\/i,
    message: "Machine-local path found.",
  },
  {
    id: "private-infrastructure",
    severity: "high",
    pattern: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/i,
    message: "Private infrastructure or internal network marker found.",
  },
  {
    id: "cookie-session",
    severity: "high",
    pattern: /\b(?:cookie|sessionid|session_token|auth[_-]?token)\b\s*[:=]\s*["']?[^"'\s<>{}]{8,}/i,
    message: "Cookie or session credential found.",
  },
];

function extensionOf(filePath) {
  const name = basename(filePath);
  if (name === ".gitignore") return ".gitignore";
  if (name.endsWith(".example")) return ".example";
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index);
}

function shouldIgnore(name) {
  return DEFAULT_IGNORES.has(name);
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(extensionOf(filePath));
}

function listCandidateFiles(root) {
  const out = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldIgnore(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isTextFile(full)) continue;
      if (statSync(full).size > 1024 * 1024) continue;
      out.push(full);
    }
  }

  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCustomRules(privateTerms = []) {
  return privateTerms
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => ({
      id: "custom-private-term",
      severity: "high",
      pattern: new RegExp(escapeRegExp(term), "i"),
      message: "Caller-provided private term found.",
    }));
}

function scanFile(root, filePath, rules) {
  const text = readFileSync(filePath, "utf8");
  const rel = relative(root, filePath).replaceAll("\\", "/");
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        message: rule.message,
        file: rel,
        line: index + 1,
        snippet: line.trim().slice(0, 180),
      });
    }
  });

  return findings;
}

function envPrivateTerms() {
  const raw = process.env.SKILL_SAFETY_PRIVATE_TERMS || "";
  return raw.split(/[\n,;]+/).map((term) => term.trim()).filter(Boolean);
}

export async function auditSkillDirectory(skillDir, options = {}) {
  const root = resolve(skillDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Skill directory not found: ${skillDir}`);
  }

  const privateTerms = [...envPrivateTerms(), ...(options.privateTerms || [])];
  const rules = [...RULES, ...buildCustomRules(privateTerms)];
  const files = listCandidateFiles(root);
  const findings = files.flatMap((file) => scanFile(root, file, rules));
  return {
    status: findings.length === 0 ? "pass" : "fail",
    root,
    scannedFiles: files.length,
    findings,
  };
}

function printText(result) {
  console.log(`status: ${result.status}`);
  console.log(`root: ${result.root}`);
  console.log(`scannedFiles: ${result.scannedFiles}`);
  if (result.findings.length === 0) return;
  console.log("");
  for (const finding of result.findings) {
    console.log(`[${finding.severity}] ${finding.ruleId} ${finding.file}:${finding.line}`);
    console.log(`  ${finding.message}`);
    console.log(`  ${finding.snippet}`);
  }
}

async function main(argv) {
  const args = argv.slice(2);
  const json = args.includes("--json");
  const target = args.find((arg) => !arg.startsWith("-")) || ".";
  const result = await auditSkillDirectory(target);
  if (json) console.log(JSON.stringify(result, null, 2));
  else printText(result);
  process.exitCode = result.status === "pass" ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
