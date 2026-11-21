
// 0.20 冒烟：确认 notify_user 的 buttons 真的传到了宿主参数里（用假宿主脚本抓 argv）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const tmp = os.tmpdir()
const argsFile = path.join(tmp, 'drn-args.txt')
const stub = path.join(tmp, 'drn-stub.ps1')
const historyFile = path.join(tmp, 'drn-smoke-history.json')
try { fs.unlinkSync(argsFile) } catch {}

// 假宿主：把收到的参数写成一行，再写一条 result JSON
fs.writeFileSync(stub, `param([string]$Title, [string]$Msg, [string]$ResultPath, [string]$CustomButtons, [switch]$Reply)
"$Title|$Msg|$CustomButtons|$($Reply.IsPresent)" | Out-File -Encoding utf8 '${argsFile.replace(/\\/g, '\\\\')}'
'{"action":"ok","at":0,"elapsedMs":10,"snooze":0,"reply":"","button":"","focusAssist":false}' | Out-File -Encoding utf8 $ResultPath
`, 'utf8')

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
  kind: 'raw',
  title: '按钮冒烟',
  message: '正文',
  buttons: [{ label: '打开仓库', url: 'https://github.com/Jiangshuaiye1203/dsh-reminder-notify' }, { label: '记一下' }],
})
await new Promise((r) => setTimeout(r, 900))
const got = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim() : '(no args)'
console.log('notify ->', JSON.stringify(out).slice(0, 90))
console.log('host args ->', got)
const ok = got.includes('打开仓库|https://github.com/Jiangshuaiye1203/dsh-reminder-notify;记一下|') && got.endsWith('|True')
console.log(ok ? 'buttons+reply ok' : 'FAIL: buttons/reply 没传到宿主')
if (!ok) process.exit(1)
