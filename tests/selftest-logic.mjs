// 纯逻辑自检：不弹窗口、不碰文件，只验证免打扰时段计算和历史统计。
// 跑法：node tests/selftest-logic.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mobileProxyPathOk, httpsLinkOf, mobileBarsOf, mobileCsvOf, mobileSettingsPatch, mobileViewOf, attachmentSummaryOf, mobileAttachmentsOf, uploadNameFor, condStateAfter, choicePromptText, choicesArgOf, normalizeChoices, resetChoiceSeen, unreadChoices, customButtonsOf, customButtonsSpec, escapeHtml, mobileLinkOf, mobilePageOf, phonePromptText, repliesOf, resetPhoneSeen, unreadPhoneReplies, digestDue, digestMessage, doctorReport, evaluateConditions, historyStats, inQuietHours, nextRunAfter, parseClock, parseCustomButtons, parseEvery, pushPayload, quietEndAt, todayKey, toastArgsOf } from '../index.js'

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


check('customButtonsOf 单条优先于全局', customButtonsOf({ customButtons: '全局|g' }, { buttons: [{ label: '本条', url: 'u' }] }), '本条|u')
check('customButtonsOf 没有单条就用全局', customButtonsOf({ customButtons: '全局|g;再来|' }, {}), '全局|g;再来|')
check('customButtonsOf 两边都空', customButtonsOf({ customButtons: '' }, {}), '')

// —— 0.20：卡片回复列表（写一份临时 history） ——
{
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const file = path.join(os.tmpdir(), `drn-replies-${process.pid}.json`)
  const entries = [
    { at: 1, kind: 'raw', title: 'A', message: 'm', action: 'timeout' },
    { at: 2, kind: 'raw', title: 'B', message: 'm', action: 'replied', reply: '收到，马上改' },
    { at: 3, kind: 'done', title: 'C', message: 'm', action: 'replied', reply: '好的' },
  ]
  fs.writeFileSync(file, JSON.stringify(entries), 'utf8')
  const list = repliesOf({ historyFile: file }, 20)
  check('repliesOf 只取 replied 且有正文', list.map((item) => item.reply), ['好的', '收到，马上改'])
  check('repliesOf limit 生效', repliesOf({ historyFile: file }, 1).length, 1)
  fs.unlinkSync(file)
}

check('nextRunAfter 正常加一个周期', nextRunAfter(t0, 30, t0 + 60 * 1000), t0 + 30 * 60 * 1000)
check('nextRunAfter 跳过错过很多个', nextRunAfter(t0, 30, t0 + 3 * 3600 * 1000), t0 + 210 * 60 * 1000)
check('nextRunAfter 到点前不跳', nextRunAfter(t0, 60, t0 + 60 * 1000), t0 + 60 * 60 * 1000)

