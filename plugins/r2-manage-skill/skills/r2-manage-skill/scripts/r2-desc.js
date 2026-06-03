#!/usr/bin/env node
/**
 * R2 Manage — desc 命令
 * 
 * 为已有对象设置/更新 description 元数据（通过 copy-in-place 实现）。
 * 
 * 用法: node r2-desc.js <key> <description>
 */

const { HeadObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const { getClient, getConfig } = require('./lib/client');

async function main(key, description) {
  const client = getClient();
  const config = getConfig();

  // 1. 获取当前对象的元数据
  let head;
  try {
    head = await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      console.error(`\u274C \u5BF9\u8C61\u4E0D\u5B58\u5728: ${key}`);
      process.exit(1);
    }
    throw err;
  }

  // 2. 合并现有元数据与新 description
  const existingMetadata = head.Metadata || {};
  const newMetadata = { ...existingMetadata, description: description };

  // 3. Copy-in-place，替换元数据
  const copySource = `${config.bucket}/${key}`;
  try {
    await client.send(new CopyObjectCommand({
      Bucket: config.bucket,
      Key: key,
      CopySource: encodeURI(copySource),
      ContentType: head.ContentType,
      MetadataDirective: 'REPLACE',
      Metadata: newMetadata,
    }));
  } catch (err) {
    console.error(`\u274C \u66F4\u65B0\u5143\u6570\u636E\u5931\u8D25: ${err.message}`);
    process.exit(1);
  }

  console.log(`\u2705 \u5DF2\u66F4\u65B0\u63CF\u8FF0: ${key}`);
  console.log(`   Desc: ${description}`);

  return { key, description };
}

// 独立运行
if (require.main === module) {
  const args = process.argv.slice(2);
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  const key = positional[0] || '';
  const description = positional.slice(1).join(' ') || '';

  if (!key || !description) {
    console.log('\u7528\u6CD5: r2-desc <key> <description>');
    console.log('\u793A\u4F8B: r2-desc misc/2026/05/06/meme.png "A man refusing a brain because he uses AI to code"');
    process.exit(1);
  }

  main(key, description).catch(err => {
    console.error('\u274C \u64CD\u4F5C\u5931\u8D25:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
