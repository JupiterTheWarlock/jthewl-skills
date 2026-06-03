#!/usr/bin/env node

/**
 * thread_x.js — X/Twitter 推文线程检测与分组
 *
 * 接收 opencli twitter tweets -f json 的输出，基于时间窗口启发式检测自回复线程。
 *
 * Usage:
 *   node thread_x.js <input.json> [--window <minutes>]
 *   cat tweets.json | node thread_x.js --stdin [--window <minutes>]
 */

const fs = require("fs");
const path = require("path");

function usage() {
  console.error("Usage: node thread_x.js <input.json> [--window <minutes>]");
  console.error("       cat tweets.json | node thread_x.js --stdin [--window <minutes>]");
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  let inputFile = null;
  let useStdin = false;
  let windowMinutes = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stdin") {
      useStdin = true;
    } else if (args[i] === "--window" && args[i + 1]) {
      windowMinutes = parseFloat(args[++i]);
      if (isNaN(windowMinutes) || windowMinutes <= 0) {
        console.error("Error: --window must be a positive number");
        process.exit(2);
      }
    } else if (args[i] === "--help" || args[i] === "-h") {
      usage();
    } else if (!inputFile && !args[i].startsWith("-")) {
      inputFile = args[i];
    } else {
      usage();
    }
  }

  if (!inputFile && !useStdin) usage();
  return { inputFile, useStdin, windowMinutes };
}

function parseTwitterDate(dateStr) {
  // Twitter format: "Fri May 15 03:00:10 +0000 2026"
  return new Date(dateStr);
}

function detectThreads(tweets, windowMinutes) {
  // Step 1: Filter out retweets, keep only original content
  const original = tweets.filter((t) => !t.is_retweet);

  // Step 2: Sort by created_at ascending
  const sorted = [...original].sort(
    (a, b) => parseTwitterDate(a.created_at) - parseTwitterDate(b.created_at)
  );

  if (sorted.length === 0) {
    return { threads: [], standalone: [] };
  }

  // Step 3: Group by time window
  const windowMs = windowMinutes * 60 * 1000;
  const groups = [];
  let currentGroup = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = parseTwitterDate(sorted[i - 1].created_at).getTime();
    const currTime = parseTwitterDate(sorted[i].created_at).getTime();
    const gap = currTime - prevTime;

    if (gap <= windowMs) {
      currentGroup.push(sorted[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
    }
  }
  groups.push(currentGroup);

  // Step 4: Separate threads (2+ tweets) from standalone (1 tweet)
  const threads = [];
  const standalone = [];

  for (const group of groups) {
    if (group.length >= 2) {
      const root = group[0];
      const allMediaUrls = group.flatMap((t) => t.media_urls || []);
      threads.push({
        root_id: root.id,
        tweet_count: group.length,
        time_span_minutes: Math.round(
          (parseTwitterDate(group[group.length - 1].created_at) -
            parseTwitterDate(group[0].created_at)) /
            60000 * 10
        ) / 10,
        root_text_preview: root.text.slice(0, 80).replace(/\n/g, " "),
        tweets: group,
        all_media_urls: allMediaUrls,
      });
    } else {
      standalone.push(group[0]);
    }
  }

  return { threads, standalone };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const { inputFile, useStdin, windowMinutes } = parseArgs();

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

  let tweets;
  try {
    tweets = JSON.parse(rawJson);
  } catch (e) {
    console.error(`Error: Invalid JSON input - ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(tweets)) {
    console.error("Error: Input must be a JSON array of tweet objects");
    process.exit(1);
  }

  const result = detectThreads(tweets, windowMinutes);

  // Summary to stderr for human readability
  console.error(
    `Detected ${result.threads.length} thread(s), ${result.standalone.length} standalone tweet(s)`
  );
  for (const thread of result.threads) {
    console.error(
      `  Thread [${thread.tweet_count} tweets, ${thread.time_span_minutes}min]: ${thread.root_text_preview}`
    );
  }

  // Structured output to stdout
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
