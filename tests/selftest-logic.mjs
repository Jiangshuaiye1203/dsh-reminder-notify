// 纯逻辑自检：不弹窗口、不碰文件，只验证免打扰时段计算和历史统计。
// 跑法：node tests/selftest-logic.mjs
import { digestDue, digestMessage, historyStats, inQuietHours, parseClock, pushPayload, quietEndAt, todayKey } from '../index.js'

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
// 用「今天」构造时刻：写死日期会让这套断言在跨过零点后失败。
const at = (h, m) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
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
const ref2330 = at(23, 30)
const endAt = quietEndAt(quiet, ref2330)
const endDate = new Date(endAt)
const tomorrow = new Date(ref2330.getTime() + 86400000).getDate()
check('quietEndAt 跨到次日 08:00', [endDate.getDate(), endDate.getHours(), endDate.getMinutes()], [tomorrow, 8, 0])

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

// —— 日报（0.12） ——
const base = { digestEnabled: true, digestTime: '09:00', digestLastDate: '' }
check('08:59 还没到点', digestDue(base, at(8, 59)), false)
check('09:00 到点发', digestDue(base, at(9, 0)), true)
check('14:00 过点了也发（补发当天那条）', digestDue(base, at(14, 0)), true)
check('今天已经发过就不发', digestDue({ ...base, digestLastDate: todayKey(at(9, 0)) }, at(14, 0)), false)
check('关掉开关就不发', digestDue({ ...base, digestEnabled: false }, at(14, 0)), false)
check('时间写错就不发', digestDue({ ...base, digestTime: '25:00' }, at(14, 0)), false)

const digestEntries = [
  { at: at(10, 0).getTime(), kind: 'done', action: 'ok' },
  { at: at(11, 0).getTime(), kind: 'decide', action: 'snooze' },
  { at: at(12, 0).getTime(), kind: 'raw', action: 'timeout' },
  { at: at(12, 30).getTime(), kind: 'raw', action: 'quiet-skip' },
  { at: at(12, 40).getTime() - 86400000, kind: 'done', action: 'ok' },
]
const text = digestMessage({ balanceBaseline: 100 }, digestEntries, { balance: 42.5 })
check('日报首行条数', text.split('\n')[0].includes('今天共 4 条提醒'), true)
check('日报第二行处理方式', text.split('\n')[1].includes('点知道了 1'), true)
check('日报带余额与基线', text.split('\n')[2], 'DeepSeek 余额 ¥42.50（基线 ¥100.00）')
check('空历史也有一行', digestMessage({}, [], null), '今天还没有弹过提醒。')
check('没余额就不加那行', digestMessage({}, digestEntries, null).split('\n').length, 2)

// —— 推送报文（0.12） ——
const wecom = JSON.parse(pushPayload({ pushFormat: 'wecom' }, 'T', 'M').body)
check('wecom 报文', [wecom.msgtype, wecom.text.content], ['text', 'T\nM'])
const sc = JSON.parse(pushPayload({ pushFormat: 'serverchan' }, 'T', 'M').body)
check('serverchan 报文', [sc.title, sc.desp], ['T', 'M'])
check('text 报文', pushPayload({ pushFormat: 'text' }, 'T', 'M').body, 'T\nM')
check('text 的 content-type', pushPayload({ pushFormat: 'text' }, 'T', 'M').headers['content-type'], 'text/plain; charset=utf-8')
const generic = JSON.parse(pushPayload({ pushFormat: 'json' }, 'T', 'M', { kind: 'decide' }).body)
check('json 报文', [generic.title, generic.message, generic.kind], ['T', 'M', 'decide'])

if (failed > 0) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
