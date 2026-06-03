#!/usr/bin/env node
/**
 * R2 Manage — upload 命令
 * 
 * 上传文件到 Cloudflare R2 并返回公开 URL。
 * 
 * 用法: node r2-upload.js <文件路径> [--path 子目录] [--name 文件名] [--desc 描述]
 * 
 * 命名规则:
 *   --name 指定语义化文件名（不含扩展名），如 --name "blog-cover"
 *   未指定时使用原始文件名（去掉路径）
 *   最终 key: [prefix/]YYYY/MM/DD/<name>.<ext>
 * 
 * 元数据:
 *   --desc 写入自定义元数据 x-amz-meta-description，用于描述图片内容
 */

const { PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { getClient, getConfig } = require('./lib/client');

function getContentType(ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

// 将文件名规范化为 URL 友好格式：小写、空格转连字符、去除特殊字符
function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main(filePath, options = {}) {
  const subPath = options.path || '';
  const customName = options.name || '';
  const desc = options.desc || '';

  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`\u274C \u6587\u4EF6\u4E0D\u5B58\u5728: ${fullPath}`);
    process.exit(1);
  }

  const client = getClient();
  const config = getConfig();

  const ext = path.extname(fullPath);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');

  // 确定文件名: 优先用 --name，否则用原始文件名（去扩展名后 sanitize）
  let name;
  if (customName) {
    name = sanitizeName(customName);
  } else {
    const basename = path.basename(fullPath, ext);
    name = sanitizeName(basename);
  }
  if (!name) name = 'unnamed';

  const key = subPath ? `${subPath}/${date}/${name}${ext}` : `${date}/${name}${ext}`;

  const body = fs.readFileSync(fullPath);
  const contentType = getContentType(ext);

  try {
    const putParams = {
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    };
    if (desc) {
      putParams.Metadata = { description: desc };
    }
    await client.send(new PutObjectCommand(putParams));

    const url = `${config.publicUrl}/${key}`;
    console.log(`\u2705 \u4E0A\u4F20\u6210\u529F: ${url}`);
    return url;
  } catch (err) {
    console.error('\u274C \u4E0A\u4F20\u5931\u8D25:', err.message);
    process.exit(1);
  }
}

// 独立运行
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('\u7528\u6CD5: r2-upload <\u6587\u4EF6\u8DEF\u5F84> [--path \u5B50\u76EE\u5F55] [--name \u6587\u4EF6\u540D] [--desc \u63CF\u8FF0]');
    console.log('\u793A\u4F8B: r2-upload photo.png');
    console.log('      r2-upload photo.png --path blog');
    console.log('      r2-upload photo.png --path blog --name "homepage-hero"');
    console.log('      r2-upload photo.png --name "cover" --desc "Blog homepage hero image"');
    process.exit(1);
  }

  let filePath = null;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && args[i + 1]) {
      options.path = args[++i];
    } else if (args[i] === '--name' && args[i + 1]) {
      options.name = args[++i];
    } else if (args[i] === '--desc' && args[i + 1]) {
      options.desc = args[++i];
    } else if (!args[i].startsWith('--')) {
      filePath = args[i];
    }
  }

  if (filePath) main(filePath, options);
}

module.exports = { main };
