// dsh-reminder-notify —— 把「桌面提醒」变成 DSH 插件
//
// 设计要点（见 docs/DETAIL.md）：
//   * 默认宿主是包内的 host/ReminderHost.ps1：系统自带 PowerShell 5.1 + WinForms，
//     C# 代码在运行期用 Add-Type 编译，仓库里没有任何二进制，也就不需要签名证书、
//     不会被 SmartScreen / 杀软当成未知 exe 拦下来。
//   * 老宿主 Harness完成提醒.exe 仍然支持（hostMode: 'exe'），给已经装了客户端的机器用。
//   * 一律用参数数组而不是 shell 字符串 —— 中文、空格、括号（"D:\\a豆包制作工作"）都不需要转义。
//   * detached + stdio:'ignore' + unref()：弹窗是独立进程，不会拖住 DSH 或本轮对话。
//   * 工具只做一件小事（弹提醒并立刻返回），失败也不抛异常，避免把收尾动作变成阻塞。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-reminder-notify'
export const inject = ['tools']

// schemastery 由 dsh 安装自带（profile 的 node_modules 里就有），所以包里不声明依赖。
// 用动态 import 兜底：万一在纯裸仓库里跑（没有 dsh 的依赖树），插件本体仍可工作，
// 只是插件页没有 schema 表单 —— 不要让一个 UI 依赖把提醒功能整个弄挂。
const z = await import('@deepseek-ai/schemastery')
  .then((mod) => mod.default ?? mod)
  .catch(() => null)

// 插件页的设置表单由这份 schema 渲染（client.js 再在上面做分组面板）。
// 每一项的默认值与 settingsOf() 里的兜底一致：空字符串表示「用包内资源」。
//
// 为什么每个字段都要 .volatile()：宿主 settings.describe() 只把「可按热更新就地改动」
// 的字段投影进 namespaces（volatileForm 会跳过没有 volatile 标记的字段），而插件页的
// 设置面板只对 namespaces 里出现过的条目渲染 form。不标 volatile 的话面板会拿到
// undefined 并显示「这个页面拿不到插件配置」。
// 标了 volatile 还有个好处：改完立刻生效，不用重启插件 —— notify() 每次调用都会用
// settingsOf(config) 现读，所以拿到的就是最新值。
export const Config = z === null ? undefined : z.object({
  hostMode: z.union(['script', 'exe']).default('script').description('宿主模式：script = 包内 PowerShell 脚本（默认），exe = 老的客户端 exe').volatile(),
  scriptPath: z.string().default('').description('脚本宿主路径，留空 = 包内 host/ReminderHost.ps1').volatile(),
  powershellPath: z.string().default('powershell.exe').description('调 PowerShell 用的可执行文件').volatile(),
  clientDir: z.string().default('').description('exe 模式下的客户端目录，留空 = 包内 assets/').volatile(),
  audioDir: z.string().default('').description('提示音目录，留空 = 包内 assets/提示音导入/').volatile(),
  seconds: z.number().min(2).max(600).step(1).default(60).description('弹窗停留秒数（2–600）').volatile(),
  position: z.union(['br', 'center', 'tr']).default('br').description('弹窗位置：br 右下、center 居中、tr 右上').volatile(),
  cardsEnabled: z.boolean().default(true).description('总开关：关掉后不再弹出任何提醒卡片（历史、日报推送照常）').volatile(),
  backupEnabled: z.boolean().default(true).description('自动备份配置到本机（每天一份，恢复时可回滚）').volatile(),
  backupDir: z.string().default('').description('备份目录，留空用 ~/.dsh/dsh-reminder-notify/backups').volatile(),
  statsEnabled: z.boolean().default(true).description('面板里显示本插件的 npm 下载量（来自 npm 公开统计）').volatile(),
  statsCacheMinutes: z.number().min(1).max(1440).step(1).default(10).description('下载量缓存多少分钟，免得每次打开面板都去查').volatile(),
  feedbackEnabled: z.boolean().default(true).description('面板里允许写反馈留言').volatile(),
  feedbackFile: z.string().default('').description('留言保存的 JSONL 文件，留空用 ~/.dsh/dsh-reminder-notify/feedback.jsonl').volatile(),
  feedbackRepo: z.string().default('Jiangshuaiye1203/dsh-reminder-notify').description('「在 GitHub 上提交」指向的仓库（owner/repo）').volatile(),
  sound: z.boolean().default(true).description('是否播放提示音').volatile(),
  doneAudio: z.string().default('完成提醒语音.wav').description('done 档位的提示音文件名（wav / mp3，在提示音目录下）').volatile(),
  decideAudio: z.string().default('需要你来决定.wav').description('decide 档位的提示音文件名（wav / mp3）').volatile(),
  rawAudio: z.string().default('').description('raw 档位的提示音文件名（wav / mp3），留空 = 静音').volatile(),
  accentDone: z.string().default('#2ECC71').description('done 档位卡片强调色（#RRGGBB）').volatile(),
  accentDecide: z.string().default('#F5A623').description('decide 档位卡片强调色').volatile(),
  accentRaw: z.string().default('#4C8DFF').description('raw 档位卡片强调色').volatile(),
  cooldownMs: z.number().min(0).step(100).default(1500).description('同档位提醒的最小间隔（毫秒）').volatile(),
  cardBackground: z.string().default('').description('卡片背景图路径（png / jpg），留空 = 纯色背景').volatile(),
  cardIcon: z.string().default('').description('标题左侧的小图标路径（png / ico），留空 = 不显示').volatile(),
  doneCardBackground: z.string().default('').description('done 档位单独用的背景图，留空 = 用上面的通用背景').volatile(),
  decideCardBackground: z.string().default('').description('decide 档位单独用的背景图，留空 = 用通用背景').volatile(),
  rawCardBackground: z.string().default('').description('raw 档位单独用的背景图，留空 = 用通用背景').volatile(),
  doneCardIcon: z.string().default('').description('done 档位单独用的标题图标，留空 = 用通用图标').volatile(),
  decideCardIcon: z.string().default('').description('decide 档位单独用的标题图标，留空 = 用通用图标').volatile(),
  rawCardIcon: z.string().default('').description('raw 档位单独用的标题图标，留空 = 用通用图标').volatile(),
  titleTemplate: z.string().default('{title}').description('标题模板，可用占位符 {title} {message} {kind} {time}').volatile(),
  messageTemplate: z.string().default('{message}').description('正文模板，可用占位符 {title} {message} {kind} {time}').volatile(),
  doneTitleTemplate: z.string().default('').description('done 档位单独的标题模板，留空 = 用上面的通用模板').volatile(),
  doneMessageTemplate: z.string().default('').description('done 档位单独的正文模板，留空 = 用通用模板').volatile(),
  decideTitleTemplate: z.string().default('').description('decide 档位单独的标题模板，留空 = 用通用模板').volatile(),
  decideMessageTemplate: z.string().default('').description('decide 档位单独的正文模板，留空 = 用通用模板').volatile(),
  rawTitleTemplate: z.string().default('').description('raw 档位单独的标题模板，留空 = 用通用模板').volatile(),
  rawMessageTemplate: z.string().default('').description('raw 档位单独的正文模板，留空 = 用通用模板').volatile(),
  balanceEnabled: z.boolean().default(false).description('DeepSeek 余额不足时弹卡提醒（用本机已登录的 DSH 账号查余额）').volatile(),
  balanceBaseline: z.number().default(0).description('余额基线（充值后的余额）；0 = 自动记录见过的最高余额').volatile(),
  balanceThresholds: z.string().default('20,10,5').description('触发阈值，按基线的百分比，逗号分隔（例如 20,10,5）').volatile(),
  balanceSpeak: z.boolean().default(true).description('提醒时用系统语音读出余额').volatile(),
  balanceCheckMinutes: z.number().min(5).max(1440).step(5).default(30).description('自动查余额的间隔（分钟）').volatile(),
  balanceFired: z.number().default(0).description('内部状态：已经报过的最小阈值，余额回升后自动清零').volatile(),
  balanceBaselineAt: z.number().default(0).description('内部状态：基线设定的时间（毫秒时间戳）').volatile(),
  balanceBaselineAccount: z.string().default('').description('内部状态：基线属于哪个账号（平台用户 id），换号自动重来').volatile(),
  balanceBaselineSource: z.string().default('').description('内部状态：基线来源（auto = 自动取余额，manual = 手动设定）').volatile(),
  speakEnabled: z.boolean().default(false).description('弹卡时用系统语音把正文念出来（默认关，避免连环打扰）').volatile(),
  buttonsEnabled: z.boolean().default(true).description('卡片上显示「知道了 / 稍后提醒」两个按钮').volatile(),
  snoozeMinutes: z.number().min(1).max(240).step(1).default(10).description('点「稍后提醒」后多少分钟再弹（1–240）').volatile(),
  queueEnabled: z.boolean().default(true).description('同一时刻只显示一张卡，其余排队，避免叠成一堆').volatile(),
  queueMax: z.number().min(1).max(20).step(1).default(5).description('最多同时排几条（1–20），超出丢弃最旧的').volatile(),
  mergeWindowMs: z.number().min(0).max(60000).step(500).default(3000).description('同档位提醒在这个窗口内合并成一条（毫秒，0 = 不合并）').volatile(),
  quietEnabled: z.boolean().default(false).description('开启免打扰时段（decide 档位永远不吞）').volatile(),
  quietStart: z.string().default('22:00').description('免打扰开始时间，HH:MM').volatile(),
  quietEnd: z.string().default('08:00').description('免打扰结束时间，HH:MM（可跨零点）').volatile(),
  quietMode: z.union(['hold', 'skip']).default('hold').description('免打扰期间：hold = 攒到时段结束再弹，skip = 直接丢弃').volatile(),
  compactOnFullscreen: z.boolean().default(true).description('检测到全屏程序（游戏 / 视频）时自动缩成一条小卡片').volatile(),
  historyEnabled: z.boolean().default(true).description('记录提醒历史（本地 JSON），供插件页看统计').volatile(),
  historyLimit: z.number().min(20).max(2000).step(10).default(200).description('历史最多保留多少条（20–2000）').volatile(),
  recurringEnabled: z.boolean().default(true).description('允许「每 30 分钟提醒一次」这类周期提醒').volatile(),
  recurringFile: z.string().default('').description('周期提醒的存档文件，留空 = <用户目录>\.dsh\dsh-reminder-notify\recurring.json').volatile(),
  historyFile: z.string().default('').description('历史文件路径，留空 = <用户目录>\\.dsh\\dsh-reminder-notify\\history.json').volatile(),
  digestEnabled: z.boolean().default(false).description('每天在固定时间弹一条「今日提醒日报」').volatile(),
  digestTime: z.string().default('09:00').description('日报时间，HH:MM（每天只在过点后的第一次检查里发一条）').volatile(),
  digestTitle: z.string().default('今日提醒日报').description('日报卡片标题').volatile(),
  digestIncludeBalance: z.boolean().default(true).description('日报里带上当前 DeepSeek 余额').volatile(),
  digestAlertCount: z.number().min(0).max(500).step(5).default(0).description('当天提醒超过这个条数时额外弹一张预警卡（0 = 关）').volatile(),
  digestLastDate: z.string().default('').description('内部状态：上次发日报的日期').volatile(),
  digestAlertDate: z.string().default('').description('内部状态：上次弹条数预警的日期').volatile(),
  pushEnabled: z.boolean().default(false).description('把提醒同时推到手机（企业微信机器人 / Server酱 / 自定义 webhook）').volatile(),
  pushUrl: z.string().default('').description('推送地址，例如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…').volatile(),
  pushFormat: z.union(['wecom', 'serverchan', 'json', 'text', 'telegram', 'feishu', 'dingtalk']).default('wecom').description('推送格式：wecom 企业微信机器人、serverchan Server酱、telegram、feishu 飞书、dingtalk 钉钉、json 通用 JSON、text 纯文本').volatile(),
  pushChat: z.string().default('').description('telegram 用的 chat_id（只 telegram 格式需要）').volatile(),
  maxHoldSeconds: z.number().min(0).max(3600).step(5).default(0).description('单张卡最长停留秒数（0 = 不额外限制，仍以 600 为上限）').volatile(),
  pushDecide: z.boolean().default(true).description('「需要你来决定」档位也推到手机').volatile(),
  pushDigest: z.boolean().default(true).description('日报同时推到手机').volatile(),
  conditionsEnabled: z.boolean().default(true).description('条件提醒总开关（余额、排队、宿主失败、免打扰、条数）').volatile(),
  condBalanceBelow: z.boolean().default(true).description('余额跌破预警档时弹一张卡（复用余额基线与阈值）').volatile(),
  condQueueBacklog: z.number().min(0).max(50).step(1).default(0).description('排队达到这么多条时弹卡提醒（0 = 关）').volatile(),
  condHostFailures: z.number().min(0).max(20).step(1).default(0).description('宿主连续失败达到这么多次时弹卡提醒（0 = 关）').volatile(),
  condQuietEnter: z.boolean().default(false).description('进入免打扰时段时弹一张卡告知').volatile(),
  condDailyCount: z.number().min(0).max(500).step(1).default(0).description('今天提醒条数超过这个数时弹卡提醒（0 = 关）').volatile(),
  condCooldownMinutes: z.number().min(0).max(1440).step(1).default(120).description('同一条件两次提醒之间的最小间隔分钟数').volatile(),
  condState: z.string().default('').description('内部状态：各条件上次触发时间').volatile(),
  toastEnabled: z.boolean().default(false).description('同时发一条 Windows 原生通知（右下角通知中心，不弹卡片）').volatile(),
  toastSeconds: z.number().min(3).max(60).step(1).default(8).description('原生通知停留秒数').volatile(),
  trayEnabled: z.boolean().default(false).description('启动托盘图标与全局热键（插件启动时自动拉起）').volatile(),
  trayHotkey: z.string().default('Ctrl+Alt+R').description('托盘全局热键，形如 Ctrl+Alt+R').volatile(),
  trayStateFile: z.string().default('').description('托盘静音/免打扰状态文件（留空用 ~/.dsh/dsh-reminder-notify/tray-state.json）').volatile(),
  httpsEnabled: z.boolean().default(false).description('手机页加一个 https 入口（自签证书）：手机才能录音、也能当真 PWA 装到桌面').volatile(),
  httpsPort: z.number().default(1319).description('https 入口用的端口').volatile(),
  httpsPfx: z.string().default('').description('自签证书 pfx 路径，留空用 ~/.dsh/dsh-reminder-notify/mobile.pfx').volatile(),
  retryHostOnce: z.boolean().default(true).description('宿主第一次没画出卡片时，自动静音重试一次').volatile(),
  replyEnabled: z.boolean().default(true).description('卡片上给一个输入框，可以把一句话回给模型').volatile(),
  customButtons: z.string().default('').description('卡片上的自定义按钮：标签|网址，多条用分号隔开，最多 3 个').volatile(),
  focusAssistMute: z.boolean().default(true).description('Windows 专注助手 / 演示模式开着时自动静音').volatile(),
  pushReply: z.boolean().default(true).description('用户在卡片上回话时也推到手机').volatile(),
  mobileToken: z.string().default('').description('手机页面（局域网）的访问口令，留空由插件自动生成').volatile(),
  dryRun: z.boolean().default(false).description('调试用：只试算参数、不真的弹窗（自检脚本会打开它）').volatile(),
})

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLED_HOST_SCRIPT = path.join(PACKAGE_ROOT, 'host', 'ReminderHost.ps1')
const BUNDLED_CLIENT_DIR = path.join(PACKAGE_ROOT, 'assets')
const BUNDLED_AUDIO_DIR = path.join(PACKAGE_ROOT, 'assets', '提示音导入')
const EXE_NAME = 'Harness完成提醒.exe'
const AUDIO_SUBDIR = '提示音导入'

// webServer 在冷启动时可能还没就绪（apply 早于它初始化），此前各路由直接 return，
// 结果整场会话里面板 / 托盘 / 自检路由全部 404。这里改成「就绪即挂」：
// 先试一次，不行就每 250ms 重试，最多等 60 秒；插件卸载时清掉定时器。
export function mountRoute(ctx, route, label) {
  const readWeb = () => (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
  const ready = () => {
    const web = readWeb()
    return web !== undefined && web !== null && typeof web.register === 'function' ? web : null
  }
  const attach = (web) => {
    try {
      const dispose = web.register(route)
      ctx.effect(() => (typeof dispose === 'function' ? dispose : () => {}), `dsh-reminder-notify: ${label}`)
    } catch (error) {
      ctx.logger?.warn?.(`dsh-reminder-notify: ${label} 注册失败：${String(error && error.message ? error.message : error)}`)
    }
  }
  const now = ready()
  if (now !== null) {
    attach(now)
    return
  }
  let waited = 0
  const timer = setInterval(() => {
    waited += 250
    const web = ready()
    if (web === null) {
      if (waited >= 60000) {
        clearInterval(timer)
        ctx.logger?.warn?.(`dsh-reminder-notify: webServer 一直不可用（等了 60 秒），${label} 没有注册`)
      }
      return
    }
    clearInterval(timer)
    attach(web)
  }, 250)
  if (typeof timer?.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), `dsh-reminder-notify: ${label} watcher`)
}

const KINDS = ['done', 'decide', 'raw']
const POSITIONS = new Set(['br', 'center', 'tr'])
// 脚本宿主额外支持左上、底部居中；exe 宿主只有 br/center/tr，两个模式的交集就是上面这三个。

const DEFAULT_TITLES = {
  done: 'Harness 已完成工作',
  decide: '需要你来决定',
  raw: 'Harness 提醒',
}
const DEFAULT_MESSAGES = {
  done: '你交代的任务已经做完，可以来收货了。',
  decide: '有件事需要你来决定，请回来看一眼。',
  raw: '',
}
const DEFAULT_ACCENTS = {
  done: '#2ECC71',
  decide: '#F5A623',
  raw: '#4C8DFF',
}

// 同一种提醒在冷却窗口内只弹一次：模型偶尔会在同一轮里重复调用收尾提醒。
const lastFiredAt = new Map()