// —— 手机端局域网页面（0.21）——
check('escapeHtml 转义五个字符', escapeHtml('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;')
const linkWithToken = mobileLinkOf({ mobileToken: 'abc123' }, '192.168.1.5:4517', { name: 'Wi-Fi', address: '192.168.1.5' })
check('mobileLinkOf 带口令', linkWithToken.url, 'http://192.168.1.5:4517/dsh-reminder-notify/mobile?t=abc123')
check('mobileLinkOf 端口取 Host', linkWithToken.port, '4517')
const linkNoToken = mobileLinkOf({ mobileToken: '' }, '10.0.0.2:4517', { name: 'eth', address: '10.0.0.2' })
check('mobileLinkOf 无口令不带查询串', linkNoToken.url, 'http://10.0.0.2:4517/dsh-reminder-notify/mobile')
const sampleEntries = [
  { at: Date.now(), kind: 'done', title: '<script>alert(1)</script>', message: '', action: 'ok' },
  { at: Date.now(), kind: 'raw', title: '电话回话', message: '', action: 'replied', reply: '好的<b>' },
]
const page = mobilePageOf({ mobileToken: 'abc' }, sampleEntries, new Date(2026, 10, 21, 16, 30))
check('mobilePageOf 有标题', page.includes('桌面提醒 · 手机版'), true)
check('mobilePageOf 有回话入口', page.includes('/dsh-reminder-notify/mobile/reply'), true)
check('mobilePageOf 转义正文', page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true)
check('mobilePageOf 不出原始 script 标签', page.includes('<script>alert(1)</script>'), false)
check('mobilePageOf 显示回复', page.includes('回复：好的&lt;b&gt;'), true)
check('页面按安全上下文分支处理安装', page.includes('isSecureContext'), true)
check('页面给 http 手动添加提示', page.includes('添加到主屏幕'), true)
check('mobilePageOf 统计今天条数', page.includes('<b>2</b><span>今天</span>'), true)

// —— 手机回话进提示词（0.22）——
const phoneHistory = path.join(os.tmpdir(), `drn-phone-test-${process.pid}.json`)
const nowMs = Date.now()
fs.writeFileSync(
  phoneHistory,
  JSON.stringify([
    { at: nowMs - 60000, kind: 'raw', title: '完成', message: '', action: 'timeout' },
    { at: nowMs - 30000, kind: 'raw', title: '手机回话', message: '', action: 'replied', reply: '收到了', via: 'mobile' },
    { at: nowMs - 20000, kind: 'raw', title: '桌面回话', message: '', action: 'replied', reply: '桌面上说的', via: 'desktop' },
  ]),
)
const phoneSettings = { historyFile: phoneHistory }
resetPhoneSeen(0)
check('unreadPhoneReplies 只算手机回话', unreadPhoneReplies(phoneSettings, 0).length, 1)
resetPhoneSeen(0)
const phonePrompt = phonePromptText(phoneSettings, nowMs + 1000)
check('phonePromptText 带上回话原文', phonePrompt.includes('手机回话：收到了'), true)
check('phonePromptText 不含桌面回话', phonePrompt.includes('桌面上说的'), false)
check('phonePromptText 第二次为空', phonePromptText(phoneSettings, nowMs + 2000), '')
resetPhoneSeen(nowMs + 3000)
check('resetPhoneSeen 之后不再提醒', phonePromptText(phoneSettings, nowMs + 4000), '')
// 0.23：手机回话带附件
check('uploadNameFor 按类型给扩展名', uploadNameFor('image/png', new Date(2026, 10, 21, 7, 8, 9)).startsWith('20261121-070809-'), true)
check('uploadNameFor 末尾是 png', uploadNameFor('image/png', new Date(2026, 10, 21, 7, 8, 9)).endsWith('.png'), true)
check('uploadNameFor 语音给 webm', uploadNameFor('audio/webm').endsWith('.webm'), true)
check('uploadNameFor 未知类型返回 null', uploadNameFor('application/zip'), null)
check('attachmentSummaryOf 空附件为空串', attachmentSummaryOf({}), '')
check('attachmentSummaryOf 列名字', attachmentSummaryOf({ attachments: [{ name: 'a.png' }, { name: 'b.webm' }] }), '（附 2 个：a.png、b.webm）')
const uploadRoot = path.join(os.tmpdir(), 'drn-upload-check')
fs.mkdirSync(uploadRoot, { recursive: true })
const inside = path.join(uploadRoot, 'ok.png')
fs.writeFileSync(inside, Buffer.from([1, 2, 3]))
const outside = path.join(os.tmpdir(), 'drn-outside.png')
fs.writeFileSync(outside, Buffer.from([1]))
check('mobileAttachmentsOf 只收上传目录里的', mobileAttachmentsOf([{ name: 'ok.png', file: inside }], uploadRoot).map((it) => it.name), ['ok.png'])
check('mobileAttachmentsOf 拦目录外文件', mobileAttachmentsOf([{ name: 'x.png', file: outside }], uploadRoot), [])
check('mobileAttachmentsOf 最多三个', mobileAttachmentsOf([inside, inside, inside, inside].map((file) => ({ name: 'ok.png', file })), uploadRoot).length, 3)
check('mobileAttachmentsOf 读出文件大小', mobileAttachmentsOf([{ name: 'ok.png', file: inside }], uploadRoot)[0].size, 3)

// —— 决定卡候选按钮（0.28） ——
check('normalizeChoices 收字符串', normalizeChoices(['拆分任务', '一次做完']), ['拆分任务', '一次做完'])
check('normalizeChoices 收对象', normalizeChoices([{ label: '选 A' }, { label: '选 B' }]), ['选 A', '选 B'])
check('normalizeChoices 最多四个', normalizeChoices(['1', '2', '3', '4', '5']).length, 4)
check('normalizeChoices 去掉竖线', normalizeChoices(['a|b']), ['a/b'])
check('normalizeChoices 截断到 12 字', normalizeChoices(['一二三四五六七八九十十一十二十三'])[0].length, 12)
check('normalizeChoices 空值返回空', normalizeChoices(undefined), [])
check('choicesArgOf 两个以上才给宿主', choicesArgOf({ options: ['A', 'B'] }), 'A|B')
check('choicesArgOf 只有一个不给', choicesArgOf({ options: ['A'] }), '')

const choiceHistory = path.join(os.tmpdir(), `drn-choice-test-${process.pid}.json`)
fs.writeFileSync(
  choiceHistory,
  JSON.stringify([
    { at: nowMs - 50000, kind: 'decide', title: '下一步做哪个', message: '', action: 'choice', choice: '选 A：拆分任务' },
    { at: nowMs - 40000, kind: 'decide', title: '另一个决定', message: '', action: 'timeout' },
    { at: nowMs - 30000, kind: 'raw', title: '普通', message: '', action: 'choice', choice: '' },
  ]),
)
const choiceSettings = { historyFile: choiceHistory }
resetChoiceSeen(0)
check('unreadChoices 只算有选择的条目', unreadChoices(choiceSettings, 0).length, 1)
resetChoiceSeen(0)
const choicePrompt = choicePromptText(choiceSettings, nowMs + 1000)
check('choicePromptText 带选择原文', choicePrompt.includes('选了：选 A：拆分任务'), true)
check('choicePromptText 第二次为空', choicePromptText(choiceSettings, nowMs + 2000), '')
resetChoiceSeen(nowMs + 3000)
check('resetChoiceSeen 之后不再提醒', choicePromptText(choiceSettings, nowMs + 4000), '')

const phonePage = mobilePageOf({ mobileToken: 'k' }, [], new Date(2026, 10, 21, 9, 0, 0))
check('页面有拍照入口', phonePage.includes('拍照 / 选图'), true)
check('页面有录音入口', phonePage.includes('录一段话'), true)
check('页面有上传地址', phonePage.includes('/dsh-reminder-notify/mobile/upload'), true)
try {
  fs.unlinkSync(inside)
} catch {}
try {
  fs.unlinkSync(outside)
} catch {}
try {
  fs.rmdirSync(uploadRoot)
} catch {}

try {
  fs.unlinkSync(phoneHistory)
} catch {}
// 0.24：手机页升级成小 App
check('mobileViewOf 解析三个视图', mobileViewOf({ tab: 'history', kind: 'done', page: '3' }), { tab: 'history', kind: 'done', page: 3 })
check('mobileViewOf 兜非法值', mobileViewOf({ tab: 'bogus', kind: 'x', page: '0' }), { tab: 'home', kind: 'all', page: 1 })
check('mobileViewOf 设置页', mobileViewOf({ tab: 'settings' }).tab, 'settings')
check('mobileSettingsPatch 只收白名单', mobileSettingsPatch({ values: { sound: false, quietEnabled: true, pushUrl: 'x', seconds: 9 } }), { sound: false, quietEnabled: true })
check('mobileSettingsPatch 空对象', mobileSettingsPatch({ values: {} }), {})
const appNow = new Date(2026, 10, 21, 10, 0, 0)
const appEntries = [
  { at: appNow.getTime() - 3600000, kind: 'done', title: '收工', message: '一条正文', action: 'ok', reply: '', attachments: [] },
  { at: appNow.getTime() - 7200000, kind: 'decide', title: '选一个', message: '两条正文', action: 'replied', reply: '选 A', attachments: [{ name: 'a.png' }] },
  { at: appNow.getTime() - 40 * 86400000, kind: 'raw', title: '很久以前', message: '', action: 'timeout' },
]
const csv = mobileCsvOf(appEntries, 30, appNow)
check('mobileCsvOf 表头', csv.split('\n')[0], '时间,档位,标题,正文,处理方式,回话,附件')
check('mobileCsvOf 只导出窗口内', csv.trim().split('\n').length, 3)
check('mobileCsvOf 带附件名', csv.includes('a.png'), true)
check('mobileCsvOf 转义引号', mobileCsvOf([{ at: appNow.getTime(), kind: 'raw', title: '他说"好"', message: '', action: 'ok' }], 30, appNow).includes('""好""'), true)
const bars = mobileBarsOf({ last30: [{ date: '2026-11-19', count: 1 }, { date: '2026-11-20', count: 4 }, { date: '2026-11-21', count: 2 }] }, 7)
check('mobileBarsOf 条数', bars.length, 3)
check('mobileBarsOf 最高柱 100%', bars[1].pct, 100)
check('mobileBarsOf 相对高度', bars[2].pct, 50)
const homePage = mobilePageOf({ mobileToken: 'k' }, appEntries, appNow, { tab: 'home' })
check('概览有导航', homePage.includes('>概览<') && homePage.includes('>历史<') && homePage.includes('>设置<'), true)
check('概览有 7 天图', homePage.includes('最近 7 天'), true)
const historyPage = mobilePageOf({ mobileToken: 'k' }, appEntries, appNow, { tab: 'history', kind: 'done' })
check('历史有筛选', historyPage.includes('>全部<') && historyPage.includes('>要你决定<'), true)
check('历史只有完成那条', historyPage.includes('收工') && !historyPage.includes('选一个'), true)
check('历史有翻页', historyPage.includes('上一页') && historyPage.includes('下一页'), true)
const pageTwo = mobilePageOf({ mobileToken: 'k' }, appEntries, appNow, { tab: 'history', page: 2 })
check('翻页页码提示', pageTwo.includes('共 3 条'), true)
const settingsPage = mobilePageOf({ mobileToken: 'k', sound: true }, appEntries, appNow, { tab: 'settings' })
check('设置有开关', settingsPage.includes('data-key="sound"') && settingsPage.includes('data-key="quietEnabled"'), true)
check('设置有导出', settingsPage.includes('导出 CSV') && settingsPage.includes('/mobile/export'), true)
check('设置显示当前状态', settingsPage.includes('日报时间'), true)


// 0.25：https 入口只放行手机页
check('mobileProxyPathOk 放行手机页', mobileProxyPathOk('/dsh-reminder-notify/mobile'), true)
check('mobileProxyPathOk 放行子路径', mobileProxyPathOk('/dsh-reminder-notify/mobile/reply'), true)
check('mobileProxyPathOk 拦住别的路由', mobileProxyPathOk('/dsh-reminder-notify/config'), false)
check('mobileProxyPathOk 拦住根路径', mobileProxyPathOk('/'), false)

const httpsSample = httpsLinkOf({ httpsPort: 1319, mobileToken: 'abc123' }, '', { address: '192.168.1.36' })
check('httpsLinkOf 地址与端口', httpsSample, 'https://192.168.1.36:1319/dsh-reminder-notify/mobile?t=abc123')
check('httpsLinkOf 端口夹在合法区间', httpsLinkOf({ httpsPort: 80, mobileToken: 'x' }, '', { address: '10.0.0.2' }).startsWith('https://10.0.0.2:1024/'), true)


if (failed > 0) {
  console.log(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
