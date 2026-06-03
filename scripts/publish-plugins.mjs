#!/usr/bin/env node
/**
 * publish-plugins.mjs — 从 plugins.registry.yaml 生成所有 marketplace 产物
 *
 * 用法：
 *   node scripts/publish-plugins.mjs [plugin-names...] [options]
 *
 * 选项：
 *   --dry-run           只打印将要执行的操作，不写入文件
 *   --bump <level>      升版本 (patch | minor | major)，同时更新 registry YAML
 *   --no-hub            跳过生成 .jthewl-hub 元数据
 *   --source-root <dir> 覆盖自动检测的 .agents/skills/ 所在根目录
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative, basename } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

// ─── CLI 解析 ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { plugins: [], dryRun: false, bump: null, noHub: false, sourceRoot: null }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--bump' && argv[i + 1]) args.bump = argv[++i]
    else if (arg === '--no-hub') args.noHub = true
    else if (arg === '--source-root' && argv[i + 1]) args.sourceRoot = argv[++i]
    else if (!arg.startsWith('-')) args.plugins.push(arg)
  }
  if (args.bump && !['patch', 'minor', 'major'].includes(args.bump)) {
    console.error(`错误: --bump 值必须是 patch|minor|major，收到 "${args.bump}"`)
    process.exit(1)
  }
  return args
}

// ─── 路径解析 ────────────────────────────────────────────────────────

function resolvePaths(marketplaceRoot, sourceRootOverride) {
  const registryPath = join(marketplaceRoot, 'plugins.registry.yaml')
  if (!existsSync(registryPath)) {
    console.error(`错误: 找不到注册表 ${registryPath}`)
    process.exit(1)
  }
  let sourceRoot
  if (sourceRootOverride) {
    sourceRoot = resolve(sourceRootOverride)
  } else {
    // 优先检测上级目录（marketplace 通常是 meta-repo 的子目录）
    const parentDir = resolve(marketplaceRoot, '..')
    if (existsSync(join(parentDir, '.agents', 'skills'))) {
      sourceRoot = parentDir
    } else if (existsSync(join(marketplaceRoot, '.agents', 'skills'))) {
      sourceRoot = resolve(marketplaceRoot)
    } else {
      console.error('错误: 无法自动检测 .agents/skills/ 所在目录，请用 --source-root 指定')
      process.exit(1)
    }
  }
  return { marketplaceRoot, sourceRoot, registryPath }
}

// ─── SKILL.md frontmatter 解析 ──────────────────────────────────────

function parseSkillFrontmatter(skillDir) {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) {
    console.error(`错误: 找不到 ${skillMdPath}`)
    process.exit(1)
  }
  const content = readFileSync(skillMdPath, 'utf-8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    console.error(`错误: ${skillMdPath} 缺少 YAML frontmatter`)
    process.exit(1)
  }
  const fm = parseYaml(match[1])
  return { name: fm?.name || '', description: fm?.description || '', sourcePath: skillDir }
}

// ─── 版本号处理 ──────────────────────────────────────────────────────

function bumpVersion(version, level) {
  const parts = version.split('.').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error(`错误: 无效版本号 "${version}"`)
    process.exit(1)
  }
  if (level === 'patch') { parts[2]++ }
  else if (level === 'minor') { parts[1]++; parts[2] = 0 }
  else if (level === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0 }
  return parts.join('.')
}

// ─── 文件复制（排除敏感/无用文件）─────────────────────────────────────

const COPY_EXCLUDE = new Set(['.env', '.env.local', '.env.development', '.env.production'])
const COPY_EXCLUDE_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', 'dist', 'build'])

function copySkillDir(src, dest, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] 复制 ${src} → ${dest}`)
    return
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  _copyRecursive(src, dest)
}

function _copyRecursive(src, dest) {
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      if (COPY_EXCLUDE_DIRS.has(entry.name)) continue
      mkdirSync(destPath, { recursive: true })
      _copyRecursive(srcPath, destPath)
    } else {
      if (COPY_EXCLUDE.has(entry.name)) continue
      if (entry.name === 'package-lock.json') continue
      writeFileSync(destPath, readFileSync(srcPath))
    }
  }
}

// ─── JSON 写入（2 空格缩进 + 尾换行）───────────────────────────────────

function writeJson(path, data, dryRun) {
  const json = JSON.stringify(data, null, 2) + '\n'
  if (dryRun) {
    console.log(`  [dry-run] 写入 ${path}`)
    return
  }
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, json, 'utf-8')
}

// ─── 今天日期 ────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ─── 主流程 ──────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv)
  // marketplace 根目录 = 本脚本所在目录的上一级
  const marketplaceRoot = resolve(import.meta.dirname, '..')
  const { sourceRoot, registryPath } = resolvePaths(marketplaceRoot, args.sourceRoot)

  // 1. 读注册表
  const registry = parseYaml(readFileSync(registryPath, 'utf-8'))
  const { marketplace, defaults, plugins } = registry

  // 2. 选择 plugin
  const pluginNames = args.plugins.length > 0 ? args.plugins : Object.keys(plugins)
  for (const name of pluginNames) {
    if (!plugins[name]) {
      console.error(`错误: plugin "${name}" 不在注册表中`)
      process.exit(1)
    }
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test) {
    // validate later per-plugin
  }

  let registryDirty = false

  for (const pluginName of pluginNames) {
    const entry = plugins[pluginName]
    console.log(`\n▸ 处理 plugin: ${pluginName}`)

    // 验证名称格式
    if (!/^[a-z0-9][a-z0-9-]*$/.test(pluginName)) {
      console.error(`错误: plugin 名称 "${pluginName}" 不匹配 ^[a-z0-9][a-z0-9-]*$`)
      process.exit(1)
    }

    // 2a. 解析源 skill
    const skillNames = entry.skills || [pluginName]
    const skillsMeta = []
    for (const skillName of skillNames) {
      const skillDir = join(sourceRoot, '.agents', 'skills', skillName)
      const meta = parseSkillFrontmatter(skillDir)
      skillsMeta.push(meta)
    }

    // 2b. 合并元数据
    const description = entry.description || skillsMeta[0].description
    const tags = entry.tags || ['skill']
    const keywords = entry.keywords || tags
    const version = args.bump ? bumpVersion(entry.version, args.bump) : entry.version
    const author = { ...defaults.author, ...(entry.author || {}) }
    const homepage = entry.homepage || defaults.homepage
    const repository = entry.repository || defaults.repository

    // 如果 bump 了版本，更新 registry 内存对象
    if (args.bump && entry.version !== version) {
      plugins[pluginName].version = version
      registryDirty = true
      console.log(`  版本 ${entry.version} → ${version}`)
    }

    // 2d. 复制 skill 文件
    const pluginRoot = join(marketplaceRoot, 'plugins', pluginName)
    for (let i = 0; i < skillNames.length; i++) {
      const skillName = skillNames[i]
      const srcDir = skillsMeta[i].sourcePath
      const destDir = join(pluginRoot, 'skills', skillName)
      copySkillDir(srcDir, destDir, args.dryRun)
    }

    // 2e. 生成 plugin.json
    const pluginJson = {
      '$schema': 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      name: pluginName,
      description,
      version,
      author,
      homepage,
      repository,
      license: entry.license || defaults.license,
      keywords,
    }
    writeJson(join(pluginRoot, '.claude-plugin', 'plugin.json'), pluginJson, args.dryRun)

    // 2f. 更新 marketplace.json
    const marketplaceJsonPath = join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
    let marketplaceJson
    if (existsSync(marketplaceJsonPath)) {
      marketplaceJson = JSON.parse(readFileSync(marketplaceJsonPath, 'utf-8'))
    } else {
      marketplaceJson = {
        '$schema': 'https://json.schemastore.org/claude-code-plugin-marketplace.json',
        name: marketplace.name,
        description: marketplace.description,
        version: marketplace.version,
        owner: marketplace.owner,
        plugins: [],
      }
    }
    // 替换或添加 entry
    const newEntry = {
      name: pluginName,
      source: `./plugins/${pluginName}`,
      description,
      version,
      author: { name: author.name },
      homepage,
      repository,
      license: entry.license || defaults.license,
      category: entry.category || 'Development',
      tags,
    }
    const idx = marketplaceJson.plugins.findIndex(p => p.name === pluginName)
    if (idx >= 0) {
      marketplaceJson.plugins[idx] = newEntry
    } else {
      marketplaceJson.plugins.push(newEntry)
    }
    marketplaceJson.plugins.sort((a, b) => a.name.localeCompare(b.name))
    writeJson(marketplaceJsonPath, marketplaceJson, args.dryRun)

    // 2g. 生成 hub 元数据
    if (!args.noHub && entry.hub) {
      const hubPath = join(marketplaceRoot, '.jthewl-hub', 'plugins', `${pluginName}.json`)
      const hub = entry.hub

      // 构建完整的 hub 元数据（继承 defaults）
      const provenance = { ...defaults.provenance, ...(hub.provenance || {}) }
      const hubJson = {
        '$schema': '../plugin.schema.json',
        name: pluginName,
        hubDesc: hub.hubDesc,
        shortLabel: hub.shortLabel,
        status: hub.status,
        updatedAt: today(),
        maintainer: hub.maintainer || defaults.author,
        originalAuthor: hub.originalAuthor || defaults.author,
        provenance,
        links: hub.links || defaults.links || [],
        useCases: hub.useCases || [],
        warnings: hub.warnings || [],
        screenshots: hub.screenshots || [],
      }
      writeJson(hubPath, hubJson, args.dryRun)
    }
  }

  // 3. 回写 registry（如果有版本变更）
  if (registryDirty && !args.dryRun) {
    // 保留文件开头的注释：读取原文件，找到最后一个注释行
    const original = readFileSync(registryPath, 'utf-8')
    const commentLines = original.split('\n').filter(l => l.startsWith('#'))
    const yamlBody = stringifyYaml(registry, { lineWidth: 0, singleQuote: false })
    // 只保留头部注释块（到第一个非注释、非空行为止）
    const headerComments = []
    for (const line of original.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') headerComments.push(line)
      else break
    }
    writeFileSync(registryPath, headerComments.join('\n') + '\n' + yamlBody, 'utf-8')
    console.log(`\n注册表已更新: ${registryPath}`)
  }

  // 4. 汇总
  console.log(`\n完成: ${pluginNames.length} 个 plugin 已处理`)
  if (args.dryRun) console.log('(dry-run 模式 — 未写入任何文件)')
}

main()
