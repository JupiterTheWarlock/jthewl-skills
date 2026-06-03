#!/usr/bin/env node
/**
 * R2 Manage — 统一入口分发器
 * 
 * 用法: node r2.js <command> [args...]
 * 
 * 命令:
 *   upload <file> [--path <prefix>]       上传文件
 *   list [<prefix>] [--max <N>] [--json]  列出对象
 *   info <key> [--json]                   查看对象元信息
 *   rename <src> <dest> [--force]         重命名对象
 */

const path = require('path');

const COMMANDS = {
  upload: { file: './r2-upload.js', desc: 'upload <file> [--path <prefix>] [--name <name>] [--desc <desc>]  \u4E0A\u4F20\u6587\u4EF6' },
  list:   { file: './r2-list.js',   desc: 'list [<prefix>] [--max <N>] [--json]  \u5217\u51FA\u5BF9\u8C61' },
  info:   { file: './r2-info.js',   desc: 'info <key> [--json]                   \u67E5\u770B\u5143\u4FE1\u606F' },
  desc:   { file: './r2-desc.js',   desc: 'desc <key> <description>              \u8BBE\u7F6E/\u66F4\u65B0\u63CF\u8FF0' },
  rename: { file: './r2-rename.js', desc: 'rename <src> <dest> [--force]         \u91CD\u547D\u540D\u5BF9\u8C61' },
  gallery:{ file: './r2-gallery.js',desc: 'gallery [--port <N>] [--prefix <p>]   \u542F\u52A8\u672C\u5730\u9884\u89C8\u524D\u7AEF' },
};

function printUsage() {
  console.log('R2 Manage \u2014 Cloudflare R2 \u6587\u4EF6\u7BA1\u7406\u5DE5\u5177\n');
  console.log('\u7528\u6CD5: node r2.js <command> [args...]\n');
  console.log('\u547D\u4EE4:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.desc}`);
  }
  console.log('\n\u793A\u4F8B:');
  console.log('  node r2.js upload photo.png --path blog --name "homepage-hero"');
  console.log('  node r2.js list blog/ --max 20');
  console.log('  node r2.js info blog/2024/01/15/a3f8c2d1.png');
  console.log('  node r2.js rename old/key.png new/key.png');
  console.log('  node r2.js gallery --prefix blog/ --max 200');
}

async function dispatch() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  if (!COMMANDS[command]) {
    console.error(`\u274C \u672A\u77E5\u547D\u4EE4: ${command}\n`);
    printUsage();
    process.exit(1);
  }

  const cmdModule = require(COMMANDS[command].file);
  const cmdArgs = args.slice(1);

  // 解析各命令的参数
  switch (command) {
    case 'upload': {
      let filePath = null;
      const options = {};
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--path' && cmdArgs[i + 1]) {
          options.path = cmdArgs[++i];
        } else if (cmdArgs[i] === '--name' && cmdArgs[i + 1]) {
          options.name = cmdArgs[++i];
        } else if (cmdArgs[i] === '--desc' && cmdArgs[i + 1]) {
          options.desc = cmdArgs[++i];
        } else if (!cmdArgs[i].startsWith('--')) {
          filePath = cmdArgs[i];
        }
      }
      if (!filePath) {
        console.error('\u274C \u7F3A\u5C11\u6587\u4EF6\u8DEF\u5F84');
        console.log('\u7528\u6CD5: node r2.js upload <file> [--path <prefix>] [--name <name>] [--desc <description>]');
        process.exit(1);
      }
      await cmdModule.main(filePath, options);
      break;
    }
    case 'list': {
      let prefix = '';
      const options = {};
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--max' && cmdArgs[i + 1]) {
          options.max = parseInt(cmdArgs[++i], 10);
        } else if (cmdArgs[i] === '--json') {
          options.json = true;
        } else if (!cmdArgs[i].startsWith('--')) {
          prefix = cmdArgs[i];
        }
      }
      await cmdModule.main(prefix, options);
      break;
    }
    case 'info': {
      let key = '';
      const options = {};
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--json') {
          options.json = true;
        } else if (!cmdArgs[i].startsWith('--')) {
          key = cmdArgs[i];
        }
      }
      if (!key) {
        console.error('\u274C \u7F3A\u5C11\u5BF9\u8C61 key');
        console.log('\u7528\u6CD5: node r2.js info <key> [--json]');
        process.exit(1);
      }
      await cmdModule.main(key, options);
      break;
    }
    case 'desc': {
      const positional = [];
      for (let i = 0; i < cmdArgs.length; i++) {
        if (!cmdArgs[i].startsWith('--')) {
          positional.push(cmdArgs[i]);
        }
      }
      const key = positional[0] || '';
      const description = positional.slice(1).join(' ') || '';
      if (!key || !description) {
        console.error('\u274C \u7F3A\u5C11\u53C2\u6570');
        console.log('\u7528\u6CD5: node r2.js desc <key> <description>');
        process.exit(1);
      }
      await cmdModule.main(key, description);
      break;
    }
    case 'rename': {
      const positional = [];
      const options = {};
      for (let i = 0; i < cmdArgs.length; i++) {
        if (cmdArgs[i] === '--force') {
          options.force = true;
        } else if (!cmdArgs[i].startsWith('--')) {
          positional.push(cmdArgs[i]);
        }
      }
      if (positional.length < 2) {
        console.error('\u274C \u7F3A\u5C11\u53C2\u6570');
        console.log('\u7528\u6CD5: node r2.js rename <source-key> <dest-key> [--force]');
        process.exit(1);
      }
      await cmdModule.main(positional[0], positional[1], options);
      break;
    }
    case 'gallery': {
      await cmdModule.main(cmdArgs);
      break;
    }
  }
}

dispatch().catch(err => {
  console.error('\u274C', err.message);
  process.exit(1);
});
