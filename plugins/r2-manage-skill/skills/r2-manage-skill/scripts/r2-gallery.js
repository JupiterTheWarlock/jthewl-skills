#!/usr/bin/env node
/**
 * R2 Manage - local asset gallery
 *
 * Starts a local-only web UI for browsing public R2 image-hosting assets.
 * Credentials stay server-side; the browser receives only object metadata and
 * public CDN URLs.
 */

const http = require('node:http');
const { URL } = require('node:url');
const { ListObjectsV2Command, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getClient, getConfig } = require('./lib/client');

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);
const DEFAULT_OPTIONS = {
  host: '127.0.0.1',
  port: 8787,
  prefix: '',
  max: 100,
  open: false,
};

const REDACTION_RULES = [
  ['R2_ACCOUNT_ID', '[redacted-account-id]'],
  ['R2_ACCESS_KEY', '[redacted-access-key]'],
  ['R2_SECRET_KEY', '[redacted-secret-key]'],
  ['R2_BUCKET', '[redacted-bucket]'],
  ['R2_ENDPOINT', '[redacted-endpoint]'],
  ['R2_PUBLIC_URL', '[redacted-public-url]'],
];

function parsePositiveInt(value, fallback, min = 1, max = 1000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

function parseArgs(args = process.argv.slice(2)) {
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--host' && args[i + 1]) {
      options.host = args[++i];
    } else if (arg === '--port' && args[i + 1]) {
      options.port = parsePositiveInt(args[++i], options.port, 1, 65535);
    } else if (arg === '--prefix' && args[i + 1]) {
      options.prefix = args[++i];
    } else if (arg === '--max' && args[i + 1]) {
      options.max = parsePositiveInt(args[++i], options.max, 1, 1000);
    } else if (arg === '--open') {
      options.open = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function getExtension(key) {
  const cleanKey = String(key || '').split('?')[0].split('#')[0];
  const fileName = cleanKey.split('/').pop() || '';
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

function isImageKey(key) {
  return IMAGE_EXTENSIONS.has(getExtension(key));
}

function publicObjectUrl(publicUrl, key) {
  const base = String(publicUrl || '').replace(/\/+$/, '');
  const encodedKey = String(key || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
  return `${base}/${encodedKey}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactSensitiveText(value) {
  let text = String(value || '');
  for (const [envName, placeholder] of REDACTION_RULES) {
    const envValue = process.env[envName];
    if (envValue) {
      text = text.replace(new RegExp(escapeRegExp(envValue), 'g'), placeholder);
    }
  }
  return text;
}

function buildObjectView(obj, publicUrl) {
  const key = obj.Key || '';
  const lastModified = obj.LastModified instanceof Date
    ? obj.LastModified.toISOString()
    : (obj.LastModified || null);

  return {
    key,
    size: obj.Size ?? null,
    lastModified,
    url: publicObjectUrl(publicUrl, key),
    extension: getExtension(key),
    isImage: isImageKey(key),
  };
}

function buildPathTree(objects) {
  const root = {
    label: 'All assets',
    prefix: '',
    count: objects.length,
    children: [],
  };
  const topNodes = new Map();

  for (const object of objects) {
    const key = object.key || object.Key || '';
    const parts = key.split('/').filter(Boolean);
    if (!parts.length || parts.length === 1) continue;

    const topPrefix = `${parts[0]}/`;
    if (!topNodes.has(topPrefix)) {
      topNodes.set(topPrefix, {
        label: parts[0],
        prefix: topPrefix,
        count: 0,
        children: [],
        _children: new Map(),
      });
    }
    const topNode = topNodes.get(topPrefix);
    topNode.count += 1;

    if (parts.length < 3) continue;
    const childPrefix = `${parts[0]}/${parts[1]}/`;
    if (!topNode._children.has(childPrefix)) {
      topNode._children.set(childPrefix, {
        label: parts[1],
        prefix: childPrefix,
        count: 0,
        children: [],
      });
    }
    topNode._children.get(childPrefix).count += 1;
  }

  const nodes = Array.from(topNodes.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(node => {
      const children = Array.from(node._children.values())
        .sort((a, b) => a.label.localeCompare(b.label));
      delete node._children;
      return { ...node, children };
    });

  return [root, ...nodes];
}

function buildListResponse(response, publicUrl, options = {}) {
  const objects = (response.Contents || []).map(obj => buildObjectView(obj, publicUrl));

  return {
    prefix: options.prefix || '',
    max: options.max || objects.length,
    count: objects.length,
    isTruncated: Boolean(response.IsTruncated),
    nextContinuationToken: response.NextContinuationToken || null,
    tree: buildPathTree(objects),
    objects,
  };
}

async function listObjects(options) {
  const client = getClient();
  const config = getConfig();
  const params = {
    Bucket: config.bucket,
    MaxKeys: parsePositiveInt(options.max, DEFAULT_OPTIONS.max, 1, 1000),
  };

  if (options.prefix) params.Prefix = options.prefix;
  if (options.continuationToken) params.ContinuationToken = options.continuationToken;

  const response = await client.send(new ListObjectsV2Command(params));
  return buildListResponse(response, config.publicUrl, {
    prefix: options.prefix || '',
    max: params.MaxKeys,
  });
}

async function getObjectInfo(key) {
  const client = getClient();
  const config = getConfig();
  const response = await client.send(new HeadObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }));

  return {
    key,
    contentType: response.ContentType || '',
    size: response.ContentLength ?? null,
    lastModified: response.LastModified instanceof Date ? response.LastModified.toISOString() : null,
    etag: response.ETag || '',
    description: response.Metadata?.description || '',
    url: publicObjectUrl(config.publicUrl, key),
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

function renderHtml(initialOptions) {
  const initialState = JSON.stringify({
    prefix: initialOptions.prefix || '',
    max: initialOptions.max || DEFAULT_OPTIONS.max,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>R2 Asset Gallery</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --panel: #ffffff;
      --text: #1d2528;
      --muted: #667479;
      --line: #d8dee2;
      --accent: #0f766e;
      --accent-dark: #115e59;
      --warn: #9a3412;
      --shadow: 0 1px 3px rgb(15 23 42 / 0.1);
    }
    * { box-sizing: border-box; }
    html {
      overflow-x: hidden;
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--bg);
      overflow-x: hidden;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgb(255 255 255 / 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(10px);
    }
    .bar {
      width: min(1440px, calc(100% - 32px));
      margin: 0 auto;
      padding: 16px 0;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
      min-width: 0;
    }
    .bar > section {
      min-width: 0;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0;
    }
    form {
      display: grid;
      grid-template-columns: minmax(180px, 320px) 96px 176px 112px;
      gap: 8px;
      align-items: end;
      min-width: 0;
    }
    label {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      min-width: 0;
    }
    input, button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
      letter-spacing: 0;
      min-width: 0;
    }
    input {
      width: 100%;
      padding: 0 10px;
    }
    button {
      padding: 0 12px;
      cursor: pointer;
      font-weight: 650;
    }
    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }
    button.primary:hover { background: var(--accent-dark); }
    button:disabled,
    button[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.56;
    }
    .tools {
      display: grid;
      gap: 8px;
      justify-items: end;
      min-width: 0;
    }
    .status {
      color: var(--muted);
      font-size: 13px;
      min-height: 18px;
      text-align: right;
    }
    main {
      width: min(1440px, calc(100% - 32px));
      margin: 18px auto 40px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      min-width: 0;
    }
    .asset {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .thumb {
      display: grid;
      place-items: center;
      width: 100%;
      height: auto;
      aspect-ratio: 1 / 1;
      overflow: hidden;
      padding: 0;
      background:
        linear-gradient(45deg, #eef1f3 25%, transparent 25%),
        linear-gradient(-45deg, #eef1f3 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #eef1f3 75%),
        linear-gradient(-45deg, transparent 75%, #eef1f3 75%);
      background-size: 20px 20px;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
    }
    .thumb img {
      display: block;
      width: 100%;
      height: 100%;
      min-width: 0;
      min-height: 0;
      object-fit: contain;
    }
    .file-icon {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 4px 8px;
      background: #fff;
    }
    .meta {
      display: grid;
      gap: 8px;
      padding: 10px;
    }
    .key {
      min-height: 38px;
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .actions button, .actions a {
      display: grid;
      place-items: center;
      min-height: 32px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      background: #fff;
      text-decoration: none;
      font-size: 12px;
      font-weight: 650;
      cursor: pointer;
    }
    .empty, .error {
      display: grid;
      gap: 10px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--muted);
    }
    .error { color: var(--warn); }
    .empty strong,
    .error strong {
      color: var(--text);
      font-size: 14px;
    }
    .empty p,
    .error p {
      margin: 0;
      line-height: 1.5;
    }
    .empty-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 2px;
    }
    .error-detail {
      max-height: 160px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      color: var(--muted);
      background: rgb(0 0 0 / 0.12);
    }
    .pager {
      display: flex;
      justify-content: center;
      padding: 22px 0 4px;
    }
    dialog {
      width: min(920px, calc(100% - 24px));
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0;
    }
    dialog::backdrop { background: rgb(0 0 0 / 0.42); }
    .dialog-body {
      display: grid;
      gap: 12px;
      padding: 14px;
    }
    .dialog-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .preview {
      display: grid;
      place-items: center;
      min-height: 260px;
      max-height: 70vh;
      background: #f1f3f5;
      overflow: auto;
    }
    .preview img {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    @media (max-width: 760px) {
      .bar {
        width: min(100% - 20px, 1440px);
        grid-template-columns: 1fr;
        gap: 12px;
      }
      form {
        grid-template-columns: 1fr;
      }
      .tools {
        justify-items: stretch;
      }
      .status {
        text-align: left;
      }
      main {
        width: min(100% - 20px, 1440px);
      }
    }
    :root {
      color-scheme: dark;
      --bg: #0A0908;
      --panel: rgba(14, 12, 10, 0.85);
      --text: #E8E0D8;
      --muted: #8A7E74;
      --line: #2E2520;
      --line-strong: #4A3D33;
      --accent: #DA7756;
      --accent-bright: #E8985C;
      --accent-dark: #B85D3A;
      --glow: rgba(218, 119, 86, 0.4);
      --shadow: 0 14px 40px rgb(0 0 0 / 0.32);
    }
    body {
      background:
        radial-gradient(circle at 18% -12%, rgb(218 119 86 / 0.16), transparent 34%),
        linear-gradient(180deg, #0A0908 0%, #100D0B 100%);
    }
    header {
      background: rgb(10 9 8 / 0.92);
      border-bottom-color: var(--line);
    }
    .bar {
      align-items: center;
      border-left: 1px solid var(--line);
      border-right: 1px solid var(--line);
      padding-left: 18px;
      padding-right: 18px;
    }
    .brand {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
      min-width: 0;
    }
    .brand-mark {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border: 1px solid var(--line-strong);
      border-radius: 6px;
      color: var(--accent-bright);
      background: rgb(218 119 86 / 0.1);
      box-shadow: 0 0 18px var(--glow);
      font: 700 13px/1 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    h1 {
      margin: 0;
      color: #FAF0E8;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 18px;
      text-transform: uppercase;
    }
    .brand-code {
      color: var(--accent-bright);
      font: 12px/1.3 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    input, button {
      border-color: var(--line-strong);
      background: rgb(10 9 8 / 0.8);
      color: var(--text);
    }
    input:focus, button:focus {
      outline: 1px solid var(--accent);
      outline-offset: 2px;
    }
    button.primary {
      border-color: var(--accent);
      background: rgb(218 119 86 / 0.14);
      color: var(--accent-bright);
      box-shadow: inset 0 0 0 1px rgb(218 119 86 / 0.18);
    }
    button.primary:hover {
      background: rgb(218 119 86 / 0.22);
      color: #FAF0E8;
    }
    button:disabled {
      border-color: var(--line);
      color: var(--muted);
      background: rgb(10 9 8 / 0.48);
      box-shadow: none;
    }
    main {
      width: min(1600px, calc(100% - 32px));
    }
    .browser-shell {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
      min-width: 0;
    }
    .tree-panel, .asset-panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      min-width: 0;
    }
    .tree-panel {
      position: sticky;
      top: 104px;
      max-height: calc(100vh - 128px);
      overflow: auto;
      padding: 12px;
    }
    .panel-title {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
      color: #FAF0E8;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      text-transform: uppercase;
    }
    .panel-title span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .filterMenu {
      position: relative;
      min-width: 0;
    }
    .filterTrigger {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 14px;
      align-items: center;
      width: 100%;
      min-height: 36px;
      gap: 8px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 6px 8px;
      color: var(--muted);
      background: rgb(10 9 8 / 0.78);
      text-align: left;
      cursor: pointer;
    }
    .filterTrigger:hover,
    .filterTrigger:focus-visible,
    .filterMenu:focus-within .filterTrigger {
      border-color: var(--accent);
      color: #FAF0E8;
      outline: 0;
      box-shadow: 0 0 0 3px var(--glow);
    }
    .filterTrigger span:first-child {
      display: grid;
      min-width: 0;
      gap: 1px;
    }
    .filterTrigger small,
    .filterTrigger strong {
      overflow: hidden;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .filterTrigger small {
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
    }
    .filterTrigger strong {
      color: var(--text);
      font-size: 12px;
      font-weight: 600;
    }
    .filterChevron {
      color: var(--accent-bright);
      font-size: 13px;
      line-height: 1;
      text-align: center;
    }
    .filterMenuList {
      position: absolute;
      z-index: 30;
      top: calc(100% + 6px);
      left: 0;
      width: max(100%, 190px);
      max-width: calc(100vw - 32px);
      max-height: 240px;
      overflow: auto;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      padding: 5px;
      background: rgb(14 12 10 / 0.98);
      box-shadow: 0 18px 40px rgb(0 0 0 / 0.45);
    }
    .filterMenuList[hidden] {
      display: none;
    }
    .filterOption {
      display: block;
      width: 100%;
      min-height: 30px;
      border: 0;
      border-radius: 6px;
      padding: 0 8px;
      color: var(--muted);
      background: transparent;
      font-size: 12px;
      text-align: left;
      cursor: pointer;
    }
    .filterOption:hover,
    .filterOption:focus-visible,
    .filterOption.selected {
      color: #FAF0E8;
      background: rgb(218 119 86 / 0.12);
      outline: 0;
    }
    .filterOption:focus-visible {
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .tree {
      display: grid;
      gap: 3px;
    }
    .tree-node {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 32px;
      padding: 0 8px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--text);
      text-align: left;
      font: 12px/1.2 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    .tree-node:hover,
    .tree-node:focus-visible {
      border-color: var(--line-strong);
      background: rgb(218 119 86 / 0.08);
      color: #FAF0E8;
      outline: 0;
    }
    .tree-node.child {
      width: calc(100% - 14px);
      margin-left: 14px;
      color: var(--muted);
    }
    .tree-node.child:hover,
    .tree-node.child:focus-visible {
      color: #FAF0E8;
    }
    .tree-node span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tree-node.active {
      border-color: var(--accent);
      background: rgb(218 119 86 / 0.13);
      color: #FAF0E8;
      box-shadow: inset 2px 0 0 var(--accent);
    }
    .tree-node.active:hover,
    .tree-node.active:focus-visible {
      border-color: var(--accent);
      background: rgb(218 119 86 / 0.18);
    }
    .tree-count {
      color: var(--accent-bright);
      align-self: center;
    }
    .asset-panel {
      min-width: 0;
      padding: 12px;
    }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    }
    .asset {
      border-color: var(--line);
      background: rgb(10 9 8 / 0.72);
      box-shadow: none;
    }
    .thumb {
      border: 0;
      border-radius: 0;
      background:
        linear-gradient(45deg, rgb(232 224 216 / 0.055) 25%, transparent 25%),
        linear-gradient(-45deg, rgb(232 224 216 / 0.055) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgb(232 224 216 / 0.055) 75%),
        linear-gradient(-45deg, transparent 75%, rgb(232 224 216 / 0.055) 75%);
      background-size: 18px 18px;
      background-position: 0 0, 0 9px, 9px -9px, -9px 0;
    }
    .thumb img {
      padding: 8px;
    }
    .key {
      color: #FAF0E8;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    .actions button, .actions a {
      border-color: var(--line-strong);
      background: rgb(10 9 8 / 0.7);
      color: var(--text);
    }
    .actions button:hover,
    .actions button:focus-visible,
    .actions a:hover,
    .actions a:focus-visible,
    #more:hover,
    #more:focus-visible,
    #close:hover,
    #close:focus-visible {
      border-color: var(--accent);
      color: #FAF0E8;
      outline: 0;
      box-shadow: 0 0 0 3px var(--glow);
    }
    .actions button.copy-ok {
      border-color: var(--accent);
      color: var(--accent-bright);
      background: rgb(218 119 86 / 0.12);
    }
    .actions button.copy-error {
      border-color: #B85D3A;
      color: #FFB199;
      background: rgb(184 93 58 / 0.14);
    }
    .empty, .error {
      border-color: var(--line);
      background: rgb(10 9 8 / 0.72);
    }
    .empty strong,
    .error strong {
      color: #FAF0E8;
    }
    .empty-actions button {
      border-color: var(--line-strong);
      background: rgb(10 9 8 / 0.7);
      color: var(--accent-bright);
      font-size: 12px;
    }
    .error-detail {
      border-color: var(--line-strong);
      background: rgb(7 6 5 / 0.74);
    }
    dialog {
      color: var(--text);
      background: #100D0B;
      border-color: var(--line-strong);
    }
    .preview {
      background: #0A0908;
    }
    @media (max-width: 900px) {
      .browser-shell {
        grid-template-columns: 1fr;
      }
      .tree-panel {
        position: static;
        max-height: 280px;
      }
    }
    @media (max-width: 760px) {
      .bar {
        padding: 12px 10px;
      }
      .brand {
        gap: 9px;
        margin-bottom: 8px;
      }
      .brand img {
        width: 32px;
        height: 32px;
        box-shadow: none;
      }
      h1 {
        font-size: 16px;
      }
      .brand-code {
        max-width: 260px;
        font-size: 11px;
      }
      .filterMenuList {
        width: 100%;
        min-width: 0;
        max-width: calc(100vw - 20px);
      }
      .tree-panel {
        max-height: 240px;
      }
      .panel-title span:last-child {
        display: none;
      }
      .asset-panel {
        padding: 10px;
      }
      .grid {
        grid-template-columns: 1fr;
        gap: 10px;
      }
      .row {
        align-items: flex-start;
        flex-direction: column;
        gap: 3px;
      }
    }
    @media (max-width: 480px) {
      form {
        grid-template-columns: 1fr;
      }
      .tools {
        gap: 6px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      .actions {
        grid-template-columns: 1fr;
      }
      .empty,
      .error {
        padding: 16px;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="bar">
      <section>
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">R2</div>
          <div>
            <h1>R2 Asset Gallery</h1>
            <div class="brand-code">Local bucket browser / public assets</div>
          </div>
        </div>
        <form id="filters">
          <label>Prefix
            <input id="prefix" name="prefix" autocomplete="off" placeholder="blog/ 或 2026/06/" />
          </label>
          <label>Max
            <input id="max" name="max" inputmode="numeric" value="100" />
          </label>
          <div id="type" class="filterMenu">
            <button
              id="type-trigger"
              class="filterTrigger"
              type="button"
              aria-expanded="false"
              aria-haspopup="listbox"
              aria-controls="type-list"
            >
              <span>
                <small>Type</small>
                <strong id="type-value">All assets</strong>
              </span>
              <span class="filterChevron" aria-hidden="true">⌄</span>
            </button>
            <div id="type-list" class="filterMenuList" role="listbox" aria-label="Type" hidden>
              <button type="button" role="option" aria-selected="true" class="filterOption selected" data-type="all">All assets</button>
              <button type="button" role="option" aria-selected="false" class="filterOption" data-type="images">Images only</button>
              <button type="button" role="option" aria-selected="false" class="filterOption" data-type="files">Files only</button>
            </div>
          </div>
          <button id="refresh" class="primary" type="submit">Refresh</button>
        </form>
      </section>
      <section class="tools">
        <label>Search
          <input id="search" autocomplete="off" placeholder="key contains..." />
        </label>
        <div id="status" class="status"></div>
      </section>
    </div>
  </header>
  <main>
    <div class="browser-shell">
      <aside class="tree-panel">
        <div class="panel-title"><span>Path Tree</span><span>max depth 2</span></div>
        <div id="tree" class="tree"></div>
      </aside>
      <section class="asset-panel">
        <div id="content"></div>
        <div class="pager"><button id="more" hidden>Load more</button></div>
      </section>
    </div>
  </main>
  <dialog id="details">
    <div class="dialog-body">
      <div class="dialog-head">
        <strong id="dialog-title"></strong>
        <button id="close" type="button">Close</button>
      </div>
      <div id="dialog-preview" class="preview"></div>
      <pre id="dialog-meta"></pre>
    </div>
  </dialog>
  <script>
    const initialState = ${initialState};
    const state = {
      prefix: initialState.prefix,
      max: initialState.max,
      type: 'all',
      typeOpen: false,
      search: '',
      objects: [],
      tree: [],
      selectedPrefix: '',
      nextContinuationToken: null,
      loading: false,
      error: '',
      copiedUrl: '',
      copyErrorUrl: '',
      lastDialogTrigger: null
    };
    let copyResetTimer = null;

    const els = {
      form: document.getElementById('filters'),
      prefix: document.getElementById('prefix'),
      max: document.getElementById('max'),
      type: document.getElementById('type'),
      typeTrigger: document.getElementById('type-trigger'),
      typeList: document.getElementById('type-list'),
      typeValue: document.getElementById('type-value'),
      refresh: document.getElementById('refresh'),
      search: document.getElementById('search'),
      status: document.getElementById('status'),
      tree: document.getElementById('tree'),
      content: document.getElementById('content'),
      more: document.getElementById('more'),
      details: document.getElementById('details'),
      close: document.getElementById('close'),
      dialogTitle: document.getElementById('dialog-title'),
      dialogPreview: document.getElementById('dialog-preview'),
      dialogMeta: document.getElementById('dialog-meta')
    };

    els.prefix.value = state.prefix;
    els.max.value = state.max;

    function formatSize(bytes) {
      if (bytes == null) return '-';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function formatDate(value) {
      if (!value) return '-';
      return new Date(value).toLocaleString();
    }

    function formatTypeValue(value) {
      if (value === 'images') return 'Images only';
      if (value === 'files') return 'Files only';
      return 'All assets';
    }

    function parseClientMax(value) {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 1) return 100;
      return Math.min(parsed, 1000);
    }

    function hasActiveFilters() {
      return Boolean(state.prefix || state.selectedPrefix || state.search.trim() || state.type !== 'all');
    }

    function activeFilterSummary() {
      const parts = [];
      if (state.prefix) parts.push('prefix: ' + state.prefix);
      if (state.selectedPrefix) parts.push('tree: ' + state.selectedPrefix);
      if (state.type !== 'all') parts.push('type: ' + formatTypeValue(state.type));
      if (state.search.trim()) parts.push('search: ' + state.search.trim());
      return parts.join(' / ');
    }

    function emptyStateHtml(title, message, options = {}) {
      const actions = options.clearFilters
        ? '<div class="empty-actions"><button type="button" data-clear-filters="true">Clear filters</button></div>'
        : '';
      return '<div class="empty">' +
        '<strong>' + escapeHtml(title) + '</strong>' +
        '<p>' + escapeHtml(message) + '</p>' +
        actions +
      '</div>';
    }

    function friendlyError(rawMessage) {
      let message = String(rawMessage || 'Unknown error');
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.error) message = parsed.error;
      } catch (_) {
        // Keep the raw message when it is not JSON.
      }

      if (/credential|access key|secret|R2_ACCOUNT_ID|R2_ACCESS_KEY|R2_SECRET_KEY/i.test(message)) {
        return {
          title: 'R2 credentials are not ready',
          body: 'Check the local .env file in this skill, then refresh the gallery.',
          detail: message
        };
      }
      if (/AccessDenied|Forbidden|403/i.test(message)) {
        return {
          title: 'R2 access was denied',
          body: 'The configured token cannot list this bucket or prefix.',
          detail: message
        };
      }
      if (/not found|NoSuchBucket|404/i.test(message)) {
        return {
          title: 'R2 target was not found',
          body: 'Check the bucket name, public URL, and current prefix.',
          detail: message
        };
      }
      return {
        title: 'Could not load R2 assets',
        body: 'The local gallery server returned an error. Review the detail below, then refresh.',
        detail: message
      };
    }

    function buildTree(objects) {
      const root = { label: 'All assets', prefix: '', count: objects.length, children: [] };
      const topNodes = new Map();

      for (const object of objects) {
        const parts = object.key.split('/').filter(Boolean);
        if (parts.length < 2) continue;

        const topPrefix = parts[0] + '/';
        if (!topNodes.has(topPrefix)) {
          topNodes.set(topPrefix, {
            label: parts[0],
            prefix: topPrefix,
            count: 0,
            children: [],
            childMap: new Map()
          });
        }
        const topNode = topNodes.get(topPrefix);
        topNode.count += 1;

        if (parts.length < 3) continue;
        const childPrefix = parts[0] + '/' + parts[1] + '/';
        if (!topNode.childMap.has(childPrefix)) {
          topNode.childMap.set(childPrefix, {
            label: parts[1],
            prefix: childPrefix,
            count: 0,
            children: []
          });
        }
        topNode.childMap.get(childPrefix).count += 1;
      }

      return [root].concat(Array.from(topNodes.values()).sort((a, b) => a.label.localeCompare(b.label)).map((node) => {
        const children = Array.from(node.childMap.values()).sort((a, b) => a.label.localeCompare(b.label));
        return { label: node.label, prefix: node.prefix, count: node.count, children };
      }));
    }

    function visibleObjects() {
      const q = state.search.trim().toLowerCase();
      return state.objects.filter((object) => {
        if (state.selectedPrefix && !object.key.startsWith(state.selectedPrefix)) return false;
        if (state.type === 'images' && !object.isImage) return false;
        if (state.type === 'files' && object.isImage) return false;
        if (q && !object.key.toLowerCase().includes(q)) return false;
        return true;
      });
    }

    function renderTypeControl() {
      els.typeValue.textContent = formatTypeValue(state.type);
      els.typeTrigger.setAttribute('aria-expanded', state.typeOpen ? 'true' : 'false');
      els.typeList.hidden = !state.typeOpen;
      els.type.querySelectorAll('[data-type]').forEach((button) => {
        const selected = button.dataset.type === state.type;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = state.typeOpen ? 0 : -1;
      });
    }

    function renderTree() {
      if (!state.tree.length) {
        els.tree.innerHTML = emptyStateHtml('No paths loaded', 'Refresh the gallery to load bucket paths.');
        return;
      }

      const renderNode = (node, depth) => {
        const active = node.prefix === state.selectedPrefix ? ' active' : '';
        const child = depth > 0 ? ' child' : '';
        const label = node.label;
        return '<button class="tree-node' + child + active + '" type="button" data-prefix="' + escapeAttr(node.prefix) + '">' +
          '<span>' + escapeHtml(label) + '</span>' +
          '<span class="tree-count">' + String(node.count) + '</span>' +
        '</button>' +
        (depth === 0 && node.children && node.children.length
          ? node.children.map(childNode => renderNode(childNode, 1)).join('')
          : '');
      };

      els.tree.innerHTML = state.tree.map(node => renderNode(node, 0)).join('');
    }

    function render() {
      const objects = visibleObjects();
      renderTypeControl();
      renderTree();
      els.status.textContent = state.loading
        ? 'Loading...'
        : state.objects.length + ' loaded, ' + objects.length + ' visible';
      els.refresh.disabled = state.loading;
      els.more.hidden = !state.nextContinuationToken;
      els.more.disabled = state.loading;

      if (state.error) {
        const error = friendlyError(state.error);
        els.content.innerHTML = '<div class="error">' +
          '<strong>' + escapeHtml(error.title) + '</strong>' +
          '<p>' + escapeHtml(error.body) + '</p>' +
          '<pre class="error-detail">' + escapeHtml(error.detail) + '</pre>' +
        '</div>';
        return;
      }

      if (!objects.length) {
        const summary = activeFilterSummary();
        els.content.innerHTML = emptyStateHtml(
          'No matching assets',
          summary ? 'Current filters: ' + summary : 'The current R2 response did not include any assets.',
          { clearFilters: hasActiveFilters() }
        );
        return;
      }

      els.content.innerHTML = '<section class="grid">' + objects.map((object, index) => {
        const thumb = object.isImage
          ? '<img loading="lazy" src="' + object.url + '" alt="' + escapeHtml(object.key) + '">'
          : '<span class="file-icon">' + escapeHtml(object.extension || 'file') + '</span>';
        const copyLabel = state.copyErrorUrl === object.url
          ? 'Copy failed'
          : (state.copiedUrl === object.url ? 'Copied' : 'Copy URL');
        const copyClass = state.copyErrorUrl === object.url
          ? ' class="copy-error"'
          : (state.copiedUrl === object.url ? ' class="copy-ok"' : '');
        return '<article class="asset">' +
          '<button class="thumb" type="button" data-index="' + index + '">' + thumb + '</button>' +
          '<div class="meta">' +
            '<div class="key">' + escapeHtml(object.key) + '</div>' +
            '<div class="row"><span>' + escapeHtml(formatSize(object.size)) + '</span><span>' + escapeHtml(formatDate(object.lastModified)) + '</span></div>' +
            '<div class="actions">' +
              '<button type="button" data-copy="' + escapeAttr(object.url) + '"' + copyClass + ' aria-live="polite">' + copyLabel + '</button>' +
              '<a href="' + escapeAttr(object.url) + '" target="_blank" rel="noreferrer">Open</a>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('') + '</section>';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[char]));
    }

    function escapeAttr(value) {
      return escapeHtml(value);
    }

    function resetCopyStateLater() {
      window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        state.copiedUrl = '';
        state.copyErrorUrl = '';
        render();
      }, 1400);
    }

    function fallbackCopy(value) {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {
        ok = false;
      } finally {
        document.body.removeChild(textarea);
      }
      return ok;
    }

    async function copyValue(value) {
      state.copiedUrl = '';
      state.copyErrorUrl = '';
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
        } else if (!fallbackCopy(value)) {
          throw new Error('Clipboard API unavailable');
        }
        state.copiedUrl = value;
      } catch (_) {
        if (fallbackCopy(value)) {
          state.copiedUrl = value;
        } else {
          state.copyErrorUrl = value;
        }
      }
      render();
      resetCopyStateLater();
    }

    function clearFilters() {
      state.prefix = '';
      state.selectedPrefix = '';
      state.type = 'all';
      state.search = '';
      state.nextContinuationToken = null;
      els.prefix.value = '';
      els.search.value = '';
      loadObjects();
    }

    function typeOptions() {
      return Array.from(els.typeList.querySelectorAll('[data-type]'));
    }

    function focusTypeOption(offset) {
      const options = typeOptions();
      if (!options.length) return;
      const activeIndex = options.indexOf(document.activeElement);
      const selectedIndex = options.findIndex(option => option.dataset.type === state.type);
      const startIndex = activeIndex >= 0 ? activeIndex : Math.max(selectedIndex, 0);
      const nextIndex = (startIndex + offset + options.length) % options.length;
      options[nextIndex].focus();
    }

    function openTypeMenu(focusSelected = false) {
      state.typeOpen = true;
      render();
      if (focusSelected) {
        const selected = typeOptions().find(option => option.dataset.type === state.type);
        (selected || typeOptions()[0])?.focus();
      }
    }

    function closeTypeMenu(focusTrigger = false) {
      state.typeOpen = false;
      render();
      if (focusTrigger) els.typeTrigger.focus();
    }

    function selectType(value) {
      state.type = value;
      closeTypeMenu(false);
    }

    async function loadObjects({ append = false } = {}) {
      state.loading = true;
      render();
      const params = new URLSearchParams({
        prefix: state.prefix,
        max: String(state.max)
      });
      if (append && state.nextContinuationToken) {
        params.set('continuationToken', state.nextContinuationToken);
      }

      try {
        state.error = '';
        const response = await fetch('/api/objects?' + params.toString());
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        state.objects = append ? state.objects.concat(data.objects) : data.objects;
        state.tree = buildTree(state.objects);
        if (!append) state.selectedPrefix = '';
        state.nextContinuationToken = data.nextContinuationToken;
      } catch (error) {
        state.error = error.message;
      } finally {
        state.loading = false;
        render();
      }
    }

    async function showDetails(object, trigger) {
      state.lastDialogTrigger = trigger || null;
      els.dialogTitle.textContent = object.key;
      els.dialogPreview.innerHTML = object.isImage
        ? '<img src="' + escapeAttr(object.url) + '" alt="' + escapeAttr(object.key) + '">'
        : '<span class="file-icon">' + escapeHtml(object.extension || 'file') + '</span>';
      els.dialogMeta.textContent = JSON.stringify(object, null, 2);
      els.details.showModal();

      try {
        const response = await fetch('/api/info?key=' + encodeURIComponent(object.key));
        if (response.ok) {
          const info = await response.json();
          els.dialogMeta.textContent = JSON.stringify(info, null, 2);
        }
      } catch (_) {
        // Keep list metadata visible if HEAD lookup fails.
      }
    }

    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
      state.prefix = els.prefix.value.trim();
      state.max = parseClientMax(els.max.value);
      els.max.value = state.max;
      state.nextContinuationToken = null;
      loadObjects();
    });

    els.type.addEventListener('click', (event) => {
      const option = event.target.closest('[data-type]');
      if (option) {
        selectType(option.dataset.type);
        return;
      }

      if (event.target.closest('.filterTrigger')) {
        if (state.typeOpen) closeTypeMenu(false);
        else openTypeMenu(false);
      }
    });

    els.typeTrigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openTypeMenu(true);
        if (event.key === 'ArrowUp') focusTypeOption(-1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (state.typeOpen) closeTypeMenu(false);
        else openTypeMenu(true);
      } else if (event.key === 'Escape' && state.typeOpen) {
        event.preventDefault();
        closeTypeMenu(true);
      }
    });

    els.typeList.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTypeMenu(true);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusTypeOption(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusTypeOption(-1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        typeOptions()[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        const options = typeOptions();
        options[options.length - 1]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        const option = event.target.closest('[data-type]');
        if (option) {
          event.preventDefault();
          selectType(option.dataset.type);
          els.typeTrigger.focus();
        }
      }
    });

    els.type.addEventListener('focusout', (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        closeTypeMenu(false);
      }
    });

    els.search.addEventListener('input', () => {
      state.search = els.search.value;
      render();
    });

    els.more.addEventListener('click', () => loadObjects({ append: true }));
    els.close.addEventListener('click', () => els.details.close());
    els.details.addEventListener('close', () => {
      if (state.lastDialogTrigger && document.contains(state.lastDialogTrigger)) {
        state.lastDialogTrigger.focus();
      }
      state.lastDialogTrigger = null;
    });

    els.tree.addEventListener('click', (event) => {
      const node = event.target.closest('[data-prefix]');
      if (!node) return;
      state.selectedPrefix = node.dataset.prefix || '';
      render();
    });

    els.content.addEventListener('click', async (event) => {
      if (event.target.closest('[data-clear-filters]')) {
        clearFilters();
        return;
      }
      const copyTarget = event.target.closest('[data-copy]');
      if (copyTarget) {
        await copyValue(copyTarget.dataset.copy);
        return;
      }
      const thumb = event.target.closest('[data-index]');
      if (thumb) {
        showDetails(visibleObjects()[Number.parseInt(thumb.dataset.index, 10)], thumb);
      }
    });

    document.addEventListener('pointerdown', (event) => {
      if (state.typeOpen && !els.type.contains(event.target)) {
        closeTypeMenu(false);
      }
    });

    loadObjects();
  </script>
</body>
</html>`;
}

function createServer(initialOptions = DEFAULT_OPTIONS) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      if (url.pathname === '/') {
        sendHtml(res, renderHtml(initialOptions));
        return;
      }

      if (url.pathname === '/api/objects') {
        const data = await listObjects({
          prefix: url.searchParams.get('prefix') || '',
          max: parsePositiveInt(url.searchParams.get('max'), initialOptions.max, 1, 1000),
          continuationToken: url.searchParams.get('continuationToken') || '',
        });
        sendJson(res, 200, data);
        return;
      }

      if (url.pathname === '/api/info') {
        const key = url.searchParams.get('key') || '';
        if (!key) {
          sendJson(res, 400, { error: 'Missing key' });
          return;
        }
        sendJson(res, 200, await getObjectInfo(key));
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      sendJson(res, 500, { error: redactSensitiveText(err.message) });
    }
  });
}

function printUsage() {
  console.log('R2 Asset Gallery');
  console.log('');
  console.log('Usage: node scripts/r2-gallery.js [--host 127.0.0.1] [--port 8787] [--prefix <prefix>] [--max <N>] [--open]');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/r2-gallery.js');
  console.log('  node scripts/r2-gallery.js --prefix blog/ --max 200');
}

function openBrowser(url) {
  const { spawn } = require('node:child_process');
  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    printUsage();
    return null;
  }

  const server = createServer(options);
  await new Promise((resolve) => server.listen(options.port, options.host, resolve));

  const address = `http://${options.host}:${options.port}/`;
  console.log(`R2 Asset Gallery: ${address}`);
  console.log('Press Ctrl+C to stop.');

  if (options.open) openBrowser(address);
  return server;
}

if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start gallery:', err.message);
    process.exit(1);
  });
}

module.exports = {
  buildListResponse,
  buildObjectView,
  buildPathTree,
  createServer,
  getExtension,
  isImageKey,
  main,
  parseArgs,
  publicObjectUrl,
  redactSensitiveText,
  renderHtml,
};
