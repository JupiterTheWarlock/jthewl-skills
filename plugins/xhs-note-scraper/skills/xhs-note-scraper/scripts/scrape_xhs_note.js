#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function usage() {
  console.error('Usage: node scrape_xhs_note.js "<xiaohongshu-note-url>" --out "<output-dir>"');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 1) usage();

const url = args[0];
let outDir = process.cwd();
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--out" && args[i + 1]) {
    outDir = args[++i];
  } else {
    usage();
  }
}

if (!/^https:\/\/www\.xiaohongshu\.com\/explore\/[A-Za-z0-9]+/.test(url)) {
  throw new Error("Expected a public https://www.xiaohongshu.com/explore/<note-id> URL.");
}

const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "referer": "https://www.xiaohongshu.com/",
};

async function fetchBytes(targetUrl) {
  const response = await fetch(targetUrl, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${targetUrl}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function extractInitialState(html) {
  const match = html.match(/<script>window\.__INITIAL_STATE__=(.*?)<\/script>/s);
  if (!match) {
    throw new Error("window.__INITIAL_STATE__ was not found in the public HTML.");
  }

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(`window.__INITIAL_STATE__=${match[1]}`, sandbox, { timeout: 1000 });
  return sandbox.window.__INITIAL_STATE__;
}

function normalizeNote(state) {
  const noteId = state?.note?.firstNoteId;
  const note = state?.note?.noteDetailMap?.[noteId]?.note;
  if (!noteId || !note) {
    throw new Error("Public SSR state did not contain note detail data.");
  }

  return {
    sourceUrl: `https://www.xiaohongshu.com/explore/${noteId}`,
    noteId,
    title: note.title || "",
    author: note.user?.nickname || "",
    userId: note.user?.userId || "",
    avatar: note.user?.avatar || "",
    createdAt: note.time ? new Date(note.time).toISOString() : "",
    lastUpdateAt: note.lastUpdateTime ? new Date(note.lastUpdateTime).toISOString() : "",
    ipLocation: note.ipLocation || "",
    tags: (note.tagList || []).map((tag) => tag.name).filter(Boolean),
    desc: note.desc || "",
    interactInfo: note.interactInfo || {},
    images: (note.imageList || []).map((image, index) => ({
      index: index + 1,
      width: image.width || null,
      height: image.height || null,
      urlDefault: image.urlDefault || image.infoList?.find((item) => item.imageScene === "WB_DFT")?.url || "",
      urlPre: image.urlPre || image.infoList?.find((item) => item.imageScene === "WB_PRV")?.url || "",
    })).filter((image) => image.urlDefault || image.urlPre),
  };
}

function markdown(note) {
  const imageLines = [];
  for (const image of note.images) {
    const localName = `assets/image-${String(image.index).padStart(2, "0")}.jpg`;
    imageLines.push(`### Image ${image.index} (source metadata: ${image.width || "?"}x${image.height || "?"})`);
    imageLines.push("");
    imageLines.push(`![image ${image.index}](${localName})`);
    imageLines.push("");
    imageLines.push(image.urlDefault || image.urlPre);
    imageLines.push("");
  }

  return [
    `# ${note.title}`,
    "",
    `- Author: ${note.author}`,
    `- Note ID: ${note.noteId}`,
    `- Created at: ${note.createdAt}`,
    `- IP location: ${note.ipLocation}`,
    `- Source: ${note.sourceUrl}`,
    `- Tags: ${note.tags.map((tag) => `#${tag}`).join(" ")}`,
    `- Likes: ${note.interactInfo.likedCount ?? ""}`,
    `- Favorites: ${note.interactInfo.collectedCount ?? ""}`,
    `- Comments: ${note.interactInfo.commentCount ?? ""}`,
    `- Shares: ${note.interactInfo.shareCount ?? ""}`,
    "",
    "## Text",
    "",
    note.desc.replace(/\t/g, "").trim(),
    "",
    "## Images",
    "",
    ...imageLines,
  ].join("\n");
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const html = (await fetchBytes(url)).toString("utf8");
  fs.writeFileSync(path.join(outDir, "page.html"), html, "utf8");

  const state = extractInitialState(html);
  const note = normalizeNote(state);

  for (const image of note.images) {
    const imageUrl = image.urlDefault || image.urlPre;
    const filePath = path.join(assetsDir, `image-${String(image.index).padStart(2, "0")}.jpg`);
    const data = await fetchBytes(imageUrl);
    fs.writeFileSync(filePath, data);
    image.localPath = path.relative(outDir, filePath).replace(/\\/g, "/");
    image.downloadedBytes = data.length;
  }

  fs.writeFileSync(path.join(outDir, "note.json"), JSON.stringify(note, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "note.md"), markdown(note), "utf8");

  console.log(JSON.stringify({
    title: note.title,
    author: note.author,
    noteId: note.noteId,
    images: note.images.length,
    outDir: path.resolve(outDir),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
