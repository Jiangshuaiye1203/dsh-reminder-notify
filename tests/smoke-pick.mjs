// 0.37 冒烟：确认 pickTimes 变成了宿主的 -Choices + -ChoicesAreTimes，
// 并且用户点时间后历史里记成 action=picked、pick / pickMinutes 都在。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const slow = process.env.DRN_SLOW === '1'
const pickLabel = slow ? '1 分钟' : '30 分钟'
const remember = slow ? 1 : 30
const tmp = os.tmpdir()
const argsFile = path.join(tmp, 'drn-pick-args.txt')
const stub = path.join(tmp, 'drn-pick-stub.ps1')
const historyFile = path.join(tmp, 'drn-pick-smoke-history.json')
try { fs.unlinkSync(argsFile) } catch {}
try { fs.unlinkSync(historyFile) } catch {}

// 假宿主：记下 -Choices / -ChoicesAreTimes，然后假装用户点了第一个时间
fs.writeFileSync(stub, '\ufeff' + `param([string]$Title, [string]$Msg, [string]$Choices, [switch]$ChoicesAreTimes, [string]$ResultPath)
"$Title|$Choices|$($ChoicesAreTimes.IsPresent)" | Out-File -Encoding utf8 '${argsFile.replace(/\\/g, '\\\\')}'
[System.IO.File]::WriteAllText($ResultPath, '{"action":"pick","at":0,"elapsedMs":10,"snooze":0,"reply":"","button":"","choice":"","pick":"${pickLabel}","focusAssist":false}')
`, 'utf8') // stub 必须带 BOM，否则 PowerShell 5.1 按 ANSI 解析中文会坏

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
  title: '时间冒烟',
  message: '几点再提醒？',
  pickTimes: [pickLabel, '1 小时'],
})
await new Promise((r) => setTimeout(r, 900))

const got = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim() : '(no args)'
const hist = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []
const last = hist[hist.length - 1] ?? {}

let failed = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` -> got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`)
}

check('宿主拿到时间按钮', got, `时间冒烟|${pickLabel}|1 小时|True`)
check('返回里 ok:true', String(out).includes('"ok":true'), true)
check('历史动作是 picked', last.action, 'picked')
check('历史记了 pick 文字', last.pick, pickLabel)
check('历史记了 pick 分钟数', last.pickMinutes, remember)

if (slow) {
  // 慢测：时间按钮真能再弹一张（1 分钟后再出现一条同标题记录）
  console.log('slow: 等 70 秒看是否自动重弹 ...')
  await new Promise((r) => setTimeout(r, 70000))
  const again = fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : []
  check('时间按钮真的定时重弹', again.length >= 2, true)
}

console.log(failed === 0 ? 'pick smoke ok' : `pick smoke FAILED (${failed})`)
process.exit(failed === 0 ? 0 : 1)
