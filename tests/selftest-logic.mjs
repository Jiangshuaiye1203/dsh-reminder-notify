// 纯逻辑自检：不弹窗口、不碰文件，只验证免打扰时段计算和历史统计。
// 跑法：node tests/selftest-logic.mjs
import { condStateAfter, customButtonsSpec, digestDue, digestMessage, doctorReport, evaluateConditions, historyStats, inQuietHours, nextRunAfter, parseClock, parseCustomButtons, parseEvery, pushPayload, quietEndAt, todayKey, toastArgsOf } from '../index.js'

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

// 0.17：30 天桶与三种新推送格式
check('historyStats 给近 30 天桶', historyStats([]).last30.length, 30)
check(
  'pushPayload telegram 带 chat_id',
  JSON.parse(pushPayload({ pushFormat: 'telegram', pushChat: '42' }, 'T', 'M').body).chat_id,
  '42',
)
check('pushPayload 飞书用 msg_type', JSON.parse(pushPayload({ pushFormat: 'feishu' }, 'T', 'M').body).msg_type, 'text')
check('pushPayload 钉钉用 markdown', JSON.parse(pushPayload({ pushFormat: 'dingtalk' }, 'T', 'M').body).markdown.title, 'T')
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

// —— 0.16 自诊断（doctor）——
{
  const report = doctorReport({ get: () => undefined }, () => ({}))
  check('doctor 有足够检查项', report.checks.length >= 8, true)
  check('doctor 结构完整', ['ok', 'version', 'checks', 'host', 'paths'].every((key) => key in report), true)
  check('doctor 平台检查在 Windows 上为真', report.checks.find((item) => item.id === 'platform').ok, process.platform === 'win32')
  check('doctor 每项都有 id/ok/detail', report.checks.every((item) => typeof item.id === 'string' && typeof item.ok === 'boolean' && typeof item.detail === 'string'), true)
  check('doctor 有 GitHub 连通性检查项', report.checks.some((item) => item.id === 'github'), true)
  check('doctor 没服务时也能给出结论', typeof report.ok, 'boolean')
}

// —— 推送报文（0.12） ——
const wecom = JSON.parse(pushPayload({ pushFormat: 'wecom' }, 'T', 'M').body)
check('wecom 报文', [wecom.msgtype, wecom.text.content], ['text', 'T\nM'])
const sc = JSON.parse(pushPayload({ pushFormat: 'serverchan' }, 'T', 'M').body)
check('serverchan 报文', [sc.title, sc.desp], ['T', 'M'])
check('text 报文', pushPayload({ pushFormat: 'text' }, 'T', 'M').body, 'T\nM')
check('text 的 content-type', pushPayload({ pushFormat: 'text' }, 'T', 'M').headers['content-type'], 'text/plain; charset=utf-8')
const generic = JSON.parse(pushPayload({ pushFormat: 'json' }, 'T', 'M', { kind: 'decide' }).body)
check('json 报文', [generic.title, generic.message, generic.kind], ['T', 'M', 'decide'])

// —— 条件提醒（0.18） ——
{
  const now = new Date()
  now.setHours(10, 0, 0, 0)
  const base = { conditionsEnabled: true, condBalanceBelow: true, balanceEnabled: true, balanceBaseline: 100, balanceThresholds: '20,10,5', condQueueBacklog: 3, condHostFailures: 2, condCooldownMinutes: 120 }
  const fired = evaluateConditions(base, { balance: 4, queueLength: 4, hostFailures: 3 }, now)
  check('条件提醒命中三条', fired.map((item) => item.id), ['balance-below', 'queue-backlog', 'host-failures'])
  check('条件关掉就一条都不弹', evaluateConditions({ ...base, conditionsEnabled: false }, { balance: 1, queueLength: 9, hostFailures: 9 }, now), [])
  const state = condStateAfter(base, fired, now)
  check('冷却内的条件不再重复', evaluateConditions({ ...base, condState: state }, { balance: 4, queueLength: 4, hostFailures: 3 }, now), [])
  const later = new Date(now.getTime() + 121 * 60 * 1000)
  check('冷却过了会再提醒', evaluateConditions({ ...base, condState: state }, { balance: 4, queueLength: 0, hostFailures: 0 }, later).map((item) => item.id), ['balance-below'])
  check('余额高于阈值不提醒', evaluateConditions(base, { balance: 90 }, now), [])
  check('条数预警每天只一次', evaluateConditions({ ...base, condDailyCount: 20 }, { todayCount: 25 }, now).map((item) => item.id), ['daily-count'])
}
const toast = toastArgsOf({ toastSeconds: 99 }, 'decide', 'T', 'M')
check('系统通知秒数夹到 60', [toast.seconds, toast.icon], [60, 'Warning'])
check('系统通知默认 Information', toastArgsOf({}, 'raw', 'T', 'M').icon, 'Information')

// —— 周期提醒 ——
check('parseEvery 30m', parseEvery('30m'), 30)
check('parseEvery 2h', parseEvery('2h'), 120)
check('parseEvery 1d', parseEvery('1d'), 1440)
check('parseEvery 带空格', parseEvery(' 45 m '), 45)
check('parseEvery 0 分钟 -> null', parseEvery('0m'), null)
check('parseEvery 8 天超上限 -> null', parseEvery('8d'), null)
check('parseEvery 乱写 -> null', parseEvery('每半小时'), null)
const t0 = 1795200000000
// —— 0.20：自定义按钮解析 ——
check('parseCustomButtons 单个', parseCustomButtons('打开文档|https://a.example'), [{ label: '打开文档', url: 'https://a.example' }])
check('parseCustomButtons 两个', parseCustomButtons('记一下|;看日志|https://b.example').length, 2)
check(
  'parseCustomButtons 最多取三个',
  parseCustomButtons('一|1;二|2;三|3;四|4').map((item) => item.label),
  ['一', '二', '三'],
)
check('parseCustomButtons 空串', parseCustomButtons(''), [])
check('parseCustomButtons label 截断八字节', parseCustomButtons('一二三四五六七八九十|u')[0].label.length, 8)
check(
  'customButtonsSpec 往返',
  customButtonsSpec([{ label: '打开文档', url: 'https://a.example' }, { label: '记一下', url: '' }]),
  '打开文档|https://a.example;记一下|',
)
check('customButtonsSpec 忽略空标签', customButtonsSpec([{ label: ' ', url: 'x' }]), '')

check('nextRunAfter 正常加一个周期', nextRunAfter(t0, 30, t0 + 60 * 1000), t0 + 30 * 60 * 1000)
check('nextRunAfter 跳过错过很多个', nextRunAfter(t0, 30, t0 + 3 * 3600 * 1000), t0 + 210 * 60 * 1000)
check('nextRunAfter 到点前不跳', nextRunAfter(t0, 60, t0 + 60 * 1000), t0 + 60 * 60 * 1000)

if (failed > 0) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