function str(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function num(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

// 标了 .volatile() 的字段在运行期是 { get(), [write]() } 包装（schemastery 的热更新句柄），
// 直接读会把字符串读成 "[object Object]"，所以统一在这里解包。
function unwrapValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

function configValues(config) {
  const out = {}
  if (config !== null && typeof config === 'object') {
    for (const key of Object.keys(config)) {
      Object.defineProperty(out, key, { value: unwrapValue(config[key]), enumerable: true })
    }
  }
  return out
}

function settingsOf(config) {
  const c = configValues(config)
  const position = str(c.position, 'br')
  const hostMode = str(c.hostMode, 'script').toLowerCase()
  return {
    hostMode: hostMode === 'exe' ? 'exe' : 'script',
    clientDir: str(c.clientDir, ''),
    scriptPath: str(c.scriptPath, BUNDLED_HOST_SCRIPT),
    powershellPath: str(c.powershellPath, 'powershell.exe'),
    audioDir: str(c.audioDir, BUNDLED_AUDIO_DIR),
    seconds: Math.round(clamp(num(c.seconds, 60), 2, 600)),
    position: POSITIONS.has(position) ? position : 'br',
    cardsEnabled: c.cardsEnabled !== false,
    statsEnabled: c.statsEnabled !== false,
    backupEnabled: c.backupEnabled !== false,
    backupDir: str(c.backupDir, ''),
    statsCacheMinutes: Math.round(clamp(num(c.statsCacheMinutes, 10), 1, 1440)),
    feedbackEnabled: c.feedbackEnabled !== false,
    feedbackFile: str(c.feedbackFile, ''),
    feedbackRepo: str(c.feedbackRepo, 'Jiangshuaiye1203/dsh-reminder-notify'),
    sound: c.sound !== false,
    doneAudio: str(c.doneAudio, '完成提醒语音.wav'),
    decideAudio: str(c.decideAudio, '需要你来决定.wav'),
    rawAudio: str(c.rawAudio, ''),
    accentDone: str(c.accentDone, DEFAULT_ACCENTS.done),
    accentDecide: str(c.accentDecide, DEFAULT_ACCENTS.decide),
    accentRaw: str(c.accentRaw, DEFAULT_ACCENTS.raw),
    cooldownMs: Math.max(0, Math.round(num(c.cooldownMs, 1500))),
    cardBackground: str(c.cardBackground, ''),
    cardIcon: str(c.cardIcon, ''),
    doneCardBackground: str(c.doneCardBackground, ''),
    decideCardBackground: str(c.decideCardBackground, ''),
    rawCardBackground: str(c.rawCardBackground, ''),
    doneCardIcon: str(c.doneCardIcon, ''),
    decideCardIcon: str(c.decideCardIcon, ''),
    rawCardIcon: str(c.rawCardIcon, ''),
    titleTemplate: typeof c.titleTemplate === 'string' ? c.titleTemplate : '{title}',
    messageTemplate: typeof c.messageTemplate === 'string' ? c.messageTemplate : '{message}',
    doneTitleTemplate: typeof c.doneTitleTemplate === 'string' ? c.doneTitleTemplate : '',
    doneMessageTemplate: typeof c.doneMessageTemplate === 'string' ? c.doneMessageTemplate : '',
    decideTitleTemplate: typeof c.decideTitleTemplate === 'string' ? c.decideTitleTemplate : '',
    decideMessageTemplate: typeof c.decideMessageTemplate === 'string' ? c.decideMessageTemplate : '',
    rawTitleTemplate: typeof c.rawTitleTemplate === 'string' ? c.rawTitleTemplate : '',
    rawMessageTemplate: typeof c.rawMessageTemplate === 'string' ? c.rawMessageTemplate : '',
    balanceEnabled: c.balanceEnabled === true,
    balanceBaseline: Math.max(0, num(c.balanceBaseline, 0)),
    balanceThresholds: typeof c.balanceThresholds === 'string' ? c.balanceThresholds : '20,10,5',
    balanceSpeak: c.balanceSpeak !== false,
    balanceCheckMinutes: Math.round(clamp(num(c.balanceCheckMinutes, 30), 5, 1440)),
    balanceFired: Math.max(0, num(c.balanceFired, 0)),
    balanceBaselineAt: Math.max(0, num(c.balanceBaselineAt, 0)),
    balanceBaselineAccount: str(c.balanceBaselineAccount, ''),
    balanceBaselineSource: str(c.balanceBaselineSource, ''),
    speakEnabled: c.speakEnabled === true,
    buttonsEnabled: c.buttonsEnabled !== false,
    snoozeMinutes: Math.round(clamp(num(c.snoozeMinutes, 10), 1, 240)),
    queueEnabled: c.queueEnabled !== false,
    queueMax: Math.round(clamp(num(c.queueMax, 5), 1, 20)),
    mergeWindowMs: Math.max(0, Math.round(num(c.mergeWindowMs, 3000))),
    quietEnabled: c.quietEnabled === true,
    quietStart: str(c.quietStart, '22:00'),
    quietEnd: str(c.quietEnd, '08:00'),
    quietMode: str(c.quietMode, 'hold') === 'skip' ? 'skip' : 'hold',
    compactOnFullscreen: c.compactOnFullscreen !== false,
    historyEnabled: c.historyEnabled !== false,
    historyLimit: Math.round(clamp(num(c.historyLimit, 200), 20, 2000)),
    historyFile: str(c.historyFile, ''),
    recurringEnabled: c.recurringEnabled !== false,
    recurringFile: str(c.recurringFile, ''),
    digestEnabled: c.digestEnabled === true,
    digestTime: str(c.digestTime, '09:00'),
    digestTitle: str(c.digestTitle, '今日提醒日报'),
    digestIncludeBalance: c.digestIncludeBalance !== false,
    digestAlertCount: Math.round(clamp(num(c.digestAlertCount, 0), 0, 500)),
    digestLastDate: str(c.digestLastDate, ''),
    digestAlertDate: str(c.digestAlertDate, ''),
    pushEnabled: c.pushEnabled === true,
    pushUrl: typeof c.pushUrl === 'string' ? c.pushUrl.trim() : '',
    pushFormat: ['wecom', 'serverchan', 'json', 'text', 'telegram', 'feishu', 'dingtalk'].includes(c.pushFormat) ? c.pushFormat : 'wecom',
    pushChat: typeof c.pushChat === 'string' ? c.pushChat.trim() : '',
    maxHoldSeconds: Math.round(clamp(num(c.maxHoldSeconds, 0), 0, 3600)),
    pushDecide: c.pushDecide !== false,
    pushDigest: c.pushDigest !== false,
    conditionsEnabled: c.conditionsEnabled !== false,
    condBalanceBelow: c.condBalanceBelow !== false,
    condQueueBacklog: Math.round(clamp(num(c.condQueueBacklog, 0), 0, 50)),
    condHostFailures: Math.round(clamp(num(c.condHostFailures, 0), 0, 20)),
    condQuietEnter: c.condQuietEnter === true,
    condDailyCount: Math.round(clamp(num(c.condDailyCount, 0), 0, 500)),
    condCooldownMinutes: Math.round(clamp(num(c.condCooldownMinutes, 120), 0, 1440)),
    condState: typeof c.condState === 'string' ? c.condState : '',
    toastEnabled: c.toastEnabled === true,
    toastSeconds: Math.round(clamp(num(c.toastSeconds, 8), 3, 60)),
    trayEnabled: c.trayEnabled === true,
    trayHotkey: str(c.trayHotkey, 'Ctrl+Alt+R'),
    trayStateFile: str(c.trayStateFile, ''),
    httpsEnabled: c.httpsEnabled === true,
    httpsPort: clamp(num(c.httpsPort, 1319), 1024, 65535),
    httpsPfx: str(c.httpsPfx, ''),
    retryHostOnce: c.retryHostOnce !== false,
    replyEnabled: c.replyEnabled !== false,
    customButtons: str(c.customButtons, ''),
    focusAssistMute: c.focusAssistMute !== false,
    pushReply: c.pushReply !== false,
    mobileToken: str(c.mobileToken, ''),
    dryRun: c.dryRun === true,
  }
}

function clientDirOf(settings) {
  const dir = settings.clientDir !== '' ? settings.clientDir : BUNDLED_CLIENT_DIR
  return path.resolve(dir)
}

function audioNameOf(kind, settings) {
  if (kind === 'done') return settings.doneAudio
  if (kind === 'decide') return settings.decideAudio
  return settings.rawAudio
}

function accentOf(kind, settings) {
  const raw = kind === 'done' ? settings.accentDone : kind === 'decide' ? settings.accentDecide : settings.accentRaw
  // 不带 #：PowerShell 会把 # 开头的参数当成注释，后面就等于没传值。
  return String(raw).replace(/^#/, '')
}

// 文案模板：{title} {message} {kind} {time}，模板为空或整行留空时按原文输出。
function clockText(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function renderTemplate(template, fallback, vars) {
  const tpl = typeof template === 'string' && template.trim() !== '' ? template : fallback
  return tpl.replace(/\{(title|message|kind|time)\}/g, (_match, key) => String(vars[key] ?? ''))
}

// 背景图 / 图标：支持绝对路径，也支持相对包目录的路径；文件不在就当作没配。
function assetPath(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') return ''
  const full = path.isAbsolute(raw) ? raw : path.resolve(PACKAGE_ROOT, raw)
  return fs.existsSync(full) ? full : ''
}

// 档位外观：doneCardBackground / decideCardIcon 这类按档位覆盖，留空就退回通用值。
function appearanceOf(kind, settings) {
  const background = str(settings[`${kind}CardBackground`], '') !== ''
    ? settings[`${kind}CardBackground`]
    : settings.cardBackground
  const icon = str(settings[`${kind}CardIcon`], '') !== ''
    ? settings[`${kind}CardIcon`]
    : settings.cardIcon
  return { background: assetPath(background), icon: assetPath(icon) }
}


// PowerShell 自己还会再解析一遍 -File 之后的参数，所以这里把英文双引号替换掉，
// 避免一条带引号的正文把后面所有参数吃掉。
function psSafe(value) {
  return String(value).replace(/"/g, "'").replace(/[\r\n]+/g, ' ')
}

function launch(file, argv, cwd) {
  return new Promise((resolve, reject) => {
    let child
    try {
      // 注意：这里**不能** detached:true —— 在 Windows 上 detached 会让 powershell.exe
      // 立刻以 0 退出、什么都不画（实测 404ms 就没了，连日志都不写）。
      // windowsHide:true + stdio:'ignore' 已经看不见控制台窗口，unref() 让父进程不必等它。
      child = spawn(file, argv, {
        cwd,
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch (error) {
      reject(error)
      return
    }
    const onError = (error) => reject(error)
    child.once('error', onError)
    child.once('spawn', () => {
      child.off('error', onError)
      child.unref()
      resolve({
        pid: child.pid ?? null,
        // 退出码只用于自检，不阻塞工具返回；失败时也不会让本轮报错。
        exited: new Promise((done) => child.once('exit', (code) => done(code))),
      })
    })
  })
}

// 0.20：自定义按钮。配置里是全局的「标签|网址」列表，单条提醒也可以带自己的按钮
// （notify_user 的 args.buttons: [{label, url}]），两者合并，最多 3 个。
export function parseCustomButtons(text) {
  const out = []
  const raw = String(text ?? '')
  for (const chunk of raw.split(';')) {
    const piece = chunk.trim()
    if (piece === '') continue
    const at = piece.indexOf('|')
    const label = (at >= 0 ? piece.slice(0, at) : piece).trim()
    const url = at >= 0 ? piece.slice(at + 1).trim() : ''
    if (label === '') continue
    out.push({ label: label.slice(0, 8), url })
    if (out.length >= 3) break
  }
  return out
}

export function customButtonsSpec(list) {
  const parts = []
  for (const item of Array.isArray(list) ? list : []) {
    const label = String(item?.label ?? '').trim()
    if (label === '') continue
    const url = String(item?.url ?? '').trim()
    parts.push(`${label.slice(0, 8)}|${url}`)
    if (parts.length >= 3) break
  }
  return parts.join(';')
}

export function customButtonsOf(settings, item) {
  const own = Array.isArray(item?.buttons) ? item.buttons : []
  if (own.length > 0) return customButtonsSpec(own)
  return parseCustomButtons(settings.customButtons).map((one) => `${one.label}|${one.url}`).join(';')
}

function argvOfScriptHost(o) {
  // 参数用数组逐项传，不拼字符串：中文、空格、括号都不需要转义。
  const argv = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    o.scriptPath,
    '-Title',
    psSafe(o.title),
    '-Msg',
    psSafe(o.message),
    '-Seconds',
    String(o.seconds),
    '-Pos',
    o.position,
    '-Accent',
    o.accent,
  ]
  if (o.sound && o.audioPath !== '') argv.push('-Audio', o.audioPath)
  else argv.push('-NoSound')
  if (o.background) argv.push('-Background', o.background)
  if (o.icon) argv.push('-Icon', o.icon)
  if (o.speak) argv.push('-Speak', psSafe(o.speak))
  if (o.resultPath) argv.push('-ResultPath', o.resultPath)
  if (o.buttonsEnabled === false) argv.push('-NoButtons')
  else argv.push('-SnoozeMinutes', String(o.snoozeMinutes))
  if (o.compact) argv.push('-Compact')
  if (o.autoCompact) argv.push('-AutoCompact')
  if (o.queueLeft > 0) argv.push('-QueueLeft', String(o.queueLeft))
  if (o.openUrl) argv.push('-OpenUrl', String(o.openUrl))
  if (o.replyEnabled) argv.push('-Reply')
  if (o.customButtons) argv.push('-CustomButtons', String(o.customButtons))
  if (o.choices) argv.push('-Choices', String(o.choices))
  if (o.focusAssistMute) argv.push('-RespectFocus')
  return argv
}

// ——— 提醒队列 ————————————————————————————————————————————————————
//
// 一次只放一张卡。模型有时会在一轮里连发两三条提醒，直接 spawn 会在屏幕角上叠一摞，
// 谁也看不清；所以这里排一个先进先出的队列：
//   · 同一档位在 mergeWindowMs 内到的第二条，直接并进排队中的那一条（正文换行追加）；
//   · 卡片关掉之后再放下一张，卡上会写「还有 N 条」；
//   · 用户点「稍后提醒」，这条隔 snoozeMinutes 再回到队尾。
const queue = []
let active = null

function historyPathOf(settings) {
  if (settings.historyFile !== '') return path.resolve(settings.historyFile)
  return path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'history.json')
}

function readHistory(settings) {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPathOf(settings), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeHistory(settings, list) {
  const file = historyPathOf(settings)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(list), 'utf8')
}

function appendHistory(settings, entry) {
  if (!settings.historyEnabled) return
  try {
    const list = readHistory(settings)
    list.push(entry)
    const limit = settings.historyLimit
    writeHistory(settings, list.length > limit ? list.slice(list.length - limit) : list)
  } catch {
    // 历史写不进去不影响弹卡本身
  }
}

// "22:00" → 1320（当天第几分钟）；解析不出来返回 null。
// "30m" / "2h" / "1d" → 分钟数；解析不出来返回 null。周期提醒用。
export function parseEvery(text) {
  const found = /^(\d{1,4})\s*([mhd])$/i.exec(String(text ?? '').trim())
  if (found === null) return null
  const amount = Number(found[1])
  if (!Number.isFinite(amount) || amount <= 0) return null
  const unit = found[2].toLowerCase()
  const minutes = unit === 'm' ? amount : unit === 'h' ? amount * 60 : amount * 1440
  if (minutes < 1 || minutes > 10080) return null
  return minutes
}

// 上一次的点 + 周期，跳过所有已经错过的点，给出下一个将来时刻。
export function nextRunAfter(prevMs, everyMinutes, nowMs) {
  const step = Math.max(1, Math.round(everyMinutes)) * 60000
  let next = prevMs + step
  let guard = 0
  while (next <= nowMs && guard < 10000) {
    next += step
    guard += 1
  }
  return next
}

function recurringPathOf(settings) {
  if (settings.recurringFile !== '') return path.resolve(settings.recurringFile)
  return path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'recurring.json')
}

export function readRecurring(settings) {
  try {
    const parsed = JSON.parse(fs.readFileSync(recurringPathOf(settings), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function writeRecurring(settings, list) {
  const file = recurringPathOf(settings)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(list), 'utf8')
}

export function publicRecurring(job) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    message: job.message,
    everyMinutes: job.everyMinutes,
    remaining: job.remaining,
    nextAt: new Date(job.nextAt).toISOString(),
  }
}

export function createRecurring(settings, item, now = Date.now()) {
  if (settings.recurringEnabled !== true) return { ok: false, error: 'recurring-disabled' }
  const everyMinutes = Math.max(1, Math.round(Number(item.everyMinutes) || 0))
  const job = {
    id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: KINDS.includes(item.kind) ? item.kind : 'raw',
    title: str(item.title, ''),
    message: str(item.message, ''),
    seconds: num(item.seconds, 0),
    sound: item.sound === false ? false : undefined,
    url: str(item.url, ''),
    everyMinutes,
    remaining: Math.max(0, Math.round(Number(item.times) || 0)),
    nextAt: now + everyMinutes * 60000,
    createdAt: now,
  }
  const list = readRecurring(settings)
  list.push(job)
  writeRecurring(settings, list)
  return { ok: true, recurring: publicRecurring(job) }
}

export function parseClock(text) {
  const found = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (found === null) return null
  const hours = Number(found[1])
  const minutes = Number(found[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function inQuietHours(settings, now = new Date()) {
  if (!settings.quietEnabled) return false
  const start = parseClock(settings.quietStart)
  const end = parseClock(settings.quietEnd)
  if (start === null || end === null || start === end) return false
  const clock = now.getHours() * 60 + now.getMinutes()
  // 跨零点的时段（22:00 → 08:00）用 or 判断
  return start < end ? clock >= start && clock < end : clock >= start || clock < end
}

export function quietEndAt(settings, now = new Date()) {
  const end = parseClock(settings.quietEnd)
  if (end === null) return 0
  const at = new Date(now.getTime())
  at.setHours(Math.floor(end / 60), end % 60, 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at.getTime()
}

function priorityOf(kind) {
  // decide 是「要人来拍板」的，最优先；done 次之；raw 最低。
  if (kind === 'decide') return 2
  if (kind === 'done') return 1
  return 0
}

// at="22:00"（今天已过则明天）或 inMinutes=N → 到点时间戳；都没给返回 0（立刻弹）。
function dueAtOf(args) {
  const minutes = num(args.inMinutes, NaN)
  if (Number.isFinite(minutes) && minutes > 0) {
    return Date.now() + Math.min(minutes, 7 * 24 * 60) * 60 * 1000
  }
  const clock = str(args.at, '')
  if (clock === '') return 0
  const target = parseClock(clock)
  if (target === null) return 0
  const now = new Date()
  const at = new Date(now.getTime())
  at.setHours(Math.floor(target / 60), target % 60, 0, 0)
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
  return at.getTime()
}

function enqueue(item) {
  const settings = item.settings
  if (!settings.queueEnabled) {
    // 关掉排队：立刻弹，仍然记一条历史
    active = item
    showItem(item).catch(() => {}).finally(() => {
      active = null
      pump()
    })
    return { queued: false, position: 0 }
  }
  const now = Date.now()
  if (settings.mergeWindowMs > 0 && !((item.dueAt ?? 0) > now)) {
    const pending = queue.find(
      (other) =>
        other.kind === item.kind &&
        (other.holdUntil ?? 0) === 0 &&
        now - other.createdAt <= settings.mergeWindowMs,
    )
    if (pending !== undefined) {
      pending.count += 1
      const merged = `${pending.message}\n${item.message}`.slice(0, 600)
      pending.message = merged
      return { queued: true, merged: true, position: queue.indexOf(pending) + 1, count: pending.count }
    }
  }
  queue.push(item)
  while (queue.length > settings.queueMax) queue.shift()
  pump()
  // pump() 可能已经把它直接放上屏（队列原本是空的），那种情况不算"排队"。
  const showing = active === item
  return { queued: !showing, position: queue.indexOf(item) + 1 }
}

function pump() {
  if (active !== null) return
  const now = Date.now()
  // 0.17：到点的（既不在免打扰里、也过了定时时间）才放；decide 永远排在前面。
  const ready = queue.filter(
    (item) => (item.holdUntil ?? 0) <= now && (item.dueAt ?? 0) <= now,
  )
  if (ready.length === 0) {
    // 剩下的要么在免打扰时段里，要么是定时提醒：睡到最早那个时间点再看
    const next = queue.reduce((min, item) => {
      const when = Math.max(item.holdUntil ?? 0, item.dueAt ?? 0)
      return when > now ? Math.min(min, when) : min
    }, Infinity)
    if (Number.isFinite(next)) {
      const timer = setTimeout(() => pump(), Math.max(1000, Math.min(next - now, 60 * 60 * 1000)))
      if (typeof timer.unref === 'function') timer.unref()
    }
    return
  }
  ready.sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
  )
  const item = ready[0]
  queue.splice(queue.indexOf(item), 1)
  active = item
  showItem(item)
    .catch(() => {})
    .finally(() => {
      active = null
      pump()
    })
}

// 0.28：决定卡直接给候选按钮。模型传 options: ['A', 'B']，用户点哪个就回哪个。
export function normalizeChoices(input) {
  if (!Array.isArray(input)) return []
  const out = []
  for (const raw of input) {
    const label = str(typeof raw === 'string' ? raw : raw?.label, '').replace(/\|/g, '/').trim()
    if (label === '') continue
    out.push(label.slice(0, 12))
    if (out.length >= 4) break
  }
  return out
}

export function choicesArgOf(item) {
  const list = normalizeChoices(item?.options)
  return list.length >= 2 ? list.join('|') : ''
}

async function showItem(item) {
  const settings = item.settings
  const scriptPath = path.resolve(settings.scriptPath)
  if (!fs.existsSync(scriptPath)) return
  const extras = appearanceOf(item.kind, settings)
  const queueLeft = queue.filter((other) => (other.holdUntil ?? 0) <= Date.now()).length
  const resultFile = path.join(
    os.tmpdir(),
    `dsh-reminder-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  )
  if (settings.toastEnabled === true) {
    sendToast(settings, toastArgsOf(settings, item.kind, item.title, item.message))
  }
  const argv = argvOfScriptHost({
    scriptPath,
    title: item.title,
    message: item.message,
    seconds: item.seconds,
    position: settings.position,
    accent: accentOf(item.kind, settings),
    audioPath: item.audioPath,
    sound: item.sound,
    background: extras.background,
    icon: extras.icon,
    speak: item.speak,
    resultPath: resultFile,
    openUrl: str(item.url, ''),
    buttonsEnabled: settings.buttonsEnabled,
    replyEnabled: settings.replyEnabled,
    customButtons: customButtonsOf(settings, item),
    choices: choicesArgOf(item),
    focusAssistMute: settings.focusAssistMute,
    snoozeMinutes: settings.snoozeMinutes,
    autoCompact: settings.compactOnFullscreen,
    queueLeft,
  })
  let action = 'unknown'
  let exitCode = null
  let hostError
  let replyText = ''
  let buttonLabel = ''
  let choiceText = ''
  let focusAssist = false
  try {
    const { exited } = await launch(settings.powershellPath, argv, PACKAGE_ROOT)
    exitCode = await exited
  } catch (error) {
    // spawn 失败就当作没弹出来，记录一条便于排查
    hostError = String(error?.message ?? error)
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.action === 'string') {
      action = parsed.action
      if (typeof parsed.reply === 'string') replyText = parsed.reply.trim()
      if (typeof parsed.button === 'string') buttonLabel = parsed.button.trim()
      if (typeof parsed.choice === 'string') choiceText = parsed.choice.trim()
      if (parsed.focusAssist === true) focusAssist = true
      if (action === 'snooze') {
        const minutes = Math.round(clamp(num(parsed.snooze, settings.snoozeMinutes), 1, 240))
        const timer = setTimeout(() => {
          queue.unshift({ ...item, createdAt: Date.now(), snoozed: true, count: 1, holdUntil: 0 })
          pump()
        }, minutes * 60 * 1000)
        if (typeof timer.unref === 'function') timer.unref()
      }
    }
  } catch {
    // 没有结果文件（比如宿主被杀）时按 unknown 记
  }
  // 0.16：宿主明明该写结果却没写（或非零退出）就记一次 host-failed，并在下面自动重试一次。
  if (hostError !== undefined) {
    action = 'host-failed'
    noteHostRun(exitCode, action, hostError)
  } else if (action === 'unknown' && exitCode !== null && exitCode !== 0) {
    action = 'host-failed'
    noteHostRun(exitCode, action, 'host exited before writing a result')
  } else {
    noteHostRun(exitCode, action)
  }
  try {
    fs.unlinkSync(resultFile)
  } catch {
    // 清不掉就算了，文件名带 pid + 时间戳不会互相覆盖
  }
  item.action = action
  if (action === 'host-failed' && settings.retryHostOnce && item.retried !== true) {
    // 兜底：静音重试一次（宿主偶发被系统策略拦下时，第二次通常能画出来）。
    const retry = setTimeout(() => {
      queue.unshift({ ...item, retried: true, count: item.count ?? 1, holdUntil: 0, createdAt: Date.now() })
      pump()
    }, 800)
    if (typeof retry.unref === 'function') retry.unref()
  }
  appendHistory(settings, {
    at: Date.now(),
    kind: item.kind,
    title: item.title,
    message: item.message,
    action,
    count: item.count ?? 1,
    snoozed: item.snoozed === true,
    quiet: item.quiet === true,
    ...(replyText !== '' ? { reply: replyText } : {}),
    ...(buttonLabel !== '' ? { button: buttonLabel } : {}),
    ...(choiceText !== '' ? { choice: choiceText } : {}),
    ...(focusAssist ? { focusAssist: true } : {}),
  })
  // 0.20：用户在卡上回话 → 记一条服务事件，并按开关推到手机（fire-and-forget）
  if (action === 'replied' && replyText !== '') {
    emitServiceEvent('replied', { kind: item.kind, title: item.title, reply: replyText })
    if (settings.pushEnabled === true && settings.pushReply === true && settings.dryRun !== true) {
      const pushed = pushOut(settings, `回复：${item.title}`, replyText, { kind: 'reply', time: new Date().toISOString() })
      if (pushed !== null && typeof pushed.catch === 'function') pushed.catch(() => {})
    }
  }
  if (action === 'choice' && choiceText !== '') {
    emitServiceEvent('chosen', { kind: item.kind, title: item.title, choice: choiceText })
  }
  if (action === 'custom' && buttonLabel !== '') {
    emitServiceEvent('button', { kind: item.kind, title: item.title, button: buttonLabel })
  }
  return action
}

async function notify(kind, args, settings) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'only-windows', detail: '桌面提醒只能在本机 Windows 上弹出' }
  }

  const everyMinutes = parseEvery(args.every)
  if (everyMinutes !== null) {
    return createRecurring(
      settings,
      { kind, title: args.title, message: args.message, seconds: args.seconds, sound: args.sound, url: args.url, everyMinutes, times: args.times },
      Date.now(),
    )
  }

  const plainTitle = str(args.title, DEFAULT_TITLES[kind])
  const plainMessage = str(args.message, DEFAULT_MESSAGES[kind])
  const vars = { title: plainTitle, message: plainMessage, kind, time: clockText(new Date()) }
  // 档位模板优先：留空就退回上面的通用模板，两层都空才落到 "{title}" / "{message}"。
  const kindTitleTemplate = str(settings[`${kind}TitleTemplate`], '')
  const kindMessageTemplate = str(settings[`${kind}MessageTemplate`], '')
  const title = renderTemplate(kindTitleTemplate !== '' ? kindTitleTemplate : settings.titleTemplate, '{title}', vars)
  const message = renderTemplate(kindMessageTemplate !== '' ? kindMessageTemplate : settings.messageTemplate, '{message}', vars)
  const secondsWanted = Math.round(clamp(num(args.seconds, settings.seconds), 2, 600))
  // 0.17：单卡最长停留（maxHoldSeconds>0 时再压一道），避免 decide 卡一直挂在屏幕上。
  const seconds =
    settings.maxHoldSeconds > 0 ? Math.min(secondsWanted, settings.maxHoldSeconds) : secondsWanted
  // 0.18：托盘里点了「静音」就不再响铃（卡片照常弹）。
  const trayState = readTrayState(settings)
  const sound = args.sound === false ? false : settings.sound && trayState.muted !== true
  const audio = audioNameOf(kind, settings)
  const speak = str(args.speak, settings.speakEnabled ? message : '')

  if (settings.cardsEnabled === false) {
    return {
      ok: true,
      skipped: 'cards-off',
      kind,
      title,
      message,
      seconds,
      position: settings.position,
      sound: false,
      detail: '配置里关掉了「弹出窗口」，这张卡没有弹',
    }
  }

  if (settings.hostMode === 'exe') {
    const dir = clientDirOf(settings)
    const exePath = path.join(dir, EXE_NAME)
    if (!fs.existsSync(exePath)) {
      return {
        ok: false,
        error: 'client-not-found',
        detail: `找不到提醒宿主：${exePath}（hostMode=exe 时检查 clientDir，或改回 hostMode=script 用包内脚本宿主）`,
      }
    }
    const argv = ['--title', title, '--msg', message, '--seconds', String(seconds), '--pos', settings.position]
    if (sound && audio !== '') argv.push('--audio', audio)
    else if (!sound) argv.push('--no-sound')
    try {
      const { pid, exited } = await launch(exePath, argv, dir)
      const early = await Promise.race([exited, new Promise((r) => setTimeout(() => r('running'), 300))])
      return {
        ok: true,
        hostMode: 'exe',
        kind,
        title,
        message,
        seconds,
        position: settings.position,
        sound: sound && audio !== '',
        audio: sound ? audio : null,
        pid,
        host: exePath,
        earlyExit: early === 'running' ? null : early,
      }
    } catch (error) {
      return { ok: false, error: 'spawn-failed', detail: String(error && error.message ? error.message : error) }
    }
  }

  // 默认：脚本宿主。音频传绝对路径（脚本宿主直接读文件，不像 exe 那样按自身目录解析）。
  const scriptPath = path.resolve(settings.scriptPath)
  if (!fs.existsSync(scriptPath)) {
    return {
      ok: false,
      error: 'host-script-not-found',
      detail: `找不到提醒脚本宿主：${scriptPath}（重新安装插件可恢复包内 host/ReminderHost.ps1）`,
    }
  }
  const audioDir = path.resolve(settings.audioDir)
  let audioPath = sound && audio !== '' ? path.join(audioDir, audio) : ''
  let audioMissing
  if (audioPath !== '' && !fs.existsSync(audioPath)) {
    // 音频缺失不该让提醒消失：退回静音，正文照常弹。
    audioMissing = audioPath
    audioPath = ''
  }

  // 免打扰：decide 是「要人来拍板」的，任何时段都不能吞；其余档位按 quietMode 处理。
  const quiet = kind !== 'decide' && (inQuietHours(settings) || trayState.quiet === true)
  const extras = appearanceOf(kind, settings)

  // 自检 / 调参用：只把将要传给宿主的参数算出来，不落任何进程、不写历史。
  if (settings.dryRun) {
    return {
      ok: true,
      hostMode: 'script',
      dryRun: true,
      kind,
      title,
      message,
      seconds,
      position: settings.position,
      sound: sound && audioPath !== '',
      audio: sound && audioPath !== '' ? audioPath : null,
      audioMissing: audioMissing !== '' && audioMissing !== undefined ? audioMissing : undefined,
      speak: speak !== '' ? speak : null,
      background: extras.background !== '' ? extras.background : null,
      icon: extras.icon !== '' ? extras.icon : null,
      quiet,
    }
  }

  if (quiet && settings.quietMode === 'skip') {
    appendHistory(settings, {
      at: Date.now(),
      kind,
      title,
      message,
      action: 'quiet-skip',
      count: 1,
      snoozed: false,
      quiet: true,
    })
    return {
      ok: true,
      hostMode: 'script',
      kind,
      title,
      message,
      skipped: 'quiet',
      quietRange: `${settings.quietStart}-${settings.quietEnd}`,
    }
  }
  const holdUntil = quiet ? quietEndAt(settings) : 0

  const dueAt = dueAtOf(args)
  const openUrl = str(args.url, '')
  const item = {
    kind,
    title,
    message,
    seconds,
    url: openUrl,
    buttons: Array.isArray(args.buttons) ? args.buttons.slice(0, 3) : undefined,
    options: normalizeChoices(args.options),
    dueAt,
    priority: priorityOf(kind),
    sound: sound && audioPath !== '',
    audioPath,
    audioMissing,
    speak,
    settings,
    createdAt: Date.now(),
    count: 1,
    snoozed: false,
    quiet,
    holdUntil,
  }
  const placement = enqueue(item)
  emitServiceEvent('notified', {
    kind,
    title,
    queued: placement.queued === true || placement.merged === true,
    scheduledAt: dueAt > 0 ? new Date(dueAt).toISOString() : '',
  })
  return {
    ok: true,
    hostMode: 'script',
    kind,
    title,
    message,
    seconds,
    position: settings.position,
    sound: sound && audioPath !== '',
    audio: sound && audioPath !== '' ? audioPath : null,
    audioMissing: audioMissing !== '' && audioMissing !== undefined ? audioMissing : undefined,
    speak: speak !== '' ? speak : null,
    background: extras.background !== '' ? extras.background : null,
    icon: extras.icon !== '' ? extras.icon : null,
    queued: placement.queued === true || placement.merged === true,
    merged: placement.merged === true ? true : undefined,
    position_in_queue: placement.position,
    count: placement.count,
    quiet: quiet || undefined,
    holdUntil: holdUntil > 0 ? new Date(holdUntil).toISOString() : undefined,
    url: openUrl !== '' ? openUrl : undefined,
    scheduledAt: dueAt > 0 ? new Date(dueAt).toISOString() : undefined,
  }
}

const parameters = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: KINDS,
      description:
        "提醒档位：done = 一轮工作做完的收尾提醒（默认）；decide = 需要用户拍板/同意之前的提醒；raw = 自定标题与正文的通用提醒。",
    },
    message: { type: 'string', description: '弹窗正文。不传时按档位使用默认正文（done / decide 有默认文案）。' },
    title: { type: 'string', description: '弹窗标题。不传时按档位使用默认标题。' },
    seconds: { type: 'number', description: '弹窗停留秒数，2–600。不传用插件 Config 的 seconds（默认 60）。' },
    sound: { type: 'boolean', description: '本次是否播放提示音。不传用插件 Config 的 sound（默认开）。' },
    speak: {
      type: 'string',
      description:
        '用系统语音念出来的句子（不弹窗也能念）。不传时：插件里开了「语音朗读」就念正文，否则不念。',
    },
    url: {
      type: 'string',
      description: '卡片上带一个「打开链接」按钮，点了会用默认浏览器打开这个地址（https 开头）。',
    },
    at: {
      type: 'string',
      description:
        '定时提醒：HH:MM（24 小时制）。到点才弹；今天这个时间已经过了就排到明天，最多等到 24 小时内。',
    },
    inMinutes: {
      type: 'number',
      description: '定时提醒：多少分钟之后弹（1–10080）。和 at 同时给时以 inMinutes 为准。',
    },
    every: {
      type: 'string',
      description:
        '周期提醒：「30m」「2h」「1d」（最短 1 分钟、最长 7 天）。第一次在 now+every 之后弹，之后按这个间隔重复；配合 times 限制次数，与 at / inMinutes 互斥。',
    },
    times: {
      type: 'number',
      description: '周期提醒最多响几次；0 或不传表示一直重复。可用 /dsh-reminder-notify/recurring 查询或取消。',
    },
    buttons: {
      type: 'array',
      description:
        '这张卡上的自定义按钮（最多 3 个），每项 { label, url }；留空用插件配置里的全局按钮。带 url 的点开链接，不带 url 的只记一次点击。',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: '按钮上的字，最多 8 个字' },
          url: { type: 'string', description: '点了要打开的地址，可留空' },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
    options: {
      type: 'array',
      description:
        '决定卡上的候选按钮（2–4 个，每个最多 12 个字）。用户点了哪一个，就会记进历史并出现在你下一步的上下文里。只对 kind=decide 有意义。',
      items: { type: 'string' },
    },
  },
}

function toolDefinition(getSettings, ctx) {
  return {
    name: 'notify_user',
    description:
      "Pop a native desktop reminder (voice + toast, bottom-right, auto-dismiss, never steals focus) on the user's Windows screen, then return immediately. " +
      'It renders the card with the system PowerShell + WinForms host shipped in this plugin, so nothing is downloaded and no unsigned exe is involved. ' +
      'Use kind="done" when a piece of work is finished and handed off, and kind="decide" before asking the user to approve or choose something. ' +
      'Cards carry 「知道了 / 稍后提醒」 buttons; extra cards queue instead of stacking, and every reminder lands in the local history. ' +
      'This replaces running 发送提醒.ps1 -Voice 完成/决定 by hand: do not spawn a reminder host yourself, and do not call this in a loop.',
    parameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    },
    async execute(args) {
      const settings = getSettings()
      const kind = KINDS.includes(args && args.kind) ? args.kind : 'done'
      const cooldownMs = settings.cooldownMs
      const now = Date.now()
      if (cooldownMs > 0) {
        const last = lastFiredAt.get(kind) ?? 0
        if (now - last < cooldownMs) {
          return JSON.stringify({ ok: true, kind, skipped: 'cooldown', cooldownMs })
        }
      }
      const result = await notify(kind, args && typeof args === 'object' ? args : {}, settings)
      if (result.ok) lastFiredAt.set(kind, now)
      // 手机推送是「顺带」而不是主路径：失败不影响本次工具调用，也不等它。
      if (result.ok && kind === 'decide' && settings.pushEnabled && settings.pushDecide && settings.dryRun !== true) {
        pushOut(settings, str(result.title, '需要你来决定'), str(result.message, ''), { kind }).catch(() => {})
      }
      return JSON.stringify(result)
    },
  }
}

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.aac', '.wma']
const AUDIO_ROUTE = '/dsh-reminder-notify/audio'
const CONFIG_ROUTE = '/dsh-reminder-notify/config'
const PREVIEW_ROUTE = '/dsh-reminder-notify/preview'
const BALANCE_ROUTE = '/dsh-reminder-notify/balance'
const HISTORY_ROUTE = '/dsh-reminder-notify/history'
const REPLIES_ROUTE = '/dsh-reminder-notify/replies'
const MOBILE_ROUTE = '/dsh-reminder-notify/mobile'

// 0.23:手机回话可以带附件（图片/语音）。文件落在本机用户目录下，不进公网。
const MOBILE_UPLOAD_LIMIT = 12 * 1024 * 1024
const MOBILE_ATTACH_KINDS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
}

export function mobileUploadDir() {
  return path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'uploads')
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

export function uploadNameFor(type, now = new Date()) {
  const ext = MOBILE_ATTACH_KINDS[String(type ?? '').toLowerCase()]
  if (ext === undefined) return null
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`
}


// 0.25：手机页的可选 https 入口。局域网是 http 时浏览器不给麦克风、也不给真 PWA，
// 所以在本地起一个自签证书的 https 反向代理，只放行手机页相关路径。
function warn(text) { try { console.warn(text) } catch {} }
function info(text) { try { console.log(text) } catch {} }

export function httpsPfxPathOf(settings) {
  const custom = str(settings.httpsPfx, '')
  if (custom !== '') return custom
  return path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'mobile.pfx')
}

export function mobileProxyPathOk(pathname) {
  const target = str(pathname, '')
  return target === MOBILE_ROUTE || target.startsWith(`${MOBILE_ROUTE}/`)
}

export function httpsLinkOf(settings, host, lan = null) {
  const port = clamp(num(settings.httpsPort, 1319), 1024, 65535)
  const address = lan && lan.address ? lan.address : lanAddressOf()?.address ?? '127.0.0.1'
  const token = str(settings.mobileToken, '')
  return `https://${address}:${port}${MOBILE_ROUTE}?t=${encodeURIComponent(token)}`
}

let httpsWarned = false

export function startHttpsProxy(ctx, getSettings) {
  const settings = getSettings()
  if (settings.httpsEnabled !== true) return null
  const pfxPath = httpsPfxPathOf(settings)
  if (!fs.existsSync(pfxPath)) {
    if (!httpsWarned) {
      httpsWarned = true
      warn(`mobile https: 证书不存在（${pfxPath}），先跑 scripts/make-cert.ps1`)
    }
    return null
  }
  const web = ctx.get('webServer')
  const origin = typeof web?.getOrigin === 'function' ? String(web.getOrigin()) : ''
  if (!/^http:\/\//.test(origin)) {
    warn('mobile https: 拿不到 web 端口，先不启动')
    return null
  }
  const target = new URL(origin)
  let server = null
  try {
    server = https.createServer(
      { pfx: fs.readFileSync(pfxPath), passphrase: 'dsh-reminder' },
      (req, res) => {
        const pathname = String(req.url ?? '/').split('?')[0]
        if (!mobileProxyPathOk(pathname)) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('only the mobile page is exposed here')
          return
        }
        const upstream = http.request({ host: target.hostname, port: Number(target.port || 80), path: req.url ?? '/', method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res)
        })
        upstream.on('error', () => {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('upstream error')
        })
        req.pipe(upstream)
      },
    )
    server.on('error', (error) => {
      warn(`mobile https: 起不来（${error && error.message}）`)
    })
    server.listen(settings.httpsPort, () => {
      info(`mobile https: https://0.0.0.0:${settings.httpsPort}${MOBILE_ROUTE}（自签证书）`)
    })
    if (server.unref) server.unref()
    return server
  } catch (error) {
    warn(`mobile https: 初始化失败（${error && error.message}）`)
    return null
  }
}

export function attachmentSummaryOf(entry) {
  const list = Array.isArray(entry?.attachments) ? entry.attachments : []
  if (list.length === 0) return ''
  const names = list.map((item) => str(item?.name, 'file'))
  return `（附 ${list.length} 个：${names.join('、')}）`
}

export function mobileAttachmentsOf(raw, dir = mobileUploadDir()) {
  if (!Array.isArray(raw)) return []
  const root = path.resolve(dir)
  const out = []
  for (const item of raw.slice(0, 3)) {
    const file = str(item?.file, '')
    if (file === '') continue
    const resolved = path.resolve(file)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue
    let size = num(item?.size, 0)
    try {
      if (size <= 0) size = fs.statSync(resolved).size
    } catch {
      continue
    }
    out.push({
      name: str(item?.name, path.basename(resolved)).slice(0, 120),
      file: resolved,
      type: str(item?.type, ''),
      size: Math.max(0, Math.round(size)),
    })
  }
  return out
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
const EXPORT_ROUTE = '/dsh-reminder-notify/export'
const DIGEST_ROUTE = '/dsh-reminder-notify/digest'
const RECUR_ROUTE = '/dsh-reminder-notify/recurring'

// 面板要「把音频目录里的文件列成下拉」，但 Client 侧没有任何读文件能力，
// 所以由 Host 注册一条只读的 GET 路由，页面用同源 fetch 取这个 JSON。
export function listAudioFiles(dir) {
  const files = []
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    return { dir, files, error: String((error && error.message) || error) }
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (AUDIO_EXTENSIONS.includes(ext)) files.push(entry.name)
  }
  files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  return { dir, files }
}

function registerAudioRoute(ctx, getSettings) {
  const route = {
    kind: 'exact',
    path: AUDIO_ROUTE,
    handler: (req, res) => {
      const settings = getSettings()
      const requested = (() => {
        try {
          const url = new URL(req.url ?? AUDIO_ROUTE, 'http://127.0.0.1')
          return url.searchParams.get('dir') ?? ''
        } catch {
          return ''
        }
      })()
      const dir = requested !== '' ? path.resolve(requested) : settings.audioDir
      const body = JSON.stringify(listAudioFiles(dir))
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(body)
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: audio list route')
}

// 试听：只按档位放一遍提示音，不弹卡。面板拿不到本地音频文件，所以由宿主代播。
export async function previewAudio(kind, settings) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'only-windows', detail: '试听只能在 Windows 上播放' }
  }
  const audio = audioNameOf(kind, settings)
  if (audio === '') {
    return { ok: false, error: 'no-audio', detail: '这个档位没有配置提示音（留空 = 静音）' }
  }
  const audioPath = path.join(path.resolve(settings.audioDir), audio)
  if (!fs.existsSync(audioPath)) {
    return { ok: false, error: 'audio-not-found', detail: `找不到音频文件：${audioPath}` }
  }
  const scriptPath = path.resolve(settings.scriptPath)
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: 'host-script-not-found', detail: `找不到提醒脚本宿主：${scriptPath}` }
  }
  const argv = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Preview',
    '-Audio',
    audioPath,
  ]
  try {
    const { pid, exited } = await launch(settings.powershellPath, argv, PACKAGE_ROOT)
    const early = await Promise.race([exited, new Promise((r) => setTimeout(() => r('running'), 900))])
    return { ok: true, kind, audio: audioPath, pid, earlyExit: early === 'running' ? null : early }
  } catch (error) {
    return { ok: false, error: 'spawn-failed', detail: String((error && error.message) || error) }
  }
}

function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function registerConfigRoute(ctx, getSettings) {
  const editable = new Set(Object.keys(settingsOf({})))
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: CONFIG_ROUTE,
    handler: async (req, res) => {
      try {
        if ((req.method ?? 'GET').toUpperCase() === 'GET') {
          return reply(res, 200, { ok: true, writable: true, values: getSettings() })
        }
        const body = await readJsonBody(req)
        const patch = body !== null && typeof body === 'object' && body.values !== null && typeof body.values === 'object'
          ? body.values
          : body
        const entry = ctx.fiber?.entry
        const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
        if (entry === undefined || editor === undefined || typeof editor.edit !== 'function') {
          return reply(res, 409, { ok: false, error: 'configuration cannot be saved in this profile' })
        }
        const changes = {}
        for (const [key, value] of Object.entries(patch ?? {})) {
          if (editable.has(key)) changes[key] = value
        }
        if (Object.keys(changes).length === 0) {
          return reply(res, 400, { ok: false, error: 'no editable field in the request' })
        }
        await editor.edit(entry, (current) => ({ ...current, ...changes }))
        return reply(res, 200, { ok: true, writable: true, values: getSettings() })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: settings route')
}

function registerPreviewRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: PREVIEW_ROUTE,
    handler: async (req, res) => {
      try {
        if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
          return reply(res, 405, { ok: false, error: 'use POST' })
        }
        const body = await readJsonBody(req)
        const kind = str(body?.kind, 'done')
        if (!['done', 'decide', 'raw'].includes(kind)) {
          return reply(res, 400, { ok: false, error: `unknown kind: ${kind}` })
        }
        // 面板上的「试试看」：mode=card 时真的弹一张样卡，比只播提示音更能说明效果。
        if (str(body?.mode, 'audio') === 'card') {
          const settings = getSettings()
          const sample = {
            done: '这是一张「完成」卡：任务做完时这样弹，带提示音、按钮，到点自己消失。',
            decide: '这是一张「需要你决定」卡：等你拍板时这样弹。',
            raw: '这是一张通用提醒卡，标题和正文都由调用方给。',
          }[kind]
          const card = await notify(
            kind,
            { message: sample, seconds: Math.min(num(settings.seconds, 60), 20) },
            { ...settings, quietEnabled: false, cardsEnabled: true },
          )
          return reply(res, 200, { ok: true, mode: 'card', kind, card })
        }
        const result = await previewAudio(kind, getSettings())
        if (result.ok) return reply(res, 200, result)
        const status = result.error === 'no-audio' || result.error === 'audio-not-found' ? 400 : 500
        return reply(res, status, result)
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: preview route')
}

// ——— DeepSeek 余额提醒 ——————————————————————————————————————————————
//
// 数据来自宿主账号服务 deepseekAccount.getBalance()：返回的是钱包余额
// （AccountWallet = { currency, balance: string }），走本机已登录的 DSH 账号，
// 不需要用户另外填 API key。
//
// 「剩 20%」得有个分母：分母就是「基线」——最近一次充值后的余额。插件自己维护它：
// 余额比基线还高（说明刚充过值）就把基线抬到当前余额，并清空已报阈值；
// 余额跌到 基线×阈值% 以下就报一次，报过的阈值不再重复报。
//
// 基线口径（0.10.1 起）：
//   - 只算「充值钱包」（AccountWallet.value），赠送金（bonusWallets）不参与，
//     否则赠送金到期清零会让总余额断崖式下跌，触发假警报；
//   - 基线连带记录账号 id 与设定时间：换账号自动重来，刚抬升的 30 分钟内不播报，
//     避免「充值入账 → 服务端冲正」这类抖动误报；
//   - 播报前会立刻再读一次余额做确认（连续两次采样都在阈值以下才响）。
const balanceState = { balance: null, bonus: null, currency: 'CNY', at: 0, pct: null, error: null }
const BALANCE_COOLDOWN_MS = 30 * 60 * 1000

export function parseThresholds(text) {
  const list = String(text ?? '')
    .split(/[,，\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100)
  const unique = [...new Set(list)].sort((a, b) => b - a)
  return unique.length > 0 ? unique : [20, 10, 5]
}

// 从账号服务读余额；返回 { balance, bonus, currency, accountId } 或 { error }。
// balance 只算充值钱包；bonus 是赠送钱包（只展示，不参与百分比）。
async function readAccountBalance(ctx) {
  const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined
  if (account === undefined || account === null || typeof account.getBalance !== 'function') {
    return { error: 'account-unavailable' }
  }
  const meta = {
    version: '0.10.1',
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
  const result = await account.getBalance(meta)
  if (result === null || result === undefined) return { error: 'signed-out' }
  if (result.status !== 'ready') return { error: 'balance-unavailable' }
  const sumOf = (wallets) =>
    Math.round(
      (wallets ?? [])
        .filter((wallet) => wallet && wallet.currency === 'CNY')
        .reduce((sum, wallet) => sum + num(wallet.balance, 0), 0) * 100,
    ) / 100
  const rechargeWallets = (result.value ?? []).filter((wallet) => wallet && wallet.currency === 'CNY')
  if (rechargeWallets.length === 0) return { error: 'no-cny-wallet' }
  const balance = sumOf(result.value)
  const bonus = sumOf(result.bonusWallets)
  // 账号身份：用来判断「是不是换号了」，读不到就留空（不影响余额判断）。
  let accountId = ''
  if (typeof account.getProfile === 'function') {
    try {
      const profile = await account.getProfile(meta)
      if (profile !== null && profile !== undefined && profile.status === 'ready' && profile.value) {
        accountId = String(profile.value.id ?? '')
      }
    } catch {
      accountId = ''
    }
  }
  return { balance, bonus, currency: 'CNY', accountId }
}

// 写回状态（基线和已报阈值）：都是 volatile 字段，写完立刻生效，不会重启插件。
// 0.31.1：写回成功的内部状态（digestLastDate / 余额基线 / 条件状态）要立刻被 getSettings() 看到，
// 否则同一个 config 对象不会变，日报会每分钟判定「今天还没发」而连弹。
const runtimePatch = {}

async function saveBalanceState(ctx, patch) {
  const entry = ctx.fiber?.entry
  const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
  if (entry === undefined || editor === undefined || typeof editor.edit !== 'function') return false
  try {
    await editor.edit(entry, (current) => ({ ...current, ...patch }))
    Object.assign(runtimePatch, patch)
    return true
  } catch {
    return false
  }
}

// 查一次余额，必要时弹卡；force=true 时忽略冷却也会回报状态（供面板显示）。
export async function checkBalance(ctx, getSettings, { force = false } = {}) {
  const settings = getSettings()
  const read = await readAccountBalance(ctx)
  if (read.error !== undefined) {
    // 读不到（没登录 / 接口失败）时保留上次快照，绝不当成 0，避免「余额只剩 0 元」的误报。
    balanceState.error = read.error
    balanceState.at = Date.now()
    return { ok: false, error: read.error, enabled: settings.balanceEnabled }
  }
  const balance = read.balance
  const thresholds = parseThresholds(settings.balanceThresholds)
  const now = Date.now()
  const patch = {}
  let baseline = settings.balanceBaseline
  let fired = settings.balanceFired
  let baselineAt = settings.balanceBaselineAt
  let baselineAccount = settings.balanceBaselineAccount
  let baselineSource = settings.balanceBaselineSource

  // 换账号 → 旧基线作废（A 账号的 100 元基线套到 B 账号的 5 元上会立刻误报）。
  if (read.accountId !== '' && baselineAccount !== '' && read.accountId !== baselineAccount) {
    baseline = 0
    baselineAt = 0
    patch.balanceBaselineAt = 0
    if (fired !== 0) {
      fired = 0
      patch.balanceFired = 0
    }
  }

  // 充值（余额高于基线）或首次运行 → 基线抬到当前余额，并清空已报阈值。
  if (baseline <= 0 || balance > baseline) {
    baseline = balance
    baselineAt = now
    baselineSource = 'auto'
    baselineAccount = read.accountId || baselineAccount
    patch.balanceBaseline = baseline
    patch.balanceBaselineAt = baselineAt
    patch.balanceBaselineAccount = baselineAccount
    patch.balanceBaselineSource = baselineSource
    if (fired !== 0) {
      fired = 0
      patch.balanceFired = 0
    }
  }

  const pct = baseline > 0 ? (balance / baseline) * 100 : 100
  balanceState.balance = balance
  balanceState.bonus = read.bonus
  balanceState.currency = read.currency
  balanceState.pct = Math.round(pct * 10) / 10
  balanceState.at = now
  balanceState.error = null

  // 余额回到最高阈值以上 → 重新待命（下次跌破可以再报）。
  const highest = thresholds[0]
  if (pct > highest && fired !== 0) {
    fired = 0
    patch.balanceFired = 0
  }

  let firedNow = 0
  const cooling = baselineAt > 0 && now - baselineAt < BALANCE_COOLDOWN_MS
  if (settings.balanceEnabled && (!cooling || force)) {
    // 只报「新跨过的最深一档」：20 → 10 → 5 各报一次，不会一次堆三张卡。
    const crossed = thresholds.find((t) => pct <= t && t < fired) ?? thresholds.find((t) => pct <= t && fired === 0)
    if (crossed !== undefined && crossed > 0) {
      // 连续两次采样确认：立刻再读一次，两次都在阈值以下才播报。
      const confirm = await readAccountBalance(ctx)
      const confirmPct =
        confirm.error === undefined && baseline > 0 ? (confirm.balance / baseline) * 100 : null
      const confirmed = confirmPct !== null && confirmPct <= crossed
      if (confirmed) {
        firedNow = crossed
        fired = crossed
        patch.balanceFired = crossed
        const message = `DeepSeek 余额只剩 ¥${balance.toFixed(2)}（约基线的 ${Math.round(pct)}%，已低于 ${crossed}%）`
        const speak = settings.balanceSpeak ? `余额还剩 ${balance.toFixed(2)} 元，已经不足百分之 ${crossed}` : ''
        try {
          await notify('raw', { title: 'DeepSeek 余额不足', message, seconds: 20, speak }, settings)
        } catch {
          // 提醒失败不影响余额检查本身
        }
      }
    }
  }
  if (Object.keys(patch).length > 0) await saveBalanceState(ctx, patch)
  return {
    ok: true,
    enabled: settings.balanceEnabled,
    balance,
    bonus: read.bonus,
    currency: read.currency,
    baseline,
    baselineAt,
    baselineSource,
    cooling,
    pct: balanceState.pct,
    thresholds,
    fired,
    firedNow: firedNow > 0 ? firedNow : null,
    forced: force,
  }
}

function registerBalanceRoute(ctx, getSettings, config) {
  const replyOf = (res) => (status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const settingsNow = () => getSettings()
  const snapshot = () => ({
    ok: balanceState.error === null,
    enabled: settingsNow().balanceEnabled,
    balance: balanceState.balance,
    bonus: balanceState.bonus,
    currency: balanceState.currency,
    baseline: settingsNow().balanceBaseline,
    baselineAt: settingsNow().balanceBaselineAt,
    baselineSource: settingsNow().balanceBaselineSource,
    pct: balanceState.pct,
    at: balanceState.at,
    error: balanceState.error,
  })
  {
    const route = {
      kind: 'exact',
      path: BALANCE_ROUTE,
      handler: async (req, res) => {
        const reply = replyOf(res)
        try {
          const method = (req.method ?? 'GET').toUpperCase()
          if (method === 'GET') return reply(200, snapshot())
          if (method !== 'POST') return reply(405, { ok: false, error: 'use GET or POST' })
          const body = await readJsonBody(req)
          if (body !== null && typeof body === 'object' && body.mode === 'reset') {
            // 「把当前余额设为基线」：读一次当前余额，直接写成人设定的基线。
            const entry = ctx.fiber?.entry
            const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
            const read = await readAccountBalance(ctx)
            if (entry === undefined || editor?.edit === undefined) {
              return reply(409, { ok: false, error: 'configuration cannot be saved in this profile' })
            }
            if (read.error !== undefined) return reply(400, { ok: false, error: read.error })
            const now = Date.now()
            await editor.edit(entry, (current) => ({
              ...current,
              balanceBaseline: read.balance,
              balanceBaselineAt: now,
              balanceBaselineAccount: read.accountId || '',
              balanceBaselineSource: 'manual',
              balanceFired: 0,
            }))
            balanceState.balance = read.balance
            balanceState.bonus = read.bonus
            balanceState.pct = 100
            balanceState.error = null
            balanceState.at = now
            return reply(200, { ...snapshot(), reset: true, baseline: read.balance })
          }
          const result = await checkBalance(ctx, getSettings, { force: true })
          return reply(200, result)
        } catch (error) {
          return reply(500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }
    mountRoute(ctx, route, 'dsh-reminder-notify: balance route')
  }

  // 自动检查：每 60 秒醒一次，按 balanceCheckMinutes 的间隔真正查一次。
  // config 是 volatile，改完立刻生效，所以这里每次都用 getSettings() 现读。
  // 这里用全局定时器而不是 ctx.setInterval —— 后者要求插件 inject 'timer'，
  // 而本插件故意保持「只 inject tools」的低依赖，卸载时靠 ctx.effect 收尾。
  let lastCheck = 0
  const timer = setInterval(() => {
    const settings = getSettings()
    if (!settings.balanceEnabled) return
    const gap = Math.max(1, settings.balanceCheckMinutes) * 60 * 1000
    if (Date.now() - lastCheck < gap) return
    lastCheck = Date.now()
    checkBalance(ctx, getSettings).catch(() => {})
  }, 60 * 1000)
  if (typeof timer?.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'dsh-reminder-notify: balance watcher')
  void config
}

// ——— 提醒历史 ————————————————————————————————————————————————————
//
// 存在本地 JSON（默认 <用户目录>/.dsh/dsh-reminder-notify/history.json），
// 面板只读这条路由，不直接读文件 —— Client 侧没有任何文件访问能力。
export function historyStats(entries) {
  const byKind = { done: 0, decide: 0, raw: 0 }
  const byAction = {}
  const dayKey = (ms) => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const buckets = new Map()
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    buckets.set(dayKey(d.getTime()), 0)
  }
  // 0.17：再给一份 30 天桶，面板画趋势图用（前 7 天与上面完全一致）。
  const monthBuckets = new Map()
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    monthBuckets.set(dayKey(d.getTime()), 0)
  }
  const today = dayKey(Date.now())
  let todayCount = 0
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const kind = String(entry.kind ?? '')
    if (byKind[kind] !== undefined) byKind[kind] += 1
    const action = String(entry.action ?? 'unknown')
    byAction[action] = (byAction[action] ?? 0) + 1
    const key = dayKey(num(entry.at, 0))
    if (key === today) todayCount += 1
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1)
    if (monthBuckets.has(key)) monthBuckets.set(key, monthBuckets.get(key) + 1)
  }
  return {
    total: entries.length,
    today: todayCount,
    byKind,
    byAction,
    last7: [...buckets.entries()].map(([date, count]) => ({ date, count })),
    last30: [...monthBuckets.entries()].map(([date, count]) => ({ date, count })),
  }
}

// ——— 日报与手机推送 ——————————————————————————————————————————————
//
// 手机推送没有可用的宿主服务（服务目录里没有 im / chat / notification），
// 所以就按「用户自己提供一个 webhook」来做：企业微信群机器人、Server 酱、
// 通用 JSON、纯文本四种格式，都是 POST 一个 URL，不需要账号体系。
function dayKeyOf(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayKey(now = new Date()) {
  return dayKeyOf(now.getTime())
}

// 0.31：日报去重看历史，不只看 volatile 的 digestLastDate——
// 重装或恢复配置会把 digestLastDate 清空，历史里今天已经有同名日报就不再弹。
export function digestShownToday(settings, entries, now = new Date()) {
  const title = str(settings.digestTitle, '今日提醒日报')
  const today = dayKeyOf(now.getTime())
  return (Array.isArray(entries) ? entries : []).some(
    (e) => dayKeyOf(num(e?.at, 0)) === today && str(e?.title, '') === title,
  )
}

export function digestDue(settings, now = new Date()) {
  if (settings.digestEnabled !== true) return false
  const at = parseClock(settings.digestTime)
  if (at === null) return false
  if (settings.digestLastDate === todayKey(now)) return false
  return now.getHours() * 60 + now.getMinutes() >= at
}

export function digestMessage(settings, entries, balance) {
  const today = todayKey()
  const rows = (Array.isArray(entries) ? entries : []).filter((e) => dayKeyOf(num(e?.at, 0)) === today)
  const byKind = (k) => rows.filter((e) => e.kind === k).length
  const byAction = (a) => rows.filter((e) => e.action === a).length
  const lines = []
  if (rows.length === 0) {
    lines.push('今天还没有弹过提醒。')
  } else {
    lines.push(`今天共 ${rows.length} 条提醒：完成 ${byKind('done')}、需要你决定 ${byKind('decide')}、普通 ${byKind('raw')}。`)
    const how = []
    if (byAction('timeout') > 0) how.push(`自动关闭 ${byAction('timeout')}`)
    if (byAction('ok') > 0) how.push(`点知道了 ${byAction('ok')}`)
    if (byAction('snooze') > 0) how.push(`稍后提醒 ${byAction('snooze')}`)
    if (byAction('dismiss') > 0) how.push(`点掉了 ${byAction('dismiss')}`)
    if (byAction('quiet-skip') > 0) how.push(`免打扰跳过 ${byAction('quiet-skip')}`)
    if (how.length > 0) lines.push(`处理方式：${how.join('、')}。`)
  }
  const value = num(balance?.balance, NaN)
  if (Number.isFinite(value)) {
    const base = num(settings.balanceBaseline, 0)
    lines.push(base > 0 ? `DeepSeek 余额 ¥${value.toFixed(2)}（基线 ¥${base.toFixed(2)}）` : `DeepSeek 余额 ¥${value.toFixed(2)}`)
  }
  return lines.join('\n')
}

export function pushPayload(settings, title, message, extra = {}) {
  const body = String(message ?? '')
  const json = { 'content-type': 'application/json' }
  if (settings.pushFormat === 'serverchan') {
    return { headers: json, body: JSON.stringify({ title, desp: body }) }
  }
  if (settings.pushFormat === 'text') {
    return { headers: { 'content-type': 'text/plain; charset=utf-8' }, body: `${title}\n${body}` }
  }
  if (settings.pushFormat === 'telegram') {
    return {
      headers: json,
      body: JSON.stringify({ chat_id: str(settings.pushChat, ''), text: `${title}\n${body}` }),
    }
  }
  if (settings.pushFormat === 'feishu') {
    return { headers: json, body: JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${body}` } }) }
  }
  if (settings.pushFormat === 'dingtalk') {
    return {
      headers: json,
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${body}` } }),
    }
  }
  if (settings.pushFormat === 'wecom') {
    return { headers: json, body: JSON.stringify({ msgtype: 'text', text: { content: `${title}\n${body}` } }) }
  }
  return { headers: json, body: JSON.stringify({ title, message: body, kind: extra.kind ?? 'raw', time: new Date().toISOString() }) }
}

export async function pushOut(settings, title, message, extra = {}) {
  if (settings.pushEnabled !== true) return { ok: false, error: 'push-disabled' }
  const url = str(settings.pushUrl, '')
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'push-url-invalid' }
  const payload = pushPayload(settings, title, message, extra)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: payload.headers,
      body: payload.body,
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8000) : undefined,
    })
    const text = await response.text().catch(() => '')
    let parsed = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      parsed = null
    }
    // 企业微信/Server 酱都是 HTTP 200 + 报文里的错误码：
    // 只看 response.ok 会把「webhook 地址不对」当成发送成功。
    const code = parsed && typeof parsed === 'object' ? parsed.errcode ?? parsed.code : undefined
    if (code !== undefined && code !== null && Number(code) !== 0) {
      const reason = String(parsed.errmsg ?? parsed.message ?? code)
      return { ok: false, status: response.status, error: 'webhook-rejected', reason, body: text.slice(0, 200) }
    }
    return { ok: response.ok, status: response.status, body: text.slice(0, 200) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

export async function runDigest(ctx, getSettings, { force = false } = {}) {
  const settings = getSettings()
  if (!force && settings.digestEnabled !== true) return { ok: false, error: 'digest-disabled' }
  const entries = readHistory(settings)
  let balance = null
  if (settings.digestIncludeBalance) {
    const read = await readAccountBalance(ctx).catch(() => null)
    if (read && read.balance !== undefined) balance = read
  }
  const title = str(settings.digestTitle, '今日提醒日报')
  const message = digestMessage(settings, entries, balance)
  const card = await notify('raw', { title, message, seconds: Math.max(20, settings.seconds) }, settings)
  let push = null
  if (settings.pushEnabled && settings.pushDigest && settings.dryRun !== true) {
    push = await pushOut(settings, title, message, { kind: 'digest' })
  }
  if (!force) await saveBalanceState(ctx, { digestLastDate: todayKey() })
  return { ok: true, title, message, card, push }
}

function registerDigestLoop(ctx, getSettings) {
  let running = false
  const tick = async () => {
    if (running) return
    const settings = getSettings()
    if (settings.digestEnabled !== true && settings.digestAlertCount <= 0) return
    running = true
    try {
      const now = new Date()
      if (digestDue(settings, now)) {
        const entries = readHistory(settings)
        const todayCount = entries.filter((e) => dayKeyOf(num(e?.at, 0)) === dayKeyOf(now.getTime())).length
        if (digestShownToday(settings, entries, now)) {
          // 已经发过（只是状态被重置了），补写状态，不再弹。
          await saveBalanceState(ctx, { digestLastDate: todayKey(now) }).catch(() => {})
        } else if (todayCount === 0) {
          // 今天一条提醒都没有，日报没有意义，静默跳过。
          await saveBalanceState(ctx, { digestLastDate: todayKey(now) }).catch(() => {})
        } else {
          await runDigest(ctx, getSettings).catch(() => {})
        }
      }
      if (settings.digestAlertCount > 0) {
        const today = todayKey(now)
        if (settings.digestAlertDate !== today) {
          const entries = readHistory(settings)
          const count = entries.filter((e) => dayKeyOf(num(e?.at, 0)) === today).length
          if (count >= settings.digestAlertCount) {
            await saveBalanceState(ctx, { digestAlertDate: today })
            await notify(
              'raw',
              { title: '提醒有点多', message: `今天已经弹了 ${count} 条提醒，超过你设的 ${settings.digestAlertCount} 条上限。` },
              settings,
            )
          }
        }
      }
    } catch {
      /* 定时器里出错不影响下一轮 */
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 60 * 1000)
  if (typeof timer?.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'dsh-reminder-notify: digest watcher')
}

function registerDigestRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: DIGEST_ROUTE,
    handler: async (req, res) => {
      try {
        const settings = getSettings()
        const method = (req.method ?? 'GET').toUpperCase()
        if (method === 'GET') {
          const entries = readHistory(settings)
          let balance = null
          if (settings.digestIncludeBalance) {
            const read = await readAccountBalance(ctx).catch(() => null)
            if (read && read.balance !== undefined) balance = read
          }
          return reply(res, 200, {
            ok: true,
            enabled: settings.digestEnabled,
            time: settings.digestTime,
            lastDate: settings.digestLastDate,
            alertCount: settings.digestAlertCount,
            pushEnabled: settings.pushEnabled,
            pushFormat: settings.pushFormat,
            title: str(settings.digestTitle, '今日提醒日报'),
            message: digestMessage(settings, entries, balance),
          })
        }
        if (method !== 'POST') return reply(res, 405, { ok: false, error: 'use GET or POST' })
        await readJsonBody(req)
        const result = await runDigest(ctx, getSettings, { force: true })
        return reply(res, 200, { ok: result.ok !== false, title: result.title, message: result.message, push: result.push })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: digest route')
}

/** 宿主健康：最近一次退出码 / 结果 / 失败原因，供自诊断面板与 doctor 路由读取。 */
const hostHealth = { lastExit: null, lastAction: null, lastAt: 0, lastError: '', failures: [] }

function noteHostRun(exitCode, action, error) {
  hostHealth.lastExit = exitCode
  hostHealth.lastAction = action
  hostHealth.lastAt = Date.now()
  hostHealth.lastError = error === undefined ? '' : String(error)
  if (error !== undefined || action === 'host-failed') {
    hostHealth.failures.push({
      at: hostHealth.lastAt,
      exit: exitCode,
      action,
      error: hostHealth.lastError,
    })
    if (hostHealth.failures.length > 10) hostHealth.failures.shift()
  }
}

/** 在 PATH 里找一个可执行文件（Windows 上补 .exe），找不到返回 null。 */
function resolveOnPath(name) {
  if (typeof name !== 'string' || name.trim() === '') return null
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir !== '')
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        // 无权访问的目录跳过
      }
    }
  }
  return null
}

