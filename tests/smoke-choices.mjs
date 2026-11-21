// 0.28 冒烟：确认 decide 卡的 options 变成了宿主的 -Choices，并且 choice 结果回到了历史里。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const tmp = os.tmpdir()
const argsFile = path.join(tmp, 'drn-choice-args.txt')
const stub = path.join(tmp, 'drn-choice-stub.ps1')
const historyFile = path.join(tmp, 'drn-choice-smoke-history.json')
try { fs.unlinkSync(argsFile) } catch {}
try { fs.unlinkSync(historyFile) } catch {}

// 假宿主：记下 -Choices，然后假装用户点了第一个
fs.writeFileSync(stub, '\ufeff' + `param([string]$Title, [string]$Msg, [string]$Choices, [string]$ResultPath)
"$Title|$Choices" | Out-File -Encoding utf8 '${argsFile.replace(/\\/g, '\\\\')}'
[System.IO.File]::WriteAllText($ResultPath, '{"action":"choice","at":0,"elapsedMs":10,"snooze":0,"reply":"","button":"","choice":"A","focusAssist":false}')
`, 'utf8')  // 注意：stub 必须带 BOM，否则 PowerShell 5.1 按 ANSI 解析中文会坏

let definition
const ctx = {
  provide() { return () => {} },
  get(name) {
    if (name === 'tools') return { register(d) { definition = d; return () => {} } }
    return undefined
  },
  effect: (fn) => fn(),
  logger: console,
}
apply(ctx, { scriptPath: stub, seconds: 4, sound: false, historyFile, cooldownMs: 0 })
const out = await definition.execute({
  kind: 'decide',
  title: '决定冒烟',
  message: '选一个',
  options: ['A', 'B', '都不做'],
})
await new Promise((r) => setTimeout(r, 900))
const got = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim() : '(no args)'
const hist = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []
const last = hist[hist.length - 1] ?? {}
console.log('notify ->', JSON.stringify(out).slice(0, 90))
console.log('host args ->', got)
console.log('history ->', JSON.stringify({ action: last.action, choice: last.choice }))
const ok = got.endsWith('A|B|都不做') && last.action === 'choice' && last.choice === 'A'
console.log(ok ? 'choices ok' : 'FAIL: choices 没传到宿主或没回到历史')
if (!ok) process.exit(1)
