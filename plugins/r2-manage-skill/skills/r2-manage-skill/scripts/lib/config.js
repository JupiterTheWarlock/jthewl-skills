#!/usr/bin/env node
/**
 * R2 Manage — 共享配置模块
 * 
 * 加载 .env 文件并导出校验后的配置对象。
 */

const fs = require('fs');
const path = require('path');

const SKILL_ROOT = path.resolve(__dirname, '..', '..');

function loadDotenv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function loadConfig() {
  loadDotenv(path.join(SKILL_ROOT, '.env'));

  const config = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
    bucket: process.env.R2_BUCKET || 'assets',
    endpoint: process.env.R2_ENDPOINT,
    publicUrl: process.env.R2_PUBLIC_URL,
  };

  const missing = [];
  if (!config.accountId) missing.push('R2_ACCOUNT_ID');
  if (!config.accessKeyId) missing.push('R2_ACCESS_KEY');
  if (!config.secretAccessKey) missing.push('R2_SECRET_KEY');
  if (missing.length) {
    console.error(`\u274C \u7F3A\u5C11\u5FC5\u586B\u73AF\u5883\u53D8\u91CF: ${missing.join(', ')}`);
    console.error(`   \u8BF7\u5728 ${path.join(SKILL_ROOT, '.env')} \u4E2D\u914D\u7F6E\uFF0C\u6216\u901A\u8FC7\u8FDB\u7A0B\u73AF\u5883\u53D8\u91CF\u6CE8\u5165\u3002`);
    process.exit(1);
  }

  if (!config.endpoint) {
    config.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  }
  if (!config.publicUrl) {
    config.publicUrl = `https://pub-${config.accountId}.r2.dev`;
  }

  return config;
}

module.exports = { loadConfig, SKILL_ROOT };