/**
 * 0.16 自诊断：把「要什么、在哪、通不通」逐条列出来。
 * 只读，不弹卡、不改配置；面板的「运行自检」和 doctor 路由都用它。
 */
export function doctorReport(ctx, getSettings) {
  const settings = getSettings()
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: ok === true, detail: String(detail ?? '') })

  add('platform', process.platform === 'win32', process.platform)

  const psName = str(settings.powershellPath, 'powershell.exe')
  const looksLikePath = psName.includes('/') || psName.includes('\\')
  const psPath = looksLikePath ? path.resolve(psName) : resolveOnPath(psName)
  add('powershell', psPath !== null && psPath !== undefined && fs.existsSync(psPath), psPath ?? `找不到 ${psName}`)

  const scriptPath = path.resolve(str(settings.scriptPath, BUNDLED_HOST_SCRIPT))
  add('host-script', fs.existsSync(scriptPath), scriptPath)

  const audioDir = path.resolve(str(settings.audioDir, BUNDLED_AUDIO_DIR))
  const doneAudio = str(settings.doneAudio, '')
  const decideAudio = str(settings.decideAudio, '')
  const audioOk = fs.existsSync(audioDir)
  add('audio-dir', audioOk, audioDir)
  if (audioOk) {
    const missing = [doneAudio, decideAudio]
      .filter((file) => file !== '')
      .filter((file) => !fs.existsSync(path.join(audioDir, file)))
    add('audio-files', missing.length === 0, missing.length === 0 ? '两个提示音都在' : '缺少 ' + missing.join('、'))
  }

  // 调用方可能只给半份 settings（自检、别的插件），这里兜一层，别让诊断自己崩。
  let histFile = ''
  try {
    histFile = historyPathOf(settings)
  } catch {
    histFile = path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'history.json')
  }
  let writable = false
  try {
    fs.mkdirSync(path.dirname(histFile), { recursive: true })
    fs.accessSync(path.dirname(histFile), fs.constants.W_OK)
    writable = true
  } catch {
    writable = false
  }
  add('history-writable', writable, histFile)

  const service = (name) => (typeof ctx.get === 'function' ? ctx.get(name) : undefined)
  const web = service('webServer')
  add('routes', web !== undefined && web !== null && typeof web.register === 'function', web === undefined ? 'webServer 不可用' : 'webServer 可用')
  const tools = service('tools')
  add('tools', tools !== undefined && tools !== null && typeof tools.register === 'function', tools === undefined ? 'tools 不可用' : 'notify_user 可注册')
  add('config-editor', service('configEditor') !== undefined, service('configEditor') === undefined ? '面板只能读（旧宿主）' : '可写')
  add('account', service('deepseekAccount') !== undefined, service('deepseekAccount') === undefined ? '读不到余额（不影响卡片）' : '可读余额')
  add('service-api', typeof ctx.provide === 'function', typeof ctx.provide === 'function' ? "可 provide('reminder')" : '旧宿主没有 ctx.provide')

  // 0.16.1：GitHub 连通性。Steam++（Watt Toolkit）加速 GitHub 靠改 hosts 把 github.com
  // 指到 127.0.0.1，由它的本地代理接住；它没接管（只开了进程没点「一键加速」/被强杀）时，
  // 浏览器和 git 都会连不上。这里做静态判断：hosts 里有没有本机重定向。
  // 真正「能不能连」用 POST /doctor {mode:'github'} 现测。
  const hostsFile = process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
    : '/etc/hosts'
  let githubLines = []
  try {
    githubLines = fs.readFileSync(hostsFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .filter((line) => /^\d{1,3}(\.\d{1,3}){3}\s/.test(line))
      .filter((line) => /github\.com|githubusercontent\.com/i.test(line))
  } catch {
    githubLines = []
  }
  const loopback = githubLines.filter((line) => /^127\.0\.0\.1\s/.test(line))
  if (githubLines.length === 0) {
    add('github', true, 'hosts 里没有 github 重定向（裸连）')
  } else if (loopback.length === 0) {
    add('github', true, 'hosts 指向 ' + githubLines[0].split(/\s+/)[0])
  } else {
    add('github', false, 'hosts 把 github 指到 127.0.0.1（Steam++ 加速表）；加速器没接管就连不上，跑 scripts/github-push.ps1 会自动处理')
  }

  const lastExit = hostHealth.lastExit
  const hostOk = lastExit === null || lastExit === 0
  add('host-exit', hostOk, lastExit === null ? '还没有弹过卡片' : `最近一次退出码 ${lastExit}`)

  return {
    ok: checks.every((check) => check.ok),
    version: packageVersion(),
    platform: process.platform,
    node: process.version,
    paths: { powershell: psPath ?? null, hostScript: scriptPath, audioDir, history: histFile },
    host: {
      lastExit: hostHealth.lastExit,
      lastAction: hostHealth.lastAction,
      lastAt: hostHealth.lastAt,
      lastError: hostHealth.lastError,
      failureCount: hostHealth.failures.length,
      failures: hostHealth.failures.slice(-5),
    },
    checks,
  }
}

