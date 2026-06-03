#!/usr/bin/env node
/**
 * R2 Manage — 输出格式化工具
 */

function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(date) {
  if (!date) return '-';
  if (typeof date === 'string') return date;
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function printTable(rows, columns) {
  if (rows.length === 0) return;
  const widths = columns.map(col => Math.max(
    col.label.length,
    ...rows.map(r => String(r[col.key] || '').length)
  ));
  const header = columns.map((col, i) => col.label.padEnd(widths[i])).join('  ');
  const separator = columns.map((_, i) => '-'.repeat(widths[i])).join('  ');
  console.log(header);
  console.log(separator);
  for (const row of rows) {
    const line = columns.map((col, i) => String(row[col.key] || '').padEnd(widths[i])).join('  ');
    console.log(line);
  }
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

module.exports = { formatSize, formatDate, printTable, printJson };
