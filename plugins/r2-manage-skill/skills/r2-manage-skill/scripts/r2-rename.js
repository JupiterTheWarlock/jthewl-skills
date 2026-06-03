#!/usr/bin/env node
/**
 * R2 Manage — rename 命令
 * 
 * 重命名 R2 对象（通过 CopyObject + DeleteObject 实现）。
 * 
 * 用法: node r2-rename.js <source-key> <dest-key> [--force]
 */

const { HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getClient, getConfig } = require('./lib/client');

async function main(sourceKey, destKey, options = {}) {
  const force = options.force || false;

  const client = getClient();
  const config = getConfig();

  // 1. 验证源对象存在
  let sourceHead;
  try {
    sourceHead = await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: sourceKey,
    }));
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      console.error(`\u274C \u6E90\u5BF9\u8C61\u4E0D\u5B58\u5728: ${sourceKey}`);
      process.exit(1);
    }
    throw err;
  }

  // 2. 检查目标是否已存在（除非 --force）
  if (!force) {
    try {
      await client.send(new HeadObjectCommand({
        Bucket: config.bucket,
        Key: destKey,
      }));
      console.error(`\u274C \u76EE\u6807\u8DEF\u5F84\u5DF2\u5B58\u5728: ${destKey}`);
      console.error('   \u4F7F\u7528 --force \u8986\u76D6\u5DF2\u6709\u6587\u4EF6');
      process.exit(1);
    } catch (err) {
      if (err.name !== 'NotFound' && err.$metadata?.httpStatusCode !== 404) {
        throw err;
      }
      // NotFound = 好，目标不存在可以继续
    }
  }

  // 3. 复制到新位置
  const copySource = `${config.bucket}/${sourceKey}`;
  try {
    await client.send(new CopyObjectCommand({
      Bucket: config.bucket,
      Key: destKey,
      CopySource: encodeURI(copySource),
      ContentType: sourceHead.ContentType,
      MetadataDirective: 'REPLACE',
    }));
  } catch (err) {
    console.error(`\u274C \u590D\u5236\u5931\u8D25: ${err.message}`);
    console.error('   \u6E90\u5BF9\u8C61\u672A\u88AB\u5220\u9664\u3002');
    process.exit(1);
  }

  // 4. 验证复制成功
  try {
    await client.send(new HeadObjectCommand({
      Bucket: config.bucket,
      Key: destKey,
    }));
  } catch (err) {
    console.error(`\u274C \u590D\u5236\u9A8C\u8BC1\u5931\u8D25\uFF0C\u76EE\u6807\u5BF9\u8C61\u672A\u627E\u5230: ${destKey}`);
    console.error('   \u6E90\u5BF9\u8C61\u672A\u88AB\u5220\u9664\u3002');
    process.exit(1);
  }

  // 5. 删除源对象
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: sourceKey,
    }));
  } catch (err) {
    console.error(`\u26A0\uFE0F \u590D\u5236\u6210\u529F\u4F46\u5220\u9664\u6E90\u5BF9\u8C61\u5931\u8D25: ${err.message}`);
    console.error(`   \u65B0\u4F4D\u7F6E: ${config.publicUrl}/${destKey}`);
    console.error(`   \u65E7\u4F4D\u7F6E\u53EF\u80FD\u4ECD\u5B58\u5728: ${config.publicUrl}/${sourceKey}`);
    process.exit(1);
  }

  const oldUrl = `${config.publicUrl}/${sourceKey}`;
  const newUrl = `${config.publicUrl}/${destKey}`;
  console.log(`\u2705 \u91CD\u547D\u540D\u6210\u529F:`);
  console.log(`   ${oldUrl}`);
  console.log(`   \u2192 ${newUrl}`);

  return { oldUrl, newUrl, sourceKey, destKey };
}

// 独立运行
if (require.main === module) {
  const args = process.argv.slice(2);
  let sourceKey = '';
  let destKey = '';
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') {
      options.force = true;
    } else if (!args[i].startsWith('--')) {
      positional.push(args[i]);
    }
  }

  sourceKey = positional[0] || '';
  destKey = positional[1] || '';

  if (!sourceKey || !destKey) {
    console.log('\u7528\u6CD5: r2-rename <source-key> <dest-key> [--force]');
    console.log('\u793A\u4F8B: r2-rename 2024/01/15/a3f8c2d1.png blog/cover.png');
    console.log('');
    console.log('\u9009\u9879:');
    console.log('  --force    \u8986\u76D6\u5DF2\u5B58\u5728\u7684\u76EE\u6807\u6587\u4EF6');
    process.exit(1);
  }

  main(sourceKey, destKey, options).catch(err => {
    console.error('\u274C \u91CD\u547D\u540D\u5931\u8D25:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