const DOCTOR_ROUTE = '/dsh-reminder-notify/doctor'

/** 现测一次 https://github.com（HEAD，8 秒超时）。 */
export function probeGithub(timeoutMs = 8000) {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const done = (payload) => {
      if (settled) return
      settled = true
      resolve({ ...payload, ms: Date.now() - started })
    }
    try {
      const req = https.request(
        { method: 'HEAD', host: 'github.com', path: '/', timeout: timeoutMs, headers: { 'user-agent': 'dsh-reminder-notify-doctor' } },
        (res) => {
          res.resume()
          const code = res.statusCode ?? 0
          done({ ok: code >= 200 && code < 500, statusCode: code })
        },
      )
      req.on('timeout', () => {
        req.destroy()
        done({ ok: false, error: `timeout ${timeoutMs}ms` })
      })
      req.on('error', (error) => done({ ok: false, error: String(error?.message ?? error) }))
      req.end()
    } catch (error) {
      done({ ok: false, error: String(error?.message ?? error) })
    }
  })
}

/** 只看端口有没有人接（不做 TLS）：Steam++ 接管时 TLS 由它处理，Node 校验证书会失败。 */
export function probeTcp(host, port, timeoutMs = 1500) {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const done = (payload) => {
      if (settled) return
      settled = true
      resolve({ ...payload, ms: Date.now() - started })
    }
    try {
      const socket = net.connect({ host, port })
      socket.setTimeout(timeoutMs)
      socket.once('connect', () => {
        socket.destroy()
        done({ ok: true })
      })
      socket.once('timeout', () => {
        socket.destroy()
        done({ ok: false, error: `timeout ${timeoutMs}ms` })
      })
      socket.once('error', (error) => done({ ok: false, error: String(error?.message ?? error) }))
    } catch (error) {
      done({ ok: false, error: String(error?.message ?? error) })
    }
  })
}

