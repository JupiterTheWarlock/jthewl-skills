#!/usr/bin/env node
/**
 * R2 Manage — list 命令
 * 
 * 列出 R2 bucket 中的对象，支持按前缀过滤。
 * 
 * 用法: node r2-list.js [<prefix>] [--max <N>] [--json]
 */

const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getClient, getConfig } = require('./lib/client');
const { formatSize, formatDate, printTable, printJson } = require('./lib/format');

async function main(prefix = '', options = {}) {
  const maxKeys = options.max || 100;
  const jsonOutput = options.json || false;

  const client = getClient();
  const config = getConfig();

  const allObjects = [];
  let continuationToken = undefined;

  while (allObjects.length < maxKeys) {
    const params = {
      Bucket: config.bucket,
      MaxKeys: Math.min(1000, maxKeys - allObjects.length),
    };
    if (prefix) params.Prefix = prefix;
    if (continuationToken) params.ContinuationToken = continuationToken;

    const response = await client.send(new ListObjectsV2Command(params));

    if (response.Contents) {
      allObjects.push(...response.Contents);
    }

    if (!response.IsTruncated) break;
    continuationToken = response.NextContinuationToken;
  }

  const results = allObjects.slice(0, maxKeys).map(obj => ({
    key: obj.Key,
    size: obj.Size,
    lastModified: obj.LastModified,
    url: `${config.publicUrl}/${obj.Key}`,
  }));

  if (jsonOutput) {
    printJson(results.map(r => ({
      key: r.key,
      size: r.size,
      lastModified: r.lastModified ? r.lastModified.toISOString() : null,
      url: r.url,
    })));
    return results;
  }

  if (results.length === 0) {
    console.log('\u{1F4ED} \u672A\u627E\u5230\u5339\u914D\u7684\u6587\u4EF6');
    if (prefix) console.log(`   \u524D\u7F00: ${prefix}`);
    return results;
  }

  console.log(`\u{1F4C2} \u5171\u627E\u5230 ${results.length} \u4E2A\u6587\u4EF6${prefix ? ` (\u524D\u7F00: ${prefix})` : ''}:\n`);
  printTable(
    results.map(r => ({
      key: r.key,
      size: formatSize(r.size),
      modified: formatDate(r.lastModified),
    })),
    [
      { key: 'key', label: 'Key' },
      { key: 'size', label: 'Size' },
      { key: 'modified', label: 'Modified' },
    ]
  );

  return results;
}

// 独立运行
if (require.main === module) {
  const args = process.argv.slice(2);
  let prefix = '';
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max' && args[i + 1]) {
      options.max = parseInt(args[++i], 10);
    } else if (args[i] === '--json') {
      options.json = true;
    } else if (!args[i].startsWith('--')) {
      prefix = args[i];
    }
  }

  main(prefix, options).catch(err => {
    console.error('\u274C \u5217\u51FA\u5931\u8D25:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
