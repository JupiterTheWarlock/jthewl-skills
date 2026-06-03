#!/usr/bin/env node
/**
 * validate-plugins.mjs — 校验 registry 与生成产物的一致性
 *
 * 用法：
 *   node scripts/validate-plugins.mjs [--strict]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/
const VALID_STATUSES = new Set(['stable', 'beta', 'experimental', 'deprecated'])
const HUB_REQUIRED_FIELDS = ['hubDesc', 'shortLabel', 'status', 'maintainer', 'originalAuthor', 'provenance', 'links', 'useCases', 'warnings']

function main() {
  const strict = process.argv.includes('--strict')
  const marketplaceRoot = resolve(import.meta.dirname, '..')
  const registryPath = join(marketplaceRoot, 'plugins.registry.yaml')

  const issues = []
  let passCount = 0

  function pass(msg) { passCount++; console.log(`  ✓ ${msg}`) }
  function fail(msg) { issues.push(msg); console.log(`  ✗ ${msg}`) }
  function warn(msg) {
    if (strict) { issues.push(msg); console.log(`  ✗ ${msg}`) }
    else console.log(`  ⚠ ${msg}`)
  }

  // ─── 1. Registry 基础校验 ───────────────────────────────────────────

  console.log('\n▸ 注册表校验')

  if (!existsSync(registryPath)) { fail('plugins.registry.yaml 不存在'); summarize(); return }
  let registry
  try {
    registry = parseYaml(readFileSync(registryPath, 'utf-8'))
  } catch (e) { fail(`YAML 解析失败: ${e.message}`); summarize(); return }

  if (!registry.marketplace) fail('缺少 marketplace 段')
  else {
    if (!registry.marketplace.name) fail('marketplace.name 缺失')
    if (!registry.marketplace.version) fail('marketplace.version 缺失')
    else pass('marketplace 段完整')
  }

  if (!registry.plugins || typeof registry.plugins !== 'object') { fail('缺少 plugins 段'); summarize(); return }
  const pluginNames = Object.keys(registry.plugins)
  pass(`注册 ${pluginNames.length} 个 plugin`)

  // 检测源目录
  const sourceRoot = resolve(marketplaceRoot, '..')
  const skillsDir = join(sourceRoot, '.agents', 'skills')
  if (!existsSync(skillsDir)) {
    fail(`源 skill 目录不存在: ${skillsDir}`)
    summarize()
    return
  }
  pass(`源目录: ${skillsDir}`)

  // ─── 2. 每个 plugin 的校验 ──────────────────────────────────────────

  const allSkillNames = new Set()

  for (const pluginName of pluginNames) {
    console.log(`\n▸ plugin: ${pluginName}`)
    const entry = registry.plugins[pluginName]

    // 名称格式
    if (!PLUGIN_NAME_RE.test(pluginName)) { fail(`名称 "${pluginName}" 不匹配 ${PLUGIN_NAME_RE}`); continue }
    pass('名称格式合法')

    // 必填字段
    if (!entry.version) fail('缺少 version')
    if (!entry.description) fail('缺少 description')
    if (!entry.skills || entry.skills.length === 0) fail('缺少 skills 列表')
    else pass(`${entry.skills.length} 个 skill`)

    // 源 skill 存在性
    for (const skillName of entry.skills) {
      if (allSkillNames.has(skillName)) fail(`skill "${skillName}" 被多个 plugin 引用`)
      allSkillNames.add(skillName)

      const skillDir = join(skillsDir, skillName)
      const skillMd = join(skillDir, 'SKILL.md')
      if (!existsSync(skillMd)) { fail(`源 SKILL.md 不存在: ${skillMd}`); continue }
      // 解析 frontmatter
      const content = readFileSync(skillMd, 'utf-8')
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
      if (!match) { fail(`${skillName}/SKILL.md 缺少 frontmatter`); continue }
      const fm = parseYaml(match[1])
      if (fm?.name !== skillName) warn(`frontmatter name "${fm?.name}" !== 目录名 "${skillName}"`)
      pass(`源 skill: ${skillName}`)
    }

    // hub 元数据
    if (entry.hub) {
      if (!entry.hub.hubDesc) fail('hub 缺少 hubDesc')
      if (!entry.hub.shortLabel) fail('hub 缺少 shortLabel')
      if (!entry.hub.status) fail('hub 缺少 status')
      else if (!VALID_STATUSES.has(entry.hub.status)) fail(`hub.status "${entry.hub.status}" 不合法`)
      else pass('hub 元数据完整')
    } else {
      warn('无 hub 元数据')
    }
  }

  // ─── 3. 产物一致性 ──────────────────────────────────────────────────

  console.log('\n▸ 产物一致性')

  // marketplace.json
  const marketplaceJsonPath = join(marketplaceRoot, '.claude-plugin', 'marketplace.json')
  if (!existsSync(marketplaceJsonPath)) { fail('.claude-plugin/marketplace.json 不存在') }
  else {
    const mp = JSON.parse(readFileSync(marketplaceJsonPath, 'utf-8'))
    const mpNames = new Set(mp.plugins.map(p => p.name))
    const regNames = new Set(pluginNames)

    for (const n of regNames) {
      if (!mpNames.has(n)) fail(`marketplace.json 缺少 plugin "${n}"`)
    }
    for (const n of mpNames) {
      if (!regNames.has(n)) fail(`marketplace.json 多出 plugin "${n}"`)
    }

    // 逐 plugin 字段对比
    for (const mpPlugin of mp.plugins) {
      const regPlugin = registry.plugins[mpPlugin.name]
      if (!regPlugin) continue
      if (mpPlugin.description !== (regPlugin.description || '')) warn(`${mpPlugin.name}: marketplace description 与 registry 不一致`)
      if (mpPlugin.version !== regPlugin.version) warn(`${mpPlugin.name}: marketplace version "${mpPlugin.version}" !== registry "${regPlugin.version}"`)
      if (mpPlugin.category !== (regPlugin.category || 'Development')) warn(`${mpPlugin.name}: category 不一致`)
    }
    pass('marketplace.json 校验完成')
  }

  // plugin.json
  for (const pluginName of pluginNames) {
    const pluginJsonPath = join(marketplaceRoot, 'plugins', pluginName, '.claude-plugin', 'plugin.json')
    if (!existsSync(pluginJsonPath)) { fail(`${pluginName}: plugin.json 不存在`); continue }
    const pj = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'))
    if (pj.name !== pluginName) fail(`${pluginName}: plugin.json name "${pj.name}" 不匹配`)
    const regPlugin = registry.plugins[pluginName]
    if (pj.version !== regPlugin.version) warn(`${pluginName}: plugin.json version "${pj.version}" !== registry "${regPlugin.version}"`)
    pass(`${pluginName}: plugin.json 存在且一致`)
  }

  // hub metadata
  for (const pluginName of pluginNames) {
    const hubPath = join(marketplaceRoot, '.jthewl-hub', 'plugins', `${pluginName}.json`)
    if (!existsSync(hubPath)) { warn(`${pluginName}: hub metadata 不存在`); continue }
    const hub = JSON.parse(readFileSync(hubPath, 'utf-8'))
    if (hub.name !== pluginName) fail(`${pluginName}: hub name "${hub.name}" 不匹配`)
    for (const field of HUB_REQUIRED_FIELDS) {
      if (!(field in hub)) fail(`${pluginName}: hub 缺少 ${field}`)
    }
    if (hub.status && !VALID_STATUSES.has(hub.status)) fail(`${pluginName}: hub.status "${hub.status}" 不合法`)
    pass(`${pluginName}: hub metadata 合法`)
  }

  // orphan plugin 目录检测
  const pluginsDir = join(marketplaceRoot, 'plugins')
  if (existsSync(pluginsDir)) {
    const onDisk = readdirSync(pluginsDir).filter(f => statSync(join(pluginsDir, f)).isDirectory())
    const regSet = new Set(pluginNames)
    for (const d of onDisk) {
      if (!regSet.has(d)) warn(`orphan plugin 目录: plugins/${d}`)
    }
  }

  // ─── 4. 总结 ────────────────────────────────────────────────────────

  summarize()

  function summarize() {
    console.log('\n' + '─'.repeat(40))
    if (issues.length === 0) {
      console.log(`全部通过 (${passCount} 项检查)`)
    } else {
      console.log(`${issues.length} 个问题:`)
      for (const issue of issues) console.log(`  - ${issue}`)
    }
    process.exit(issues.length > 0 ? 1 : 0)
  }
}

main()
