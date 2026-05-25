---
name: xhs-note-scraper
description: Export public Xiaohongshu/XHS note pages to Markdown, JSON, raw HTML, and downloaded images. Use when the user asks to scrape, archive, save, download, or "扒下来" a public xiaohongshu.com/explore note, especially when avoiding browser automation, local browser access, or logged-in account risk.
---

# XHS Note Scraper

## Core Rule

Use only public HTTP fetches. Do not use local browser automation, user login cookies, account sessions, or attempts to bypass access controls. If the public page does not expose SSR note data or image URLs, report that limitation and stop.

## Quick Start

Run the bundled script:

```bash
node <skill-dir>/scripts/scrape_xhs_note.js "<xiaohongshu note url>" --out "<output-dir>"
```

Use the user's current workspace as the default output directory unless they specify another path.

The script writes:

- `note.md` - readable Markdown with text, metadata, and local image references
- `note.json` - structured note data and image URLs
- `page.html` - fetched public HTML
- `assets/image-XX.jpg` - downloaded images

## Workflow

1. Confirm the URL is a Xiaohongshu note URL, typically `https://www.xiaohongshu.com/explore/<note-id>...`.
2. Run `scripts/scrape_xhs_note.js` with the URL and output directory.
3. Verify the script output summary: title, author, note id, image count, and downloaded image paths.
4. If downloads fail with `403` for raw/original image attempts, keep the public CDN default image URLs exposed by the page.
5. In the final answer, link to `note.md`, `note.json`, `page.html`, and the `assets` directory. Mention any limitations such as missing comments or unavailable original-resolution files.

## Notes

- SSR data is expected in `window.__INITIAL_STATE__`; the script extracts `note.noteDetailMap[firstNoteId].note`.
- Public note pages often expose text, author, tags, basic interaction counts, and images. Comments may remain dynamic and are not guaranteed.
- PowerShell can display UTF-8 Chinese incorrectly through some pipelines. Trust files written by the script as UTF-8 and verify with Node when needed.