/**
 * 0.17.4：hosts 指向 127.0.0.1 不等于连不上——Steam++（Watt Toolkit）加速时，
 * 它的本地代理就接在 127.0.0.1 上。所以真连一次再定结论：能通就是绿，连不上才红。
 */
async function withGithubProbe(report) {
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const item = checks.find((check) => check?.id === 'github')
  if (item === undefined || item === null || item.ok === true) return report
  if (!String(item.detail ?? '').includes('127.0.0.1')) return report
  const probe = await probeGithub(4000)
  if (probe.ok) {
    item.ok = true
    item.detail = `hosts 指向 127.0.0.1，加速器已接管（HTTP ${probe.statusCode ?? 0} · ${probe.ms}ms）`
    report.ok = checks.every((check) => check.ok !== false)
    return report
  }
  // 加速器接管时 Node 往往校验证书失败（TLS 由它中转），退一步只看本地端口有没有人接。
  const tcp = await probeTcp('127.0.0.1', 443)
  if (tcp.ok) {
    item.ok = true
    item.detail = 'hosts 指向 127.0.0.1，加速器本地代理在监听 443（TLS 由加速器转发，浏览器可用）'
    report.ok = checks.every((check) => check.ok !== false)
    return report
  }
  item.detail = `${item.detail}；现测失败：${probe.error ?? 'HTTP ' + String(probe.statusCode ?? 0)}`
  return report
}

function registerDoctorRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: DOCTOR_ROUTE,
    handler: async (req, res) => {
      try {
        const settings = getSettings()
        const method = (req.method ?? 'GET').toUpperCase()
        if (method === 'GET') return reply(res, 200, { ok: true, report: await withGithubProbe(doctorReport(ctx, getSettings)) })
        if (method !== 'POST') return reply(res, 405, { ok: false, error: 'use GET or POST' })
        const body = await readJsonBody(req)
        const mode = body !== null && typeof body === 'object' ? str(body.mode, 'check') : 'check'
        if (mode === 'check') return reply(res, 200, { ok: true, report: await withGithubProbe(doctorReport(ctx, getSettings)) })
        if (mode === 'github') {
          const probe = await probeGithub()
          return reply(res, 200, { ok: true, mode: 'github', github: probe })
        }
        if (mode === 'probe') {
          const card = await notify(
            'raw',
            { title: '自检样卡', message: '这张卡由「运行自检」弹出，能看到就说明宿主正常。', seconds: 12 },
            { ...settings, quietEnabled: false, cardsEnabled: true },
          )
          return reply(res, 200, { ok: true, mode: 'probe', card })
        }
        return reply(res, 400, { ok: false, error: 'unknown mode' })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: doctor route')
}

// 0.17：历史导出 —— 面板点一下，CSV/JSON 落到桌面，方便拿去算账或贴给别人。
function exportHistoryFile(settings, entries, format, days) {
  const since = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000
  const rows = entries.filter((entry) => num(entry?.at, 0) >= since)
  const stamp = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const name = `提醒历史-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.${format}`
  const dir = path.join(os.homedir(), 'Desktop')
  const file = path.join(dir, name)
  if (format === 'json') {
    fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8')
    return { file, count: rows.length }
  }
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`
  const lines = ['时间,档位,标题,正文,处理方式,条数,稍后提醒,免打扰']
  for (const entry of rows) {
    lines.push(
      [
        new Date(num(entry.at, 0)).toISOString(),
        cell(entry.kind),
        cell(entry.title),
        cell(entry.message),
        cell(entry.action),
        num(entry.count, 1),
        entry.snoozed === true ? '是' : '否',
        entry.quiet === true ? '是' : '否',
      ].join(','),
    )
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, lines.join('\r\n'), 'utf8')
  return { file, count: rows.length }
}

function registerExportRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: EXPORT_ROUTE,
    handler: (req, res) => {
      try {
        const settings = getSettings()
        const url = new URL(req.url ?? EXPORT_ROUTE, 'http://127.0.0.1')
        const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv'
        const days = Math.round(clamp(num(url.searchParams.get('days'), 30), 1, 365))
        const result = exportHistoryFile(settings, readHistory(settings), format, days)
        reply(res, 200, { ok: true, format, days, file: result.file, count: result.count })
      } catch (error) {
        reply(res, 500, { ok: false, error: 'export-failed', detail: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: history export route')
}

// 0.20：用户在卡片输入框里回的话，单独一条口子给面板和其它插件读。
export function repliesOf(settings, limit = 20) {
  const entries = readHistory(settings).filter((entry) => entry.action === 'replied' && str(entry.reply, '') !== '')
  const size = Math.round(clamp(num(limit, 20), 1, 200))
  return entries.slice(-size).reverse()
}

// 0.21：手机端局域网页面。手机和电脑在同一个 Wi-Fi 里，扫码/输地址就能看最近的提醒、回一句话。
// 不做公网、不要备案：页面只挂在已有的 web 端口上，靠一个随机口令拦住外人。
export function lanAddressOf(interfaces = os.networkInterfaces()) {
  const list = []
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const info of addrs || []) {
      const family = typeof info.family === 'string' ? info.family : info.family === 4 ? 'IPv4' : 'IPv6'
      if (family !== 'IPv4' || info.internal === true) continue
      list.push({ name, address: info.address })
    }
  }
  return list.find((one) => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(one.address)) || list[0] || null
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 手机页地址：用请求里的 Host 拼，手机换成同一个局域网 IP 就能打开。 */
export function mobileLinkOf(settings, host, lan = null) {
  const token = str(settings.mobileToken, '')
  const address = lan?.address ?? '127.0.0.1'
  const port = /:\d+$/.test(String(host ?? '')) ? String(host).split(':').pop() : '4517'
  const base = `http://${address}:${port}${MOBILE_ROUTE}`
  return { url: token === '' ? base : `${base}?t=${encodeURIComponent(token)}`, address, port, token }
}


// 0.24：手机页升级成小 App —— 概览 / 历史（筛选、翻页）/ 设置（开关与导出）。
export function mobileViewOf(query = {}) {
  const rawTab = str(query.tab, 'home')
  const tab = rawTab === 'history' || rawTab === 'settings' ? rawTab : 'home'
  const rawKind = str(query.kind, 'all')
  const kind = rawKind === 'done' || rawKind === 'decide' || rawKind === 'raw' ? rawKind : 'all'
  return { tab, kind, page: Math.max(1, Math.min(200, Math.round(num(query.page, 1)))) }
}

export function mobileSettingsPatch(body) {
  const allowed = ['sound', 'quietEnabled', 'pushEnabled', 'digestEnabled', 'toastEnabled']
  const values = body && typeof body === 'object' ? (body.values && typeof body.values === 'object' ? body.values : body) : {}
  const patch = {}
  for (const key of allowed) {
    if (typeof values[key] === 'boolean') patch[key] = values[key]
  }
  return patch
}

export function mobileCsvOf(entries, days = 30, now = new Date()) {
  const from = now.getTime() - Math.max(1, Math.round(days)) * 86400000
  const list = entries.filter((entry) => Number(entry.at ?? 0) >= from)
  const lines = ['时间,档位,标题,正文,处理方式,回话,附件']
  for (const entry of list) {
    const at = new Date(Number(entry.at ?? 0))
    const stamp = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`
    const cells = [
      stamp,
      str(entry.kind, ''),
      str(entry.title, ''),
      str(entry.message, ''),
      str(entry.action, ''),
      str(entry.reply, ''),
      (Array.isArray(entry.attachments) ? entry.attachments : []).map((item) => str(item?.name, '')).join(' '),
    ]
    lines.push(cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  }
  return lines.join('\n') + '\n'
}

export function mobileBarsOf(stats, days = 7) {
  const buckets = Array.isArray(stats?.last30) ? stats.last30.slice(-days) : []
  const max = buckets.reduce((best, item) => Math.max(best, Number(item?.count ?? 0)), 0)
  return buckets.map((item) => ({
    date: str(item?.date, ''),
    count: Number(item?.count ?? 0),
    pct: max <= 0 ? 0 : Math.round((Number(item?.count ?? 0) / max) * 100),
  }))
}

export function mobilePageOf(settings, entries, now = new Date(), view = {}) {
  const stats = historyStats(entries)
  const tab = str(view.tab, 'home') === 'history' ? 'history' : str(view.tab, 'home') === 'settings' ? 'settings' : 'home'
  const kind = ['done', 'decide', 'raw'].includes(str(view.kind, '')) ? str(view.kind) : 'all'
  const pageSize = 20
  const filtered = kind === 'all' ? entries : entries.filter((entry) => entry.kind === kind)
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(Math.max(1, Math.round(num(view.page, 1))), pageCount)
  const pageList = filtered.slice(-currentPage * pageSize, filtered.length - (currentPage - 1) * pageSize).reverse()
  const recent = tab === 'home' ? entries.slice(-5).reverse() : pageList
  const token = str(settings.mobileToken, '')
  const link = (extra = '') => `${MOBILE_ROUTE}?t=${encodeURIComponent(token)}${extra}`
  const bars = mobileBarsOf(stats, 7)
  const kindText = { done: '完成', decide: '要你决定', raw: '普通' }
  const actionText = {
    ok: '知道了',
    timeout: '自动关闭',
    dismiss: '点了卡片',
    snooze: '稍后提醒',
    replied: '回话',
    custom: '自定义按钮',
    'quiet-skip': '免打扰跳过',
  }
  const rows = recent
    .map((entry) => {
      const time = new Date(entry.at ?? 0)
      const hh = String(time.getHours()).padStart(2, '0')
      const mm = String(time.getMinutes()).padStart(2, '0')
      const reply = str(entry.reply, '') === '' ? '' : `<div class="reply">回复：${escapeHtml(entry.reply)}</div>`
      return `<li><div class="meta"><span>${hh}:${mm}</span><span>${escapeHtml(kindText[entry.kind] ?? entry.kind)}</span><span>${escapeHtml(actionText[entry.action] ?? entry.action)}</span></div><div class="msg">${escapeHtml(entry.title)}</div>${reply}</li>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#14181f">
<link rel="manifest" href="${MOBILE_ROUTE}/manifest.webmanifest${str(settings.mobileToken, '') === '' ? '' : '?t=' + encodeURIComponent(str(settings.mobileToken, ''))}">
<link rel="apple-touch-icon" href="${MOBILE_ROUTE}/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="桌面提醒">
<title>桌面提醒 · 手机版</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 14px 190px; background: #14181f; color: #e6edf3; font: 15px/1.55 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
h1 { font-size: 17px; margin: 0 0 4px; }
.sub { color: #8b98a8; font-size: 13px; margin-bottom: 16px; }
.stats { display: flex; gap: 10px; margin-bottom: 16px; }
.stat { flex: 1; background: #1b212b; border-radius: 10px; padding: 10px; text-align: center; }
.stat b { display: block; font-size: 20px; }
.stat span { color: #8b98a8; font-size: 12px; }
ul { list-style: none; padding: 0; margin: 0 0 18px; }
li { background: #1b212b; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
.meta { display: flex; gap: 8px; color: #8b98a8; font-size: 12px; margin-bottom: 4px; }
.msg { font-size: 14px; word-break: break-word; }
.reply { margin-top: 4px; color: #7dd3a0; font-size: 13px; }
form { display: flex; gap: 8px; padding-bottom: 8px; }
.foot { position: sticky; bottom: 0; background: #14181f; padding-top: 8px; border-top: 1px solid #202834; }
input { flex: 1; padding: 11px 12px; border-radius: 10px; border: 1px solid #2b3442; background: #1b212b; color: #e6edf3; font-size: 15px; }
button { padding: 11px 16px; border-radius: 10px; border: 0; background: #2f81f7; color: #fff; font-size: 15px; }
.att { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.att:empty { display: none; }
.chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 8px; border-radius: 999px; background: #232a35; color: #c9d4e3; }
.chip b { font-weight: 500; }
.chip button { border: 0; background: transparent; color: #8b97a8; font-size: 14px; line-height: 1; cursor: pointer; }
.pick { display: flex; gap: 8px; padding: 0 12px 8px; }
.pick button { flex: 1; border: 1px solid #2f3a4a; background: #1b212b; color: #c9d4e3; border-radius: 8px; padding: 8px 0; font-size: 13px; }
.install { margin: 0 0 14px; width: 100%; padding: 11px 16px; border-radius: 10px; border: 1px solid #2b3442; background: #1b212b; color: #e6edf3; font-size: 15px; }
#tip { color: #8b98a8; font-size: 12px; margin-top: 8px; min-height: 16px; }
.tabs { display: flex; gap: 8px; margin: 0 0 14px; }
.tab { flex: 1; text-align: center; padding: 9px 0; border-radius: 9px; background: #1b212b; color: #c9d4e3; text-decoration: none; font-size: 14px; }
.tab.on { background: #2f81f7; color: #fff; }
.panel { background: #1b212b; border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
.plabel { color: #8b98a8; font-size: 12px; margin-bottom: 8px; }
.bars { display: flex; align-items: flex-end; gap: 6px; height: 64px; }
.bar { flex: 1; min-height: 3px; border-radius: 3px 3px 0 0; background: #2f81f7; opacity: .85; }
.filters { display: flex; gap: 8px; margin-bottom: 12px; }
.fchip { flex: 1; text-align: center; padding: 7px 0; border-radius: 999px; background: #1b212b; color: #c9d4e3; text-decoration: none; font-size: 13px; }
.fchip.on { background: #2f81f7; color: #fff; }
.pager { display: flex; gap: 8px; margin: 0 0 14px; }
.pg { flex: 1; text-align: center; padding: 9px 0; border-radius: 9px; background: #1b212b; color: #c9d4e3; text-decoration: none; font-size: 14px; }
.pg.off { opacity: .4; }
.row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #202834; font-size: 14px; }
.row input { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; }
.kv { display: flex; justify-content: space-between; padding: 5px 0; color: #8b98a8; font-size: 13px; }
.kv b { color: #e6edf3; font-weight: 500; }
#setTip { color: #8b98a8; font-size: 12px; margin-top: 6px; min-height: 14px; }
</style></head><body>
<h1>桌面提醒 · 手机版</h1>
<div class="sub">${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} · 和电脑同一个 Wi-Fi 才能打开</div>
${settings.httpsEnabled === true ? `<div class="sub" style="margin-top:-8px">录音与「安装到桌面」需要 https：<a href="${escapeHtml(httpsLinkOf(settings, '', lanAddressOf()))}" style="color:#7db6ff">打开 https 版本</a>（浏览器会提示证书不受信任，选继续访问即可）</div>` : ''}
<button id="install" class="install" hidden>安装到桌面</button>
<nav class="tabs">
  <a class="tab${tab === 'home' ? ' on' : ''}" href="${link('&tab=home')}">概览</a>
  <a class="tab${tab === 'history' ? ' on' : ''}" href="${link('&tab=history')}">历史</a>
  <a class="tab${tab === 'settings' ? ' on' : ''}" href="${link('&tab=settings')}">设置</a>
</nav>
${tab === 'home'
  ? `<div class="stats">
  <div class="stat"><b>${stats.today}</b><span>今天</span></div>
  <div class="stat"><b>${stats.total}</b><span>总共</span></div>
  <div class="stat"><b>${stats.byKind.decide ?? 0}</b><span>要你决定</span></div>
</div>
<div class="panel"><div class="plabel">最近 7 天</div><div class="bars">${bars.map((bar) => `<span class="bar" style="height:${bar.pct}%" title="${bar.date} · ${bar.count} 条"></span>`).join('')}</div></div>
<ul>${rows === '' ? '<li><div class="msg">还没有提醒</div></li>' : rows}</ul>`
  : tab === 'history'
  ? `<div class="filters">${[['all', '全部'], ['done', '完成'], ['decide', '要你决定'], ['raw', '普通']].map(([value, label]) => `<a class="fchip${kind === value ? ' on' : ''}" href="${link('&tab=history&kind=' + value)}">${label}</a>`).join('')}</div>
<div class="plabel">共 ${filtered.length} 条 · 第 ${currentPage}/${pageCount} 页</div>
<ul>${rows === '' ? '<li><div class="msg">这一页没有记录</div></li>' : rows}</ul>
<div class="pager">
  ${currentPage > 1 ? `<a class="pg" href="${link('&tab=history&kind=' + kind + '&page=' + (currentPage - 1))}">上一页</a>` : '<span class="pg off">上一页</span>'}
  ${currentPage < pageCount ? `<a class="pg" href="${link('&tab=history&kind=' + kind + '&page=' + (currentPage + 1))}">下一页</a>` : '<span class="pg off">下一页</span>'}
</div>`
  : `<div class="panel">
  <div class="plabel">开关（改完点保存，立即生效）</div>
  <label class="row"><span>提示音</span><input type="checkbox" data-key="sound" ${settings.sound === false ? '' : 'checked'}></label>
  <label class="row"><span>免打扰</span><input type="checkbox" data-key="quietEnabled" ${settings.quietEnabled === true ? 'checked' : ''}></label>
  <label class="row"><span>推送到手机</span><input type="checkbox" data-key="pushEnabled" ${settings.pushEnabled === true ? 'checked' : ''}></label>
  <label class="row"><span>每日日报</span><input type="checkbox" data-key="digestEnabled" ${settings.digestEnabled === true ? 'checked' : ''}></label>
  <label class="row"><span>系统通知气泡</span><input type="checkbox" data-key="toastEnabled" ${settings.toastEnabled === true ? 'checked' : ''}></label>
  <button type="button" id="saveSet">保存</button>
  <div id="setTip"></div>
</div>
<div class="panel">
  <div class="plabel">导出</div>
  <div class="pick">
    <button type="button" id="expCsv">导出 CSV</button>
    <button type="button" id="expJson">导出 JSON</button>
  </div>
</div>
<div class="panel">
  <div class="plabel">当前状态</div>
  <div class="kv"><span>停留秒数</span><b>${num(settings.seconds, 60)}</b></div>
  <div class="kv"><span>位置</span><b>${escapeHtml(str(settings.position, 'br'))}</b></div>
  <div class="kv"><span>日报时间</span><b>${escapeHtml(str(settings.digestTime, '09:00'))}</b></div>
  <div class="kv"><span>提示音</span><b>${settings.sound === false ? '关' : '开'}</b></div>
</div>`}

<div class="foot">
<div id="att" class="att"></div>
<div class="pick">
<button type="button" id="pickImg">拍照 / 选图</button>
<button type="button" id="pickRec">录一段话</button>
<button type="button" id="pickAudio">选音频</button>
</div>
<input type="file" id="fileImg" accept="image/*" capture="environment" hidden>
<input type="file" id="fileAudio" accept="audio/*" hidden>
<form id="f"><input id="m" maxlength="300" placeholder="回一句话给电脑上的模型"><button type="submit">发送</button></form>
</div>
<div id="tip"></div>
<script>
// 局域网是 http，浏览器把这种页面当「不安全来源」：service worker 注册不了，
// 安装提示（beforeinstallprompt）也不会触发。所以这里按 secure context 分别处理，
// 不安全的地址上给一条手动添加到主屏幕的说明，而不是给一个点了没反应的按钮。
const secureContext = window.isSecureContext === true;
if (secureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('${MOBILE_ROUTE}/sw.js', { scope: '${MOBILE_ROUTE}/' }).catch(() => {});
}
let installEvent = null;
const installBtn = document.getElementById('install');
if (!secureContext) {
  installBtn.hidden = false;
  installBtn.textContent = '添加到主屏幕';
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  installBtn.hidden = false;
  installBtn.textContent = '安装到桌面';
});
installBtn.addEventListener('click', async () => {
  const tipBox = document.getElementById('tip');
  if (!installEvent) {
    installBtn.hidden = true;
    if (tipBox) tipBox.textContent = '这个地址是 http 内网地址：iPhone 用 Safari 的「分享 → 添加到主屏幕」，Android 用 Chrome 菜单里的「添加到主屏幕」。想让离线缓存也生效，得用 https 访问本机。';
    return;
  }
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  installBtn.hidden = true;
});
const attachments = [];
const attBox = document.getElementById('att');
const toast = (text) => { const box = document.getElementById('tip'); if (box) box.textContent = text; };
const renderAtt = () => {
  attBox.innerHTML = '';
  attachments.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const name = document.createElement('b');
    name.textContent = item.name + ' · ' + Math.max(1, Math.round(item.size / 1024)) + 'K';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.addEventListener('click', () => { attachments.splice(index, 1); renderAtt(); });
    chip.appendChild(name);
    chip.appendChild(del);
    attBox.appendChild(chip);
  });
};
const uploadFile = async (file) => {
  if (!file) return;
  if (attachments.length >= 3) { toast('最多带 3 个附件'); return; }
  if (file.size > 12 * 1024 * 1024) { toast('这个文件太大了（上限 12MB）'); return; }
  toast('上传中…');
  try {
    const url = '${MOBILE_ROUTE}/upload' + location.search + '&name=' + encodeURIComponent(file.name || 'file');
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
    const data = await r.json();
    if (data && data.ok) { attachments.push({ name: data.name, file: data.file, type: data.type, size: data.size }); renderAtt(); toast('已带上 ' + data.name); }
    else { toast('没传上去：' + ((data && data.error) || '未知原因')); }
  } catch (err) { toast('没传上去：' + err.message); }
};
const pick = (input) => input.addEventListener('change', () => { uploadFile(input.files && input.files[0]); input.value = ''; });
pick(document.getElementById('fileImg'));
pick(document.getElementById('fileAudio'));
document.getElementById('pickImg').addEventListener('click', () => document.getElementById('fileImg').click());
document.getElementById('pickAudio').addEventListener('click', () => document.getElementById('fileAudio').click());
let recorder = null;
let recChunks = [];
document.getElementById('pickRec').addEventListener('click', async () => {
  const button = document.getElementById('pickRec');
  if (recorder && recorder.state === 'recording') { recorder.stop(); button.textContent = '录一段话'; return; }
  if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') { toast('这个浏览器不支持录音，用「选音频」'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recChunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data && event.data.size > 0) recChunks.push(event.data); });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recChunks, { type: 'audio/webm' });
      uploadFile(new File([blob], 'voice-' + Date.now() + '.webm', { type: 'audio/webm' }));
    });
    recorder.start();
    button.textContent = '停止录音';
    toast('正在录音，说完点「停止录音」');
  } catch (err) { toast('打不开麦克风：' + err.message); }
});
const saveSet = document.getElementById('saveSet');
if (saveSet) {
  saveSet.addEventListener('click', async () => {
    const values = {};
    document.querySelectorAll('input[data-key]').forEach((box) => { values[box.dataset.key] = box.checked; });
    const box = document.getElementById('setTip');
    box.textContent = '保存中…';
    try {
      const r = await fetch('${MOBILE_ROUTE}/settings' + location.search, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) });
      const data = await r.json();
      box.textContent = data && data.ok ? '已保存，立即生效' : '没保存成：' + ((data && data.error) || '未知原因');
    } catch (err) { box.textContent = '没保存成：' + err.message; }
  });
}
const exportTo = (format) => {
  const url = '${MOBILE_ROUTE}/export' + location.search + '&format=' + format + '&days=30';
  location.href = url;
};
const csvBtn = document.getElementById('expCsv');
const jsonBtn = document.getElementById('expJson');
if (csvBtn) csvBtn.addEventListener('click', () => exportTo('csv'));
if (jsonBtn) jsonBtn.addEventListener('click', () => exportTo('json'));
const f = document.getElementById('f'); const m = document.getElementById('m'); const tip = document.getElementById('tip');
f.addEventListener('submit', async (e) => {
  e.preventDefault(); const text = m.value.trim(); if (!text && attachments.length === 0) return;
  tip.textContent = '发送中…';
  try {
    const r = await fetch('${MOBILE_ROUTE}/reply' + location.search, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: text, attachments: attachments.slice() }) });
    const data = await r.json();
    if (data && data.ok) { tip.textContent = '已发送，电脑上的模型能看到'; m.value = ''; attachments.length = 0; renderAtt(); }
    else { tip.textContent = '没发出去：' + ((data && data.error) || '未知原因'); }
  } catch (err) { tip.textContent = '没发出去：' + err.message; }
});
</script></body></html>`
}

// 0.22：手机回话让模型自己看到。把「未读的手机回话」挂进系统提示词的 context，
// 每次组装提示词时把新的几条读出来，读完就记成已读，不重复嘀咕。
let phoneSeenAt = Date.now()

export function unreadPhoneReplies(settings, since = 0, limit = 10) {
  return readHistory(settings)
    .filter((entry) => entry.action === 'replied' && str(entry.via, '') === 'mobile' && Number(entry.at ?? 0) > since)
    .slice(-limit)
}

export function phonePromptText(settings, now = Date.now()) {
  const fresh = unreadPhoneReplies(settings, phoneSeenAt)
  if (fresh.length === 0) return ''
  phoneSeenAt = now
  const lines = fresh.map((entry) => {
    const at = new Date(Number(entry.at ?? now))
    const hh = String(at.getHours()).padStart(2, '0')
    const mm = String(at.getMinutes()).padStart(2, '0')
    return `- ${hh}:${mm} 手机回话：${str(entry.reply, '')}${attachmentSummaryOf(entry)}`
  })
  return `用户刚从手机上回了话（${fresh.length} 条，已经看过就不用再问）：\n${lines.join('\n')}`
}

export function resetPhoneSeen(now = Date.now()) {
  phoneSeenAt = now
}

// 0.28：决定卡的候选按钮点了哪个，也要让模型自己看到。
let choiceSeenAt = Date.now()

export function unreadChoices(settings, since = 0, limit = 5) {
  return readHistory(settings)
    .filter((entry) => entry.action === 'choice' && str(entry.choice, '') !== '' && Number(entry.at ?? 0) > since)
    .slice(-limit)
}

export function choicePromptText(settings, now = Date.now()) {
  const fresh = unreadChoices(settings, choiceSeenAt)
  if (fresh.length === 0) return ''
  choiceSeenAt = now
  const lines = fresh.map((entry) => {
    const at = new Date(Number(entry.at ?? now))
    const hh = String(at.getHours()).padStart(2, '0')
    const mm = String(at.getMinutes()).padStart(2, '0')
    return `- ${hh}:${mm} 「${str(entry.title, '')}」选了：${str(entry.choice, '')}`
  })
  return `用户在提醒卡上点了选项（${fresh.length} 条，按这个走就行，不用再确认）：\n${lines.join('\n')}`
}

export function resetChoiceSeen(now = Date.now()) {
  choiceSeenAt = now
}

function registerMobileAssets(ctx, getSettings) {
  const reply = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  const manifest = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/manifest.webmanifest`,
    handler: (req, res) => {
      const settings = getSettings()
      const token = str(settings.mobileToken, '')
      const start = token === '' ? MOBILE_ROUTE : `${MOBILE_ROUTE}?t=${encodeURIComponent(token)}`
      const body = JSON.stringify({
        name: '桌面提醒',
        short_name: '提醒',
        description: '看最近的提醒，并回一句话给电脑上的模型',
        start_url: start,
        scope: MOBILE_ROUTE,
        display: 'standalone',
        background_color: '#14181f',
        theme_color: '#14181f',
        icons: [
          { src: `${MOBILE_ROUTE}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${MOBILE_ROUTE}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      })
      return reply(res, 200, body, 'application/manifest+json; charset=utf-8')
    },
  }
  mountRoute(ctx, manifest, 'dsh-reminder-notify: mobile manifest')

  const sw = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/sw.js`,
    handler: (req, res) => {
      const body = `const CACHE = 'dsh-reminder-mobile-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
        return response
      })
      .catch(() => caches.match(request).then((hit) => hit || new Response('离线了，连回同一个 Wi-Fi 再打开。', { headers: { 'content-type': 'text/plain; charset=utf-8' } }))),
  )
})
`
      return reply(res, 200, body, 'text/javascript; charset=utf-8')
    },
  }
  mountRoute(ctx, sw, 'dsh-reminder-notify: mobile service worker')

  for (const size of [192, 512]) {
    const icon = {
      kind: 'exact',
      path: `${MOBILE_ROUTE}/icon-${size}.png`,
      handler: (req, res) => {
        try {
          const bytes = fs.readFileSync(path.join(PACKAGE_ROOT, 'assets', 'mobile', `icon-${size}.png`))
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
          res.end(bytes)
        } catch {
          reply(res, 404, JSON.stringify({ ok: false, error: 'icon-missing' }))
        }
      },
    }
    mountRoute(ctx, icon, `dsh-reminder-notify: mobile icon ${size}`)
  }

  const inbox = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/inbox`,
    handler: async (req, res) => {
      const settings = getSettings()
      if (req.method === 'POST') {
        resetPhoneSeen()
        return reply(res, 200, JSON.stringify({ ok: true, unread: 0 }))
      }
      const unread = unreadPhoneReplies(settings, phoneSeenAt)
      return reply(res, 200, JSON.stringify({ ok: true, count: unread.length, replies: unread }))
    },
  }
  mountRoute(ctx, inbox, 'dsh-reminder-notify: mobile inbox route')
}

function registerMobileRoute(ctx, getSettings) {
  const reply = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    res.end(body)
  }
  const unauthorized = (res) => reply(res, 401, JSON.stringify({ ok: false, error: 'token-required' }))
  const authorized = (settings, t) => {
    const token = str(settings.mobileToken, '')
    return token === '' || String(t ?? '') === token
  }
  const route = {
    kind: 'exact',
    path: MOBILE_ROUTE,
    handler: async (req, res) => {
      const settings = getSettings()
      const url = new URL(req.url ?? MOBILE_ROUTE, 'http://127.0.0.1')
      if (!authorized(settings, url.searchParams.get('t'))) return unauthorized(res)
      if (req.method !== 'GET') return reply(res, 405, JSON.stringify({ ok: false, error: 'use GET' }))
      const html = mobilePageOf(settings, readHistory(settings), new Date(), mobileViewOf(Object.fromEntries(url.searchParams)))
      return reply(res, 200, html, 'text/html; charset=utf-8')
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: mobile page')

  const replyRoute = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/reply`,
    handler: async (req, res) => {
      const settings = getSettings()
      const url = new URL(req.url ?? `${MOBILE_ROUTE}/reply`, 'http://127.0.0.1')
      if (!authorized(settings, url.searchParams.get('t'))) return unauthorized(res)
      if (req.method !== 'POST') return reply(res, 405, JSON.stringify({ ok: false, error: 'use POST' }))
      const body = await readJsonBody(req)
      const text = str(body?.message, '').trim().slice(0, 300)
      const attachments = mobileAttachmentsOf(body?.attachments)
      if (text === '' && attachments.length === 0) return reply(res, 400, JSON.stringify({ ok: false, error: 'empty-message' }))
      appendHistory(settings, {
        at: Date.now(),
        kind: 'raw',
        title: '手机回话',
        message: '',
        action: 'replied',
        count: 1,
        snoozed: false,
        quiet: false,
        reply: text,
        attachments,
        via: 'mobile',
      })
      emitServiceEvent('replied', { kind: 'raw', title: '手机回话', reply: text, attachments: attachments.length, via: 'mobile' })
      if (settings.pushEnabled === true && settings.pushReply === true && settings.dryRun !== true) {
        const pushed = pushOut(settings, '手机回话', `${text}${attachmentSummaryOf({ attachments })}`, { kind: 'reply', time: new Date().toISOString() })
        if (pushed !== null && typeof pushed.catch === 'function') pushed.catch(() => {})
      }
      return reply(res, 200, JSON.stringify({ ok: true, replies: repliesOf(settings, 5).length }))
    },
  }
  mountRoute(ctx, replyRoute, 'dsh-reminder-notify: mobile reply route')

  const uploadRoute = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/upload`,
    handler: async (req, res) => {
      const settings = getSettings()
      const url = new URL(req.url ?? `${MOBILE_ROUTE}/upload`, 'http://127.0.0.1')
      if (!authorized(settings, url.searchParams.get('t'))) return unauthorized(res)
      if (req.method !== 'POST') return reply(res, 405, JSON.stringify({ ok: false, error: 'use POST' }))
      const type = str(req.headers['content-type'], 'application/octet-stream').split(';')[0].trim().toLowerCase()
      const name = uploadNameFor(type)
      if (name === null) return reply(res, 415, JSON.stringify({ ok: false, error: 'unsupported-type', type }))
      let body = null
      try {
        body = await readRawBody(req, MOBILE_UPLOAD_LIMIT)
      } catch {
        return reply(res, 413, JSON.stringify({ ok: false, error: 'too-large' }))
      }
      if (body === null || body.length === 0) return reply(res, 400, JSON.stringify({ ok: false, error: 'empty-file' }))
      try {
        const dir = mobileUploadDir()
        fs.mkdirSync(dir, { recursive: true })
        const target = path.join(dir, name)
        fs.writeFileSync(target, body)
        const label = str(url.searchParams.get('name'), name).slice(-60)
        return reply(res, 200, JSON.stringify({ ok: true, file: target, name: label, type, size: body.length }))
      } catch (error) {
        return reply(res, 500, JSON.stringify({ ok: false, error: 'write-failed', detail: String(error && error.message) }))
      }
    },
  }
  mountRoute(ctx, uploadRoute, 'dsh-reminder-notify: mobile upload route')

  const settingsRoute = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/settings`,
    handler: async (req, res) => {
      const settings = getSettings()
      const url = new URL(req.url ?? `${MOBILE_ROUTE}/settings`, 'http://127.0.0.1')
      if (!authorized(settings, url.searchParams.get('t'))) return unauthorized(res)
      if (req.method !== 'POST') return reply(res, 405, JSON.stringify({ ok: false, error: 'use POST' }))
      const body = await readJsonBody(req)
      const patch = mobileSettingsPatch(body)
      if (Object.keys(patch).length === 0) return reply(res, 400, JSON.stringify({ ok: false, error: 'nothing-to-save' }))
      await saveBalanceState(ctx, patch)
      return reply(res, 200, JSON.stringify({ ok: true, saved: patch }))
    },
  }
  mountRoute(ctx, settingsRoute, 'dsh-reminder-notify: mobile settings route')

  const exportRoute = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/export`,
    handler: async (req, res) => {
      const settings = getSettings()
      const url = new URL(req.url ?? `${MOBILE_ROUTE}/export`, 'http://127.0.0.1')
      if (!authorized(settings, url.searchParams.get('t'))) return unauthorized(res)
      const format = str(url.searchParams.get('format'), 'csv').toLowerCase() === 'json' ? 'json' : 'csv'
      const days = Math.max(1, Math.min(365, Math.round(num(url.searchParams.get('days'), 30))))
      const entries = readHistory(settings)
      const from = Date.now() - days * 86400000
      const list = entries.filter((entry) => Number(entry.at ?? 0) >= from)
      const stamp = new Date()
      const name = `提醒历史-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}-${pad2(stamp.getHours())}${pad2(stamp.getMinutes())}.${format}`
      const body = format === 'json' ? JSON.stringify(list, null, 2) : mobileCsvOf(entries, days)
      const type = format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8'
      res.writeHead(200, {
        'content-type': type,
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      })
      res.end(body)
    },
  }
  mountRoute(ctx, exportRoute, 'dsh-reminder-notify: mobile export route')

  const linkRoute = {
    kind: 'exact',
    path: `${MOBILE_ROUTE}/link`,
    handler: async (req, res) => {
      const settings = getSettings()
      if (str(settings.mobileToken, '') === '') {
        // 第一次要链接时生成口令并写回配置，之后固定不变
        const token = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
        await saveBalanceState(ctx, { mobileToken: token })
        settings.mobileToken = token
      }
      const lan = lanAddressOf()
      const link = mobileLinkOf(settings, req.headers?.host, lan)
      return reply(res, 200, JSON.stringify({ ok: true, ...link, lan: lan?.address ?? null, iface: lan?.name ?? null }))
    },
  }
  mountRoute(ctx, linkRoute, 'dsh-reminder-notify: mobile link route')
}

// 0.32：面板里的「本插件下载量」（npm 公开统计）与「反馈与留言」（本地 JSONL + 一键提交 issue）。
const STATS_ROUTE = '/dsh-reminder-notify/stats'
const FEEDBACK_ROUTE = '/dsh-reminder-notify/feedback'
const NPM_PACKAGE = 'dsh-reminder-notify'
const FEEDBACK_CATEGORIES = ['suggest', 'problem', 'experience']
const FEEDBACK_CATEGORY_LABELS = { suggest: '建议', problem: '问题', experience: '体验' }
let npmStatsCache = { at: 0, data: null }

export function feedbackPathOf(settings) {
  return settings.feedbackFile === '' ? path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'feedback.jsonl') : settings.feedbackFile
}

export function feedbackEntryOf(body, now = Date.now()) {
  const text = str(body?.text, '').trim().slice(0, 2000)
  if (text === '') return null
  const asked = str(body?.category, '')
  const category = FEEDBACK_CATEGORIES.includes(asked) ? asked : 'suggest'
  return { id: 'f' + now.toString(36) + Math.random().toString(36).slice(2, 7), at: now, category, text }
}

export function envSummaryOf(settings, entries, now = new Date()) {
  const list = Array.isArray(entries) ? entries.slice(-3) : []
  const recent = list.map((entry) => ({
    at: new Date(Number(entry.at) || Number(now)).toISOString(),
    kind: str(entry.kind, 'raw'),
    action: str(entry.action, ''),
  }))
  return {
    plugin: NPM_PACKAGE + ' ' + packageVersion(),
    platform: process.platform + ' ' + os.release(),
    node: process.version,
    recent,
  }
}

export function issueUrlOf(repo, entry, env) {
  const owner = str(repo, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!owner.includes('/') || entry === null || entry === undefined) return ''
  const label = FEEDBACK_CATEGORY_LABELS[entry.category] || '建议'
  const head = str(entry.text, '').split('\n')[0].slice(0, 40)
  const lines = [str(entry.text, ''), '', '---', '插件：' + str(env?.plugin, ''), '系统：' + str(env?.platform, ''), 'Node：' + str(env?.node, '')]
  const recent = Array.isArray(env?.recent) ? env.recent : []
  if (recent.length > 0) {
    lines.push('最近提醒：')
    for (const item of recent) lines.push('- ' + str(item.at, '') + ' · ' + str(item.kind, '') + ' · ' + str(item.action, ''))
  }
  const title = '[反馈] ' + label + '：' + head
  return 'https://github.com/' + owner + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(lines.join('\n'))
}

export function readFeedback(settings) {
  try {
    const raw = fs.readFileSync(feedbackPathOf(settings), 'utf8')
    const out = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed !== null && typeof parsed === 'object') out.push(parsed)
      } catch {
        /* 坏行跳过 */
      }
    }
    return out
  } catch {
    return []
  }
}

function writeFeedbackAll(settings, list) {
  try {
    const file = feedbackPathOf(settings)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, list.map((item) => JSON.stringify(item)).join('\n') + (list.length > 0 ? '\n' : ''))
    return true
  } catch {
    return false
  }
}

function appendFeedback(settings, entry) {
  try {
    const file = feedbackPathOf(settings)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(entry) + '\n')
    return true
  } catch {
    return false
  }
}

export function statsOf(raw) {
  const pick = (node) => Math.max(0, Math.round(Number(node && node.downloads) || 0))
  const series = Array.isArray(raw?.series)
    ? raw.series.filter((item) => item && typeof item.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.day)).map((item) => ({ day: item.day, downloads: pick(item) }))
    : []
  return { day: pick(raw?.lastDay), week: pick(raw?.lastWeek), month: pick(raw?.lastMonth), series }
}

async function fetchNpmStats(settings, force = false) {
  const ttl = Math.max(1, Math.round(num(settings.statsCacheMinutes, 10))) * 60000
  if (force !== true && npmStatsCache.data !== null && Date.now() - npmStatsCache.at < ttl) {
    return { ...npmStatsCache.data, cached: true }
  }
  const base = 'https://api.npmjs.org/downloads'
  const get = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('http ' + response.status)
    return await response.json()
  }
  try {
    const [lastDay, lastWeek, lastMonth, range] = await Promise.all([
      get(base + '/point/last-day/' + NPM_PACKAGE),
      get(base + '/point/last-week/' + NPM_PACKAGE),
      get(base + '/point/last-month/' + NPM_PACKAGE),
      get(base + '/range/last-week/' + NPM_PACKAGE).catch(() => ({ downloads: [] })),
    ])
    const data = { package: NPM_PACKAGE, ...statsOf({ lastDay, lastWeek, lastMonth, series: range?.downloads }), at: new Date().toISOString() }
    npmStatsCache = { at: Date.now(), data }
    return { ...data, cached: false }
  } catch (error) {
    if (npmStatsCache.data !== null) return { ...npmStatsCache.data, cached: true, stale: true }
    return { error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }
  }
}

// 0.33：配置备份与恢复。重装/改坏之后能回滚，也能导出给别人看。
const BACKUP_ROUTE = '/dsh-reminder-notify/backup'
const BACKUP_KEEP = 20

export function backupDirOf(settings) {
  return settings.backupDir === '' ? path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'backups') : settings.backupDir
}

export function listBackups(settings) {
  try {
    const dir = backupDirOf(settings)
    const names = fs.readdirSync(dir).filter((name) => /^config-\d+\.json$/.test(name))
    const out = []
    for (const name of names) {
      try {
        const stat = fs.statSync(path.join(dir, name))
        out.push({ name, at: Number(name.replace(/\D/g, '')) || 0, size: stat.size })
      } catch {
        /* 跳过读不到的 */
      }
    }
    out.sort((left, right) => right.at - left.at)
    return out
  } catch {
    return []
  }
}

export function backupNow(settings, now = Date.now()) {
  const dir = backupDirOf(settings)
  const name = 'config-' + String(now) + '.json'
  const file = path.join(dir, name)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: packageVersion(), at: now, values: settings }, null, 2))
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  for (const item of listBackups(settings).slice(BACKUP_KEEP)) {
    try {
      fs.unlinkSync(path.join(dir, item.name))
    } catch {
      /* 清不掉就算了 */
    }
  }
  return { ok: true, dir, name, at: now }
}

export function readBackup(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && parsed.values !== null && typeof parsed.values === 'object') return parsed
    return null
  } catch {
    return null
  }
}

function pickKnownSettings(values, base) {
  const patch = {}
  for (const key of Object.keys(base)) {
    if (values[key] !== undefined) patch[key] = values[key]
  }
  return patch
}

function registerBackupRoute(ctx, getSettings) {
  const route = {
    kind: 'exact',
    path: BACKUP_ROUTE,
    handler: async (req, res) => {
      const settings = getSettings()
      const reply = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      const url = new URL(req.url ?? BACKUP_ROUTE, 'http://127.0.0.1')
      if (req.method === 'GET') {
        if (url.searchParams.get('download') === '1') {
          const body = JSON.stringify({ version: packageVersion(), at: Date.now(), values: settings }, null, 2)
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': 'attachment; filename="dsh-reminder-notify-config.json"',
            'cache-control': 'no-store',
          })
          res.end(body)
          return
        }
        const list = listBackups(settings)
        reply(200, { ok: true, enabled: settings.backupEnabled === true, dir: backupDirOf(settings), count: list.length, backups: list.slice(0, 10) })
        return
      }
      if (req.method !== 'POST') {
        reply(405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const body = await readJsonBody(req)
      const action = str(body?.action, 'save')
      const base = settingsOf({})
      if (action === 'save') {
        const made = backupNow(settings)
        reply(made.ok === true ? 200 : 500, { ...made, action: 'save', dir: backupDirOf(settings), count: listBackups(settings).length })
        return
      }
      if (action === 'restore') {
        const wanted = str(body?.name, '')
        const list = listBackups(settings)
        const picked = wanted === '' ? (list.length > 0 ? list[0] : null) : list.find((item) => item.name === wanted) ?? null
        if (picked === null) {
          reply(404, { ok: false, error: 'backup-not-found' })
          return
        }
        const doc = readBackup(path.join(backupDirOf(settings), picked.name))
        if (doc === null) {
          reply(400, { ok: false, error: 'backup-invalid' })
          return
        }
        backupNow(settings)
        const patch = pickKnownSettings(doc.values, base)
        await saveBalanceState(ctx, patch)
        reply(200, { ok: true, action: 'restore', name: picked.name, restored: Object.keys(patch).length })
        return
      }
      if (action === 'import') {
        const raw = str(body?.json, '')
        let parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch {
          parsed = null
        }
        if (parsed === null || typeof parsed !== 'object') {
          reply(400, { ok: false, error: 'json-invalid' })
          return
        }
        const values = parsed.values !== null && typeof parsed.values === 'object' ? parsed.values : parsed
        backupNow(settings)
        const patch = pickKnownSettings(values, base)
        if (Object.keys(patch).length === 0) {
          reply(400, { ok: false, error: 'no-known-keys' })
          return
        }
        await saveBalanceState(ctx, patch)
        reply(200, { ok: true, action: 'import', restored: Object.keys(patch).length })
        return
      }
      reply(400, { ok: false, error: 'unknown-action' })
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: backup route')
}

function registerStatsRoute(ctx, getSettings) {
  const route = {
    kind: 'exact',
    path: STATS_ROUTE,
    handler: async (req, res) => {
      const settings = getSettings()
      const reply = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      if (settings.statsEnabled !== true) {
        reply(200, { ok: true, enabled: false, package: NPM_PACKAGE })
        return
      }
      const url = new URL(req.url ?? STATS_ROUTE, 'http://127.0.0.1')
      const force = url.searchParams.get('refresh') === '1'
      const stats = await fetchNpmStats(settings, force)
      reply(200, { ok: true, enabled: true, package: NPM_PACKAGE, stats })
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: stats route')
}

function registerFeedbackRoute(ctx, getSettings) {
  const route = {
    kind: 'exact',
    path: FEEDBACK_ROUTE,
    handler: async (req, res) => {
      const settings = getSettings()
      const reply = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload))
      }
      const listOf = () => readFeedback(settings).slice(-20).reverse()
      if (settings.feedbackEnabled !== true) {
        reply(200, { ok: true, enabled: false, count: 0, entries: [] })
        return
      }
      if (req.method === 'GET') {
        const entries = listOf()
        reply(200, { ok: true, enabled: true, file: feedbackPathOf(settings), count: entries.length, entries })
        return
      }
      if (req.method !== 'POST') {
        reply(405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const body = await readJsonBody(req)
      if (body?.action === 'clear') {
        writeFeedbackAll(settings, [])
        reply(200, { ok: true, action: 'clear', count: 0, entries: [] })
        return
      }
      if (body?.action === 'delete') {
        const id = str(body?.id, '')
        const left = readFeedback(settings).filter((item) => item.id !== id)
        writeFeedbackAll(settings, left)
        const entries = left.slice(-20).reverse()
        reply(200, { ok: true, action: 'delete', count: entries.length, entries })
        return
      }
      const entry = feedbackEntryOf(body, Date.now())
      if (entry === null) {
        reply(400, { ok: false, error: 'empty-text' })
        return
      }
      if (appendFeedback(settings, entry) !== true) {
        reply(500, { ok: false, error: 'write-failed', file: feedbackPathOf(settings) })
        return
      }
      let issueUrl = ''
      if (body?.env === true) {
        issueUrl = issueUrlOf(settings.feedbackRepo, entry, envSummaryOf(settings, readHistory(settings), new Date()))
      }
      reply(200, { ok: true, entry, issueUrl, count: readFeedback(settings).length })
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: feedback route')
}

function registerRepliesRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: REPLIES_ROUTE,
    handler: async (req, res) => {
      const settings = getSettings()
      if (req.method === 'GET') {
        const list = repliesOf(settings, 20)
        reply(res, 200, { ok: true, count: list.length, replies: list })
        return
      }
      const body = await readJsonBody(req)
      if (body?.action === 'clear') {
        const kept = readHistory(settings).filter((entry) => entry.action !== 'replied')
        writeHistory(settings, kept)
        reply(res, 200, { ok: true, action: 'clear', left: 0 })
        return
      }
      reply(res, 200, { ok: true, replies: repliesOf(settings, 20) })
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: replies route')
}

function registerHistoryRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: HISTORY_ROUTE,
    handler: async (req, res) => {
      try {
        const settings = getSettings()
        const method = (req.method ?? 'GET').toUpperCase()
        if (method === 'GET') {
          const entries = readHistory(settings)
          return reply(res, 200, {
            ok: true,
            enabled: settings.historyEnabled,
            file: historyPathOf(settings),
            stats: historyStats(entries),
            entries: entries.slice(-50).reverse(),
          })
        }
        if (method !== 'POST') return reply(res, 405, { ok: false, error: 'use GET or POST' })
        const body = await readJsonBody(req)
        if (body !== null && typeof body === 'object' && body.mode === 'clear') {
          writeHistory(settings, [])
          return reply(res, 200, { ok: true, cleared: true, file: historyPathOf(settings) })
        }
        return reply(res, 400, { ok: false, error: 'unknown mode' })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: history route')
}

/** Host 服务名：别的插件用 ctx.get('reminder') 拿它。 */
export const SERVICE_NAME = 'reminder'

// ===== 0.18.0：条件提醒、原生系统通知、托盘与热键 =====

const TOAST_SCRIPT = path.join(PACKAGE_ROOT, 'host', 'ToastHost.ps1')
const TRAY_SCRIPT = path.join(PACKAGE_ROOT, 'host', 'TrayHost.ps1')
const TRAY_ROUTE = '/dsh-reminder-notify/tray'

/** 读取托盘状态（静音 / 免打扰）。按 mtime 缓存，弹卡前读一次也不会拖慢。 */
const trayCache = { file: '', mtime: 0, state: { muted: false, quiet: false } }

export function trayStatePathOf(settings) {
  const custom = str(settings?.trayStateFile, '')
  if (custom !== '') return path.resolve(custom)
  return path.join(os.homedir(), '.dsh', 'dsh-reminder-notify', 'tray-state.json')
}

export function readTrayState(settings) {
  const file = trayStatePathOf(settings)
  try {
    const stat = fs.statSync(file)
    if (trayCache.file === file && trayCache.mtime === stat.mtimeMs) return trayCache.state
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const state = { muted: parsed?.muted === true, quiet: parsed?.quiet === true }
    trayCache.file = file
    trayCache.mtime = stat.mtimeMs
    trayCache.state = state
    return state
  } catch {
    return { muted: false, quiet: false }
  }
}

export function writeTrayState(settings, patch) {
  const file = trayStatePathOf(settings)
  const current = readTrayState(settings)
  const next = {
    muted: patch?.muted === undefined ? current.muted : patch.muted === true,
    quiet: patch?.quiet === undefined ? current.quiet : patch.quiet === true,
    at: Date.now(),
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next), 'utf8')
  trayCache.file = file
  trayCache.mtime = fs.statSync(file).mtimeMs
  trayCache.state = next
  return next
}

/** 原生通知的参数（纯函数，方便单测）。 */
export function toastArgsOf(settings, kind, title, message) {
  return {
    scriptPath: TOAST_SCRIPT,
    title,
    message,
    seconds: Math.round(clamp(num(settings?.toastSeconds, 8), 3, 60)),
    icon: kind === 'decide' ? 'Warning' : 'Information',
  }
}

function sendToast(settings, payload) {
  try {
    if (!fs.existsSync(payload.scriptPath)) return false
    const argv = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', payload.scriptPath,
      '-Title', payload.title, '-Msg', payload.message,
      '-Seconds', String(payload.seconds), '-Icon', payload.icon,
    ]
    const child = spawn(settings.powershellPath, argv, {
      cwd: PACKAGE_ROOT,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// ---- 托盘进程 ----
let trayChild = null

export function trayStatusOf(settings) {
  return {
    running: trayChild !== null && trayChild.exitCode === null,
    pid: trayChild !== null && trayChild.exitCode === null ? trayChild.pid : null,
    hotkey: settings.trayHotkey,
    stateFile: trayStatePathOf(settings),
    state: readTrayState(settings),
    script: TRAY_SCRIPT,
  }
}

function startTray(settings) {
  if (trayChild !== null && trayChild.exitCode === null) return trayStatusOf(settings)
  if (!fs.existsSync(TRAY_SCRIPT)) return { ...trayStatusOf(settings), error: 'tray-script-not-found' }
  const argv = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', TRAY_SCRIPT,
    '-HostScript', path.resolve(settings.scriptPath),
    '-AudioDir', path.resolve(settings.audioDir),
    '-StateFile', trayStatePathOf(settings),
    '-Hotkey', settings.trayHotkey,
    '-Log', path.join(os.tmpdir(), 'dsh-reminder-notify-tray.log'),
  ]
  try {
    trayChild = spawn(settings.powershellPath, argv, {
      cwd: PACKAGE_ROOT,
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    trayChild.on('error', () => {})
    trayChild.on('exit', () => {
      trayChild = null
    })
    trayChild.unref()
  } catch {
    trayChild = null
  }
  return trayStatusOf(settings)
}

function stopTray(settings) {
  try {
    if (trayChild !== null) {
      trayChild.kill()
      trayChild = null
    }
  } catch {
    /* 已经退出就算了 */
  }
  return trayStatusOf(settings)
}

// ---- 条件提醒 ----
export function parseCondState(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 条件提醒判定（纯函数）：返回「现在该弹」的规则列表，空数组表示不弹。
 * snapshot: { balance, queueLength, hostFailures, todayCount }
 */
export function evaluateConditions(settings, snapshot = {}, now = new Date()) {
  if (settings?.conditionsEnabled === false) return []
  const state = parseCondState(settings?.condState)
  const cooldownMs = Math.max(0, num(settings?.condCooldownMinutes, 120)) * 60 * 1000
  const stamp = now.getTime()
  const cooled = (id) => {
    if (cooldownMs === 0) return true
    const at = num(state?.[id]?.at, 0)
    return at === 0 || stamp - at >= cooldownMs
  }
  const fired = []

  if (settings?.condBalanceBelow === true && settings?.balanceEnabled === true) {
    const balance = num(snapshot.balance, 0)
    const baseline = num(settings.balanceBaseline, 0)
    const thresholds = parseThresholds(settings.balanceThresholds)
    const threshold = thresholds.length > 0 ? Math.min(...thresholds) : 0
    if (balance > 0 && baseline > 0 && threshold > 0) {
      const pct = Math.round((balance / baseline) * 1000) / 10
      if (pct <= threshold && cooled('balance-below')) {
        fired.push({
          id: 'balance-below',
          title: '余额快不够了',
          message: `DeepSeek 余额 ¥${balance.toFixed(2)}，是基线 ¥${baseline.toFixed(2)} 的 ${pct}%，已经低于 ${threshold}% 预警档。`,
        })
      }
    }
  }

  const backlog = Math.round(num(settings?.condQueueBacklog, 0))
  if (backlog > 0 && num(snapshot.queueLength, 0) >= backlog && cooled('queue-backlog')) {
    fired.push({
      id: 'queue-backlog',
      title: '提醒排队变长了',
      message: `现在有 ${snapshot.queueLength} 条提醒在排队（你设的阈值是 ${backlog} 条），可能是有卡一直没关。`,
    })
  }

  const hostLimit = Math.round(num(settings?.condHostFailures, 0))
  if (hostLimit > 0 && num(snapshot.hostFailures, 0) >= hostLimit && cooled('host-failures')) {
    fired.push({
      id: 'host-failures',
      title: '卡片老是弹不出来',
      message: `提醒宿主连续失败了 ${snapshot.hostFailures} 次。打开「插件 → 桌面提醒 → 高级 → 运行自检」看看是哪一项。`,
    })
  }

  const today = todayKey(now)
  if (settings?.condQuietEnter === true && inQuietHours(settings, now) && state?.['quiet-enter']?.date !== today) {
    fired.push({
      id: 'quiet-enter',
      title: '进入免打扰时段',
      message: `现在是 ${settings.quietStart}–${settings.quietEnd} 免打扰，这段时间的提醒会${settings.quietMode === 'skip' ? '直接丢掉' : '等时段结束再补弹'}。`,
      date: today,
    })
  }

  const dailyLimit = Math.round(num(settings?.condDailyCount, 0))
  if (dailyLimit > 0 && num(snapshot.todayCount, 0) >= dailyLimit && state?.['daily-count']?.date !== today) {
    fired.push({
      id: 'daily-count',
      title: '今天的提醒有点多',
      message: `今天已经弹了 ${snapshot.todayCount} 条提醒，超过你设的 ${dailyLimit} 条。`,
      date: today,
    })
  }

  return fired
}

/** 把刚触发的条件写回 condState（JSON 字符串）。 */
export function condStateAfter(settings, fired, now = new Date()) {
  const state = parseCondState(settings?.condState)
  const stamp = now.getTime()
  for (const item of fired) {
    const previousDate = state?.[item.id]?.date ?? ''
    state[item.id] = { at: stamp, date: item.date ?? previousDate }
  }
  return JSON.stringify(state)
}

export function conditionSnapshotOf(settings, now = new Date()) {
  const entries = readHistory(settings)
  const today = todayKey(now)
  return {
    balance: num(balanceState.balance, 0),
    queueLength: queue.length + (active !== null ? 1 : 0),
    hostFailures: num(hostHealth.failureCount, 0),
    todayCount: entries.filter((entry) => dayKeyOf(num(entry?.at, 0)) === today).length,
  }
}

function registerConditionLoop(ctx, getSettings) {
  let running = false
  const tick = async () => {
    if (running) return
    const settings = getSettings()
    if (settings.conditionsEnabled === false) return
    running = true
    try {
      const now = new Date()
      const fired = evaluateConditions(settings, conditionSnapshotOf(settings, now), now)
      if (fired.length === 0) return
      await saveBalanceState(ctx, { condState: condStateAfter(settings, fired, now) })
      for (const item of fired) {
        await notify('raw', { title: item.title, message: item.message, seconds: 40 }, getSettings()).catch(() => {})
      }
    } catch {
      /* 条件判定出错不影响下一轮 */
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 60 * 1000)
  if (typeof timer?.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'dsh-reminder-notify: condition watcher')
}

function registerTrayRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: TRAY_ROUTE,
    handler: async (req, res) => {
      try {
        const settings = getSettings()
        const method = (req.method ?? 'GET').toUpperCase()
        if (method === 'GET') return reply(res, 200, { ok: true, tray: trayStatusOf(settings) })
        if (method !== 'POST') return reply(res, 405, { ok: false, error: 'use GET or POST' })
        const body = await readJsonBody(req)
        const action = str(body?.action, 'status')
        if (action === 'start') return reply(res, 200, { ok: true, action, tray: startTray(settings) })
        if (action === 'stop') return reply(res, 200, { ok: true, action, tray: stopTray(settings) })
        if (action === 'mute' || action === 'quiet') {
          const value = body?.value === true
          const state = writeTrayState(settings, action === 'mute' ? { muted: value } : { quiet: value })
          return reply(res, 200, { ok: true, action, state, tray: trayStatusOf(settings) })
        }
        if (action === 'toast') {
          const sent = sendToast(settings, toastArgsOf(settings, 'raw', '原生通知自检', '能看到这条系统通知，就说明原生通知能用。'))
          return reply(res, 200, { ok: true, action, sent })
        }
        return reply(res, 200, { ok: true, action, tray: trayStatusOf(settings) })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: tray route')
}

function registerRecurringRoute(ctx, getSettings) {
  const reply = (res, status, payload) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }
  const route = {
    kind: 'exact',
    path: RECUR_ROUTE,
    handler: async (req, res) => {
      try {
        const settings = getSettings()
        const method = (req.method ?? 'GET').toUpperCase()
        if (method === 'GET') {
          const jobs = readRecurring(settings).map(publicRecurring)
          return reply(res, 200, { ok: true, enabled: settings.recurringEnabled, count: jobs.length, jobs })
        }
        if (method !== 'POST') return reply(res, 405, { ok: false, error: 'use GET or POST' })
        const body = await readJsonBody(req)
        const action = str(body?.action, 'list')
        if (action === 'cancel') {
          const id = str(body?.id, '')
          const list = readRecurring(settings)
          const left = list.filter((job) => job.id !== id)
          writeRecurring(settings, left)
          return reply(res, 200, { ok: true, action, removed: list.length - left.length, count: left.length })
        }
        if (action === 'cancel-all') {
          const list = readRecurring(settings)
          writeRecurring(settings, [])
          return reply(res, 200, { ok: true, action, removed: list.length, count: 0 })
        }
        const jobs = readRecurring(settings).map(publicRecurring)
        return reply(res, 200, { ok: true, action, count: jobs.length, jobs })
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  mountRoute(ctx, route, 'dsh-reminder-notify: recurring route')
}

// 周期提醒：每 30 秒看一次，到点的先弹卡，再按周期排下一次；times 用完就删。
function registerRecurringLoop(ctx, getSettings) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const settings = getSettings()
      if (settings.recurringEnabled !== true) return
      const list = readRecurring(settings)
      if (list.length === 0) return
      const now = Date.now()
      const keep = []
      let changed = false
      for (const job of list) {
        const dueAt = num(job?.nextAt, 0)
        if (!(dueAt > 0) || dueAt > now) {
          keep.push(job)
          continue
        }
        const jobSettings = getSettings()
        await notify(
          job.kind,
          { title: job.title, message: job.message, seconds: job.seconds, sound: job.sound, url: job.url },
          { ...jobSettings, quietEnabled: jobSettings.quietEnabled },
        ).catch(() => {})
        changed = true
        const remaining = job.remaining > 0 ? job.remaining - 1 : 0
        if (job.remaining > 0 && remaining <= 0) continue
        keep.push({ ...job, remaining, nextAt: nextRunAfter(dueAt, job.everyMinutes, Date.now()) })
      }
      if (changed) writeRecurring(settings, keep)
    } catch {
      /* 周期提醒出错不影响下一轮 */
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick()
  }, 30 * 1000)
  if (typeof timer?.unref === 'function') timer.unref()
  ctx.effect(() => () => clearInterval(timer), 'dsh-reminder-notify: recurring watcher')
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

/**
 * 0.15 起对外提供的服务：让别的插件也能发提醒、发日报、读统计，而不用自己起宿主。
 * 全部方法是 fire-and-forget 语义（返回 Promise，失败只在返回值里体现），不会抛给调用方。
 */
const serviceEvents = []
const sourceHandlers = new Map()

// 0.17：服务契约升到 2 —— 版本号、事件流、以及「别的插件也能注册提醒来源」。
export function emitServiceEvent(type, payload = {}) {
  const event = { type, at: Date.now(), payload }
  serviceEvents.push(event)
  if (serviceEvents.length > 60) serviceEvents.shift()
  for (const handler of sourceHandlers.values()) {
    try {
      handler(event)
    } catch {
      // 别人的 handler 崩了不该影响弹卡
    }
  }
  return event
}

export function serviceOf(ctx, getSettings) {
  return {
    name: 'dsh-reminder-notify',
    version: packageVersion(),
    // 0.17：契约第 2 版 —— 多了事件流与「别的插件也能注册提醒来源」。
    apiVersion: 2,
    events: () => serviceEvents.slice(-20),
    registerSource: (name, handler) => {
      const key = String(name ?? '').trim() || `source-${sourceHandlers.size + 1}`
      sourceHandlers.set(key, typeof handler === 'function' ? handler : () => {})
      return () => sourceHandlers.delete(key)
    },
    /** 发一张提醒卡。kind: done | decide | raw；options 同 notify_user 的参数。 */
    notify: (kind, options = {}) => notify(nodeKind(kind), options || {}, getSettings()),
    /** 立刻发一条日报（force: true 时忽略「今天已经发过」和「日报未开启」）。 */
    digest: (options = {}) => runDigest(ctx, getSettings, { force: (options || {}).force === true }),
    /** 提醒历史统计（不弹卡、不写文件）。 */
    stats: () => historyStats(readHistory(getSettings())),
    /** 用户在卡片上回的话（最近 limit 条，新的在前）。 */
    replies: (limit = 20) => repliesOf(getSettings(), limit),
    /** 当前生效的配置快照（只读副本）。 */
    config: () => ({ ...getSettings() }),
  }
}

function nodeKind(kind) {
  return kind === 'decide' || kind === 'raw' ? kind : 'done'
}

export function apply(ctx, config) {
  const getSettings = () => settingsOf({ ...config, ...runtimePatch })
  // 0.33：每天自动留一份配置备份（同一天不重复写）。
  try {
    const bootSettings = getSettings()
    if (bootSettings.backupEnabled === true) {
      const midnight = Date.parse(todayKey() + 'T00:00:00')
      if (Number.isFinite(midnight) && listBackups(bootSettings).every((item) => item.name !== 'config-' + String(midnight) + '.json')) {
        backupNow(bootSettings, midnight)
      }
    }
  } catch {
    /* 备份失败不影响插件启动 */
  }
  // 0.31.1：启动时若历史里今天已有日报，先把日期补上，避免重启/装完后连弹。
  try {
    const bootSettings = getSettings()
    if (bootSettings.digestEnabled === true) {
      const entries = readHistory(bootSettings)
      if (digestShownToday(bootSettings, entries)) runtimePatch.digestLastDate = todayKey()
    }
  } catch {}

  if (typeof ctx.provide === 'function') {
    // 服务在 apply 里一次性注册；ctx.provide 自己挂在本 fiber 上，插件卸载时会自动回收。
    ctx.provide(SERVICE_NAME, serviceOf(ctx, getSettings))
  } else {
    ctx.logger?.warn?.('dsh-reminder-notify: ctx.provide is unavailable, the reminder service was not provided')
  }
  registerAudioRoute(ctx, () => settingsOf(config))
  registerConfigRoute(ctx, () => settingsOf(config))
  registerPreviewRoute(ctx, () => settingsOf(config))
  registerBalanceRoute(ctx, () => settingsOf(config), config)
  registerHistoryRoute(ctx, () => settingsOf(config))
  registerExportRoute(ctx, () => settingsOf(config))
  registerDigestRoute(ctx, () => settingsOf(config))
  registerDigestLoop(ctx, () => settingsOf(config))
  registerConditionLoop(ctx, () => settingsOf(config))
  registerTrayRoute(ctx, () => settingsOf(config))
  registerRecurringRoute(ctx, () => settingsOf(config))
  registerRecurringLoop(ctx, () => settingsOf(config))
  registerRepliesRoute(ctx, () => settingsOf(config))
  registerMobileRoute(ctx, () => settingsOf(config))
  registerMobileAssets(ctx, () => settingsOf(config))
  registerStatsRoute(ctx, () => settingsOf(config))
  registerFeedbackRoute(ctx, () => settingsOf(config))
  registerBackupRoute(ctx, () => settingsOf(config))
  {
    let proxy = null
    const ensureHttps = () => {
      const enabled = settingsOf(config).httpsEnabled === true
      if (enabled) {
        if (proxy === null) proxy = startHttpsProxy(ctx, () => settingsOf(config))
        return
      }
      if (proxy !== null) {
        try { proxy.close() } catch {}
        proxy = null
      }
    }
    ctx.effect(() => {
      ensureHttps()
      const timer = setInterval(ensureHttps, 5000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => {
        clearInterval(timer)
        if (proxy !== null) { try { proxy.close() } catch {} proxy = null }
      }
    }, 'dsh-reminder-notify: mobile https proxy')
  }
  const promptService = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
  if (promptService !== undefined && typeof promptService.context === 'function') {
    ctx.effect(
      () =>
        promptService.context({
          name: 'dsh-reminder-notify:phone-replies',
          order: 880,
          text: () => phonePromptText(settingsOf(config)),
        }),
      'dsh-reminder-notify: phone replies prompt',
    )
    ctx.effect(
      () =>
        promptService.context({
          name: 'dsh-reminder-notify:card-choices',
          order: 881,
          text: () => choicePromptText(settingsOf(config)),
        }),
      'dsh-reminder-notify: card choices prompt',
    )
  }
  registerDoctorRoute(ctx, () => settingsOf(config))
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: tools service is unavailable, notify_user was not registered')
    return
  }
  // 托盘：打开了就随插件一起起来；插件卸载时一并收掉。
  if (settingsOf(config).trayEnabled === true) {
    startTray(settingsOf(config))
    ctx.effect(() => () => stopTray(settingsOf(config)), 'dsh-reminder-notify: tray host')
  }
  const definition = toolDefinition(() => settingsOf(config), ctx)
  const dispose = tools.register(definition)
  ctx.effect(() => dispose, 'dsh-reminder-notify: notify_user tool')
}
