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
})

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLED_HOST_SCRIPT = path.join(PACKAGE_ROOT, 'host', 'ReminderHost.ps1')
const BUNDLED_CLIENT_DIR = path.join(PACKAGE_ROOT, 'assets')
const BUNDLED_AUDIO_DIR = path.join(PACKAGE_ROOT, 'assets', '提示音导入')
const EXE_NAME = 'Harness完成提醒.exe'
const AUDIO_SUBDIR = '提示音导入'

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

function argvOfScriptHost(title, message, seconds, position, accent, audioPath, sound, extras) {
  const argv = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    null, // 由调用方填入脚本路径
    '-Title',
    psSafe(title),
    '-Msg',
    psSafe(message),
    '-Seconds',
    String(seconds),
    '-Pos',
    position,
    '-Accent',
    accent,
  ]
  if (sound && audioPath !== '') argv.push('-Audio', audioPath)
  else argv.push('-NoSound')
  if (extras && extras.background) argv.push('-Background', extras.background)
  if (extras && extras.icon) argv.push('-Icon', extras.icon)
  return argv
}

async function notify(kind, args, settings) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'only-windows', detail: '桌面提醒只能在本机 Windows 上弹出' }
  }

  const plainTitle = str(args.title, DEFAULT_TITLES[kind])
  const plainMessage = str(args.message, DEFAULT_MESSAGES[kind])
  const vars = { title: plainTitle, message: plainMessage, kind, time: clockText(new Date()) }
  // 档位模板优先：留空就退回上面的通用模板，两层都空才落到 "{title}" / "{message}"。
  const kindTitleTemplate = str(settings[`${kind}TitleTemplate`], '')
  const kindMessageTemplate = str(settings[`${kind}MessageTemplate`], '')
  const title = renderTemplate(kindTitleTemplate !== '' ? kindTitleTemplate : settings.titleTemplate, '{title}', vars)
  const message = renderTemplate(kindMessageTemplate !== '' ? kindMessageTemplate : settings.messageTemplate, '{message}', vars)
  const seconds = Math.round(clamp(num(args.seconds, settings.seconds), 2, 600))
  const sound = args.sound === false ? false : settings.sound
  const audio = audioNameOf(kind, settings)

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
  const audioPath = sound && audio !== '' ? path.join(audioDir, audio) : ''
  const speak = str(args.speak, '')
  if (audioPath !== '' && !fs.existsSync(audioPath)) {
    // 音频缺失不该让提醒消失：退回静音，正文照常弹。
    return await fireScript(settings, title, message, seconds, kind, '', false, scriptPath, audioPath, speak)
  }
  return await fireScript(settings, title, message, seconds, kind, audioPath, sound, scriptPath, '', speak)
}

async function fireScript(settings, title, message, seconds, kind, audioPath, sound, scriptPath, missingAudio, speak) {
  const extras = appearanceOf(kind, settings)
  const argv = argvOfScriptHost(title, message, seconds, settings.position, accentOf(kind, settings), audioPath, sound, extras)
  argv[argv.indexOf(null)] = scriptPath
  if (typeof speak === 'string' && speak !== '') argv.push('-Speak', psSafe(speak))
  try {
    const { pid, exited } = await launch(settings.powershellPath, argv, PACKAGE_ROOT)
    // Add-Type 编译 C# 需要几百毫秒，所以等 900ms 才能发现「参数错、起不来」的情况。
    const early = await Promise.race([exited, new Promise((r) => setTimeout(() => r('running'), 900))])
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
      audioMissing: missingAudio !== '' ? missingAudio : undefined,
      background: extras.background !== '' ? extras.background : null,
      icon: extras.icon !== '' ? extras.icon : null,
      pid,
      host: scriptPath,
      earlyExit: early === 'running' ? null : early,
    }
  } catch (error) {
    return { ok: false, error: 'spawn-failed', detail: String(error && error.message ? error.message : error) }
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
  },
}

function toolDefinition(getSettings) {
  return {
    name: 'notify_user',
    description:
      "Pop a native desktop reminder (voice + toast, bottom-right, auto-dismiss, never steals focus) on the user's Windows screen, then return immediately. " +
      'It renders the card with the system PowerShell + WinForms host shipped in this plugin, so nothing is downloaded and no unsigned exe is involved. ' +
      'Use kind="done" when a piece of work is finished and handed off, and kind="decide" before asking the user to approve or choose something. ' +
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
      return JSON.stringify(result)
    },
  }
}

const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.aac', '.wma']
const AUDIO_ROUTE = '/dsh-reminder-notify/audio'
const CONFIG_ROUTE = '/dsh-reminder-notify/config'
const PREVIEW_ROUTE = '/dsh-reminder-notify/preview'
const BALANCE_ROUTE = '/dsh-reminder-notify/balance'

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
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (web === undefined || web === null || typeof web.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: webServer is unavailable, the audio list dropdown stays manual-entry only')
    return
  }
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
  ctx.effect(() => {
    const dispose = web.register(route)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-reminder-notify: audio list route')
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
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (web === undefined || web === null || typeof web.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: webServer is unavailable, the settings panel stays read-only')
    return
  }
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
  ctx.effect(() => {
    const dispose = web.register(route)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-reminder-notify: settings route')
}

function registerPreviewRoute(ctx, getSettings) {
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (web === undefined || web === null || typeof web.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: webServer is unavailable, the preview buttons stay hidden')
    return
  }
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
        const result = await previewAudio(kind, getSettings())
        if (result.ok) return reply(res, 200, result)
        const status = result.error === 'no-audio' || result.error === 'audio-not-found' ? 400 : 500
        return reply(res, status, result)
      } catch (error) {
        return reply(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }
  ctx.effect(() => {
    const dispose = web.register(route)
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-reminder-notify: preview route')
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
async function saveBalanceState(ctx, patch) {
  const entry = ctx.fiber?.entry
  const editor = typeof ctx.get === 'function' ? ctx.get('configEditor') : undefined
  if (entry === undefined || editor === undefined || typeof editor.edit !== 'function') return false
  try {
    await editor.edit(entry, (current) => ({ ...current, ...patch }))
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
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
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
  if (web !== undefined && web !== null && typeof web.register === 'function') {
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
    ctx.effect(() => {
      const dispose = web.register(route)
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }, 'dsh-reminder-notify: balance route')
  } else {
    ctx.logger?.warn?.('dsh-reminder-notify: webServer is unavailable, the balance card stays read-only')
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

export function apply(ctx, config) {
  registerAudioRoute(ctx, () => settingsOf(config))
  registerConfigRoute(ctx, () => settingsOf(config))
  registerPreviewRoute(ctx, () => settingsOf(config))
  registerBalanceRoute(ctx, () => settingsOf(config), config)
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: tools service is unavailable, notify_user was not registered')
    return
  }
  const definition = toolDefinition(() => settingsOf(config))
  const dispose = tools.register(definition)
  ctx.effect(() => dispose, 'dsh-reminder-notify: notify_user tool')
}
