// 0.38 冒烟：短延迟（<= pickShortMinutes）并进「稍后提醒」，只有长延迟才占按钮。
// 断言：宿主参数里 -SnoozeMinutes 拿到最短的短延迟、-Choices 只含长延迟、
//       用户点长延迟后历史记成 action=picked 且 pickMinutes 大于阈值。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

const tmp = os.tmpdir()
const argsFile = path.join(tmp, 'drn-pick-args.txt')
const stub = path.join(tmp, 'drn-pick-stub.ps1')
const historyFile = path.join(tmp, 'drn-pick-smoke-history.json')
try { fs.unlinkSync(argsFile) } catch {}
try { fs.unlinkSync(historyFile) } catch {}

// 假宿主：记下 -Choices / -ChoicesAreTimes / -SnoozeMinutes，然后假装用户点了长延迟
const longLabel = '明天 09:00'
fs.writeFileSync(stub, '\ufeff' + `param([string]$Title, [string]$Msg, [string]$Choices, [switch]$ChoicesAreTimes, [int]$SnoozeMinutes = 10, [string]$ResultPath)
"$Title|$Choices|$($ChoicesAreTimes.IsPresent)|$SnoozeMinutes" | Out-File -Encoding utf8 '${argsFile.replace(/\\/g, '\\\\')}'
[System.IO.File]::WriteAllText($ResultPath, '{"action":"pick","at":0,"elapsedMs":10,"snooze":0,"reply":"","button":"","choice":"","pick":"${longLabel}","focusAssist":false}')
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
apply(ctx, { scriptPath: stub, seconds: 4, sound: false, historyFile, cooldownMs: 0, pickShortMinutes: 60 })
const out = await definition.execute({
  kind: 'decide',
  title: '时间冒烟',
  message: '几点再提醒？',
  pickTimes: ['30 分钟', longLabel],
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

check('短短延迟并进稍后按钮（-SnoozeMinutes=30）、按钮只留长延迟', got, `时间冒烟|${longLabel}|True|30`)
check('返回里 ok:true', String(out).includes('"ok":true'), true)
check('历史动作是 picked', last.action, 'picked')
check('历史记了长延迟文字', last.pick, longLabel)
check('长延迟分钟数大于阈值', last.pickMinutes > 60, true)

// 只有短延迟时，不应出现时间按钮行
try { fs.unlinkSync(argsFile) } catch {}
await definition.execute({
  kind: 'decide',
  title: '只有短延迟',
  message: '10 分钟后再看',
  pickTimes: ['10 分钟'],
})
await new Promise((r) => setTimeout(r, 900))
const got2 = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim() : '(no args)'
check('只有短延迟时没有时间按钮行', got2, '只有短延迟||False|10')

console.log(failed === 0 ? 'pick smoke ok' : `pick smoke FAILED (${failed})`)
process.exit(failed === 0 ? 0 : 1)
