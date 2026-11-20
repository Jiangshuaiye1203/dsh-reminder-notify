// 纯逻辑自检：不弹窗口、不碰文件，只验证免打扰时段计算和历史统计。
// 跑法：node tests/selftest-logic.mjs
import { historyStats, inQuietHours, parseClock, quietEndAt } from '../index.js'

let failed = 0
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  if (!pass) {
    failed += 1
    console.log(`FAIL ${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
  } else {
    console.log(`ok   ${label}`)
  }
}

// —— 时间解析 ——
check('parseClock 22:00', parseClock('22:00'), 22 * 60)
check('parseClock 8:05', parseClock('8:05'), 8 * 60 + 5)
check('parseClock 24:00 -> null', parseClock('24:00'), null)
check('parseClock 乱写 -> null', parseClock('晚上十点'), null)

// —— 免打扰时段（默认 22:00 → 08:00，跨零点） ——
const quiet = { quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' }
const at = (h, m) => new Date(2026, 10, 20, h, m, 0, 0)
check('23:30 在免打扰内', inQuietHours(quiet, at(23, 30)), true)
check('07:00 在免打扰内', inQuietHours(quiet, at(7, 0)), true)
check('12:00 不在免打扰内', inQuietHours(quiet, at(12, 0)), false)
check('22:00 边界算进入', inQuietHours(quiet, at(22, 0)), true)
check('08:00 边界算结束', inQuietHours(quiet, at(8, 0)), false)
check('关掉开关就永远不在', inQuietHours({ ...quiet, quietEnabled: false }, at(23, 30)), false)

// 非跨零点时段 09:00 → 18:00
const day = { quietEnabled: true, quietStart: '09:00', quietEnd: '18:00' }
check('10:00 在白天时段内', inQuietHours(day, at(10, 0)), true)
check('20:00 不在白天时段内', inQuietHours(day, at(20, 0)), false)

// 08:00 收尾时间：23:30 时应该指向「明天 08:00」
const endAt = quietEndAt(quiet, at(23, 30))
const endDate = new Date(endAt)
check('quietEndAt 跨到次日 08:00', [endDate.getDate(), endDate.getHours(), endDate.getMinutes()], [21, 8, 0])

// —— 历史统计 ——
const now = Date.now()
const entries = [
  { at: now, kind: 'done', action: 'ok' },
  { at: now, kind: 'decide', action: 'snooze' },
  { at: now, kind: 'done', action: 'timeout' },
  { at: now - 86400000 * 2, kind: 'raw', action: 'ok' },
]
const stats = historyStats(entries)
check('stats.total', stats.total, 4)
check('stats.byKind', stats.byKind, { done: 2, decide: 1, raw: 1 })
check('stats.byAction.ok', stats.byAction.ok, 2)
check('stats.today', stats.today, 3)
check('stats.last7 长度', stats.last7.length, 7)
check('stats.last7 末位是今天', stats.last7[stats.last7.length - 1].count, 3)

if (failed > 0) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
