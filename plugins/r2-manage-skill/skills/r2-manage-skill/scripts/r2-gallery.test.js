#!/usr/bin/env node

const assert = require('node:assert');

const {
  buildObjectView,
  buildListResponse,
  buildPathTree,
  parseArgs,
  redactSensitiveText,
  renderHtml,
} = require('./r2-gallery');

function testParseArgs() {
  const options = parseArgs(['--port', '9123', '--host', '127.0.0.1', '--prefix', 'blog/', '--max', '60']);

  assert.equal(options.port, 9123);
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.prefix, 'blog/');
  assert.equal(options.max, 60);
}

function testBuildObjectView() {
  const object = buildObjectView(
    {
      Key: 'blog/2026/06/02/hello world.png',
      Size: 1536,
      LastModified: new Date('2026-06-02T05:00:00Z'),
    },
    'https://cdn.example.test/base/'
  );

  assert.equal(object.key, 'blog/2026/06/02/hello world.png');
  assert.equal(object.size, 1536);
  assert.equal(object.lastModified, '2026-06-02T05:00:00.000Z');
  assert.equal(object.url, 'https://cdn.example.test/base/blog/2026/06/02/hello%20world.png');
  assert.equal(object.isImage, true);
  assert.equal(object.extension, 'png');
}

function testBuildListResponse() {
  const response = buildListResponse(
    {
      Contents: [
        { Key: 'a.svg', Size: 100, LastModified: new Date('2026-06-01T00:00:00Z') },
        { Key: 'notes/readme.txt', Size: 20, LastModified: null },
      ],
      IsTruncated: true,
      NextContinuationToken: 'next-page-token',
    },
    'https://cdn.example.test',
    { prefix: 'a', max: 2 }
  );

  assert.equal(response.prefix, 'a');
  assert.equal(response.max, 2);
  assert.equal(response.count, 2);
  assert.equal(response.isTruncated, true);
  assert.equal(response.nextContinuationToken, 'next-page-token');
  assert.equal(response.objects[0].isImage, true);
  assert.equal(response.objects[1].isImage, false);
  assert.equal(response.tree[0].prefix, '');
}

function testBuildPathTreeLimitsDepthToTwoLevels() {
  const tree = buildPathTree([
    { key: 'blog/essays/2026/06/asset.png' },
    { key: 'blog/essays/2026/06/other.png' },
    { key: 'blog/images/cover.jpg' },
    { key: 'avatar.jpg' },
  ]);

  assert.equal(tree.length, 2);
  assert.equal(tree[0].label, 'All assets');
  assert.equal(tree[0].prefix, '');
  assert.equal(tree[0].count, 4);

  const blog = tree[1];
  assert.equal(blog.label, 'blog');
  assert.equal(blog.prefix, 'blog/');
  assert.equal(blog.count, 3);
  assert.equal(blog.children.length, 2);
  assert.deepEqual(blog.children.map(node => node.prefix), ['blog/essays/', 'blog/images/']);
  assert.equal(blog.children[0].count, 2);
}

function testRenderHtmlUsesPlainChildTreeLabels() {
  const html = renderHtml({ prefix: '', max: 100 });

  assert.equal(html.includes('cfr2cdn.jthewl.cc'), false);
  assert.equal(html.includes('JupiterTheWarlock'), false);
  assert.equal(html.includes('class="brand-mark"'), true);
  assert.equal(html.includes("'./' + node.label"), false);
  assert.equal(html.includes('linear-gradient(180deg, var(--accent-bright), var(--accent-dark))'), false);
  assert.equal(html.includes('<select'), false);
  assert.equal(html.includes('class="segmented"'), false);
  assert.equal(html.includes('class="filterMenu"'), true);
  assert.equal(html.includes('class="filterTrigger"'), true);
  assert.equal(html.includes('class="filterMenuList"'), true);
  assert.equal(html.includes('class="filterOption'), true);
  assert.equal(html.includes('id="refresh"'), true);
  assert.equal(html.includes('data-clear-filters'), true);
  assert.equal(html.includes('function fallbackCopy'), true);
  assert.equal(html.includes("event.key === 'ArrowDown'"), true);
  assert.equal(html.includes('@media (max-width: 760px)'), true);
  assert.equal(html.includes('.tree-node:hover'), true);
  assert.equal(html.includes('align-items: center;'), true);
}

function testRedactSensitiveText() {
  const previous = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
  };

  process.env.R2_ACCOUNT_ID = 'account-123';
  process.env.R2_BUCKET = 'private-bucket';
  process.env.R2_PUBLIC_URL = 'https://cdn.private.example';

  const redacted = redactSensitiveText('NoSuchBucket private-bucket on account-123 at https://cdn.private.example');
  assert.equal(redacted.includes('account-123'), false);
  assert.equal(redacted.includes('private-bucket'), false);
  assert.equal(redacted.includes('cdn.private.example'), false);
  assert.equal(redacted.includes('[redacted-account-id]'), true);
  assert.equal(redacted.includes('[redacted-bucket]'), true);
  assert.equal(redacted.includes('[redacted-public-url]'), true);

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function run() {
  testParseArgs();
  testBuildObjectView();
  testBuildListResponse();
  testBuildPathTreeLimitsDepthToTwoLevels();
  testRenderHtmlUsesPlainChildTreeLabels();
  testRedactSensitiveText();
  console.log('r2-gallery tests passed');
}

run();
