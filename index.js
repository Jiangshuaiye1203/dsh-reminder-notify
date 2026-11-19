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
  if (audioPath !== '' && !fs.existsSync(audioPath)) {
    // 音频缺失不该让提醒消失：退回静音，正文照常弹。
    return await fireScript(settings, title, message, seconds, kind, '', false, scriptPath, audioPath)
  }
  return await fireScript(settings, title, message, seconds, kind, audioPath, sound, scriptPath, '')
}

async function fireScript(settings, title, message, seconds, kind, audioPath, sound, scriptPath, missingAudio) {
  const extras = appearanceOf(kind, settings)
  const argv = argvOfScriptHost(title, message, seconds, settings.position, accentOf(kind, settings), audioPath, sound, extras)
  argv[argv.indexOf(null)] = scriptPath
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

export function apply(ctx, config) {
  registerAudioRoute(ctx, () => settingsOf(config))
  registerConfigRoute(ctx, () => settingsOf(config))
  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    ctx.logger?.warn?.('dsh-reminder-notify: tools service is unavailable, notify_user was not registered')
    return
  }
  const definition = toolDefinition(() => settingsOf(config))
  const dispose = tools.register(definition)
  ctx.effect(() => dispose, 'dsh-reminder-notify: notify_user tool')
}
