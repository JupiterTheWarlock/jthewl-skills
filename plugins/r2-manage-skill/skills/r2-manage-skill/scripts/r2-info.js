#!/usr/bin/env node
/**
 * R2 Manage — info 命令
 * 
 * 获取 R2 对象的元数据信息。
 * 
 * 用法: node r2-info.js <key> [--json]
 */

const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getClient, getConfig } = require('./lib/client');
const { formatSize, formatDate, printJson } = require('./lib/format');

async function main(key, options = {}) {
  const jsonOutput = options.json || false;

  const client = getClient();
  const config = getConfig();

  try {
    const response = await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));

    const info = {
      key: key,
      contentType: response.ContentType,
      size: response.ContentLength,
      lastModified: response.LastModified,
      etag: response.ETag,
      description: response.Metadata?.description || '',
      url: `${config.publicUrl}/${key}`,
    };

    if (jsonOutput) {
      printJson({
        key: info.key,
        contentType: info.contentType,
        size: info.size,
        lastModified: info.lastModified ? info.lastModified.toISOString() : null,
        etag: info.etag,
        description: info.description,
        url: info.url,
      });
      return info;
    }

    console.log(`\u{1F4C4} ${key}`);
    console.log(`   Type:     ${info.contentType || '-'}`);
    console.log(`   Size:     ${formatSize(info.size)}`);
    console.log(`   Modified: ${formatDate(info.lastModified)}`);
    console.log(`   ETag:     ${info.etag || '-'}`);
    if (info.description) {
      console.log(`   Desc:     ${info.description}`);
    }
    console.log(`   URL:      ${info.url}`);

    return info;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      console.error(`\u274C \u5BF9\u8C61\u4E0D\u5B58\u5728: ${key}`);
      process.exit(1);
    }
    throw err;
  }
}

// 独立运行
if (require.main === module) {
  const args = process.argv.slice(2);
  let key = '';
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      options.json = true;
    } else if (!args[i].startsWith('--')) {
      key = args[i];
    }
  }

  if (!key) {
    console.log('\u7528\u6CD5: r2-info <key> [--json]');
    console.log('\u793A\u4F8B: r2-info 2024/01/15/a3f8c2d1.png');
    process.exit(1);
  }

  main(key, options).catch(err => {
    console.error('\u274C \u67E5\u8BE2\u5931\u8D25:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
