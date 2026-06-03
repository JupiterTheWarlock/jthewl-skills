#!/usr/bin/env node

/**
 * generate_essay.js — Markdown 随笔生成 + R2 图片上传
 *
 * 接收标准化的 essay 输入描述（JSON），生成 Quartz 兼容的 markdown 文件。
 * 可选上传图片到 R2 CDN。
 *
 * Usage:
 *   node generate_essay.js <input.json> [--dry-run]
 *   cat input.json | node generate_essay.js --stdin [--dry-run]
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function usage() {
  console.error("Usage: node generate_essay.js <input.json> [--dry-run]");
  console.error("       cat input.json | node generate_essay.js --stdin [--dry-run]");
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let inputFile = null;
  let useStdin = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stdin") {
      useStdin = true;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      usage();
    } else if (!inputFile && !args[i].startsWith("-")) {
      inputFile = args[i];
    } else {
      usage();
    }
  }

  if (!inputFile && !useStdin) usage();
  return { inputFile, useStdin, dryRun };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function downloadImage(url, destPath) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return buffer.length;
}

function uploadToR2(filePath, r2SkillDir, prefix, name, desc) {
  const scriptPath = path.join(r2SkillDir, "scripts", "r2.js");
  const args = [
    "node",
    `"${scriptPath}"`,
    "upload",
    `"${filePath}"`,
    "--path",
    prefix,
    "--name",
    `"${name}"`,
  ];
  if (desc) {
    args.push("--desc", `"${desc}"`);
  }

  const cmd = args.join(" ");
  const result = execSync(cmd, {
    cwd: r2SkillDir,
    encoding: "utf8",
    timeout: 30000,
  });

  // Parse CDN URL from output like "✅ 上传成功: https://cfr2cdn.jthewl.cc/..."
  const match = result.match(/https:\/\/[^\s]+/);
  if (!match) {
    throw new Error(`R2 upload did not return a URL. Output: ${result}`);
  }
  return match[0];
}

function buildMarkdown(config, imageUrlMap) {
  const lines = [];

  // Frontmatter
  lines.push("---");
  lines.push(`title: ${config.title}`);
  lines.push(`date: ${config.date}`);
  lines.push("tags:");
  for (const tag of config.tags) {
    lines.push(`  - ${tag}`);
  }
  lines.push("---");
  lines.push("");

  // Segments
  for (let i = 0; i < config.segments.length; i++) {
    const segment = config.segments[i];

    if (i > 0) {
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    if (segment.text) {
      lines.push(segment.text.trim());
    }

    if (segment.images && segment.images.length > 0) {
      lines.push("");
      for (const img of segment.images) {
        const imageKey = img.name || img.url;
        const cdnUrl = imageUrlMap[imageKey] || img.url;
        const alt = img.desc || img.name || "image";
        lines.push(`![${alt}](${cdnUrl})`);
        lines.push("");
      }
    }
  }

  // Source link
  lines.push("---");
  lines.push("");
  const platformName =
    config.source_platform === "x"
      ? "X"
      : config.source_platform === "xhs"
        ? "\u5c0f\u7ea2\u4e66"
        : config.source_platform;
  lines.push(`\u539f\u6587\u94fe\u63a5\uff1a[${platformName}](${config.source_url})`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const { inputFile, useStdin, dryRun } = parseArgs();

  let rawJson;
  if (useStdin) {
    rawJson = await readStdin();
  } else {
    const resolved = path.resolve(inputFile);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: File not found: ${resolved}`);
      process.exit(1);
    }
    rawJson = fs.readFileSync(resolved, "utf8");
  }

  let config;
  try {
    config = JSON.parse(rawJson);
  } catch (e) {
    console.error(`Error: Invalid JSON - ${e.message}`);
    process.exit(1);
  }

  // Validate required fields
  const required = ["title", "date", "tags", "source_platform", "source_url", "segments", "output_dir", "output_filename"];
  for (const field of required) {
    if (!config[field]) {
      console.error(`Error: Missing required field: ${field}`);
      process.exit(1);
    }
  }

  // Collect all images that need processing
  const allImages = [];
  for (const segment of config.segments) {
    if (segment.images) {
      allImages.push(...segment.images);
    }
  }

  const imageUrlMap = {};

  if (allImages.length > 0 && !dryRun) {
    // Create temp dir for downloads
    const tmpDir = path.join(config.output_dir, ".tmp_images");
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const img of allImages) {
      const ext = path.extname(new URL(img.url).pathname) || ".jpg";
      const localName = `${img.name}${ext}`;
      const localPath = path.join(tmpDir, localName);

      console.error(`Downloading: ${img.name}...`);
      await downloadImage(img.url, localPath);

      if (config.upload_to_r2 && config.r2_skill_dir) {
        console.error(`Uploading to R2: ${img.name}...`);
        try {
          const cdnUrl = uploadToR2(
            localPath,
            config.r2_skill_dir,
            config.r2_prefix || "blog/essays",
            img.name,
            img.desc || ""
          );
          imageUrlMap[img.name] = cdnUrl;
          console.error(`  -> ${cdnUrl}`);
        } catch (e) {
          console.error(`  R2 upload failed: ${e.message}`);
          console.error(`  Falling back to original URL`);
          imageUrlMap[img.name] = img.url;
        }
      } else {
        imageUrlMap[img.name] = img.url;
      }
    }

    // Cleanup temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else if (dryRun) {
    // In dry-run, use placeholder URLs
    for (const img of allImages) {
      imageUrlMap[img.name] = `[R2_CDN]/${img.name}`;
    }
  }

  // Generate markdown
  const markdown = buildMarkdown(config, imageUrlMap);

  if (dryRun) {
    console.log("=== DRY RUN OUTPUT ===");
    console.log(`Output path: ${path.join(config.output_dir, config.output_filename)}`);
    console.log(`Images: ${allImages.length}`);
    console.log("=== MARKDOWN ===");
    console.log(markdown);
    return;
  }

  // Write the essay file
  fs.mkdirSync(config.output_dir, { recursive: true });
  const outputPath = path.join(config.output_dir, config.output_filename);
  fs.writeFileSync(outputPath, markdown, "utf8");

  // Output summary
  const summary = {
    title: config.title,
    output_path: outputPath,
    images_processed: allImages.length,
    cdn_urls: Object.values(imageUrlMap),
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
