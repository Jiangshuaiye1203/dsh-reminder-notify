#!/usr/bin/env node
// 生成 / 更新插件市场索引（DSH 插件市场索引格式 1）。
//
// 用法：
//   node scripts/build-index.mjs                                  # 从 git remote.origin.url + HEAD 自动取
//   node scripts/build-index.mjs --repo https://github.com/me/x   # 指定仓库地址
//   node scripts/build-index.mjs --commit <40位sha>               # 指定提交
//   node scripts/build-index.mjs --out publish/index.json
//
// 输出是一份自包含的 JSON：icon 内联成 data: URL（≤32 KiB），
// 版本来源用 git + 固定提交（插件市场据此生成 git+https 安装串）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? undefined : argv[at + 1]
}
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const rawRepo = flag('repo') ?? (() => {
  try {
    return git('config', '--get', 'remote.origin.url')
  } catch {
    return undefined
  }
})()
if (!rawRepo) {
  console.error('缺少仓库地址：先 `git remote add origin https://github.com/<你>/<仓库>`，或传 --repo <url>')
  process.exit(1)
}

// 规范化成 https://host/owner/repo（去掉 .git、凭据、查询串与末尾斜杠）
const repoUrl = (() => {
  let text = String(rawRepo).trim()
  const scp = /^git@([^:]+):(.+)$/u.exec(text)
  if (scp) text = `https://${scp[1]}/${scp[2]}`
  text = text.replace(/^ssh:\/\/git@/u, 'https://').replace(/\.git$/u, '').replace(/\/+$/u, '')
  const url = new URL(text)
  if (url.protocol !== 'https:') throw new Error(`仓库地址必须是 https：${text}`)
  if (url.search || url.hash || url.username || url.password) throw new Error(`仓库地址不能带凭据/查询串：${text}`)
  return `${url.origin}${url.pathname}`
})()

const commit = (flag('commit') ?? git('rev-parse', 'HEAD')).toLowerCase()
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`提交必须是 40 位小写 sha：${commit}`)

const publishTimestamp = Number(flag('time') ?? git('log', '-1', '--format=%ct', commit))
const iconPath = path.join(ROOT, 'icon.svg')
const icon = fs.existsSync(iconPath)
  ? `data:image/svg+xml;base64,${fs.readFileSync(iconPath).toString('base64')}`
  : undefined
if (icon && Buffer.from(icon.split(',')[1], 'base64').length > 32 * 1024) {
  throw new Error('内联图标超过 32 KiB，去掉 icon 字段或缩小图标')
}

const index = {
  format: 1,
  title: { zh: '本地自建插件源', en: 'Private plugin source' },
  description: {
    zh: '个人维护的 DSH 插件，安装前请自行查看来源。',
    en: 'Self-hosted DSH plugins. Check the source before installing.',
  },
  metadata: {
    categories: {
      productivity: { title: { zh: '效率工具', en: 'Productivity' } },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { zh: '桌面提醒', en: 'Desktop reminder' },
      description: {
        zh: '把「Harness完成提醒客户端」的完成 / 决定提醒变成 notify_user 工具：浮动弹窗 + 提示音，不抢焦点。仅 Windows。',
        en: 'Turns the Harness reminder client into a notify_user tool: floating popup with sound, never steals focus. Windows only.',
      },
      ...icon === undefined ? {} : { icon },
      author: flag('author') ?? pkg.name,
      repository: { url: repoUrl },
      metadata: {
        category: 'productivity',
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
        labels: [],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repoUrl, commit },
          engines: pkg.engines?.dsh === undefined ? {} : { dsh: pkg.engines.dsh },
        },
      ],
    },
  ],
}

const outPath = path.resolve(ROOT, flag('out') ?? 'publish/index.json')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`已写入 ${outPath}`)
console.log(`  插件   ${pkg.name}@${pkg.version}`)
console.log(`  仓库   ${repoUrl}`)
console.log(`  提交   ${commit}`)
console.log(`  时间   ${new Date(publishTimestamp * 1000).toISOString()}`)
