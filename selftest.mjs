// 自检：不启动 DSH，用假 ctx 把插件当普通模块跑一遍，真的弹一次提醒。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply, checkBalance, listAudioFiles, parseThresholds, previewAudio } from './index.js'

let captured
function makeCtx(sink) {
  return {
    get(name) {
      if (name === 'tools') {
        return {
          register(definition) {
            sink(definition)
            return () => {}
          },
        }
      }
      // webServer 不在自检里模拟：插件会打一条 warn 然后跳过路由注册。
      return undefined
    },
    effect: (fn) => fn(),
    logger: console,
  }
}
const ctx = makeCtx((definition) => {
  captured = definition
})

import os from 'node:os'
import path from 'node:path'
const historyFile = path.join(os.tmpdir(), 'drn-selftest-history.json')
try { fs.unlinkSync(historyFile) } catch {}
apply(ctx, { seconds: 4, position: 'br', sound: true, cooldownMs: 1500, historyFile })
if (!captured) throw new Error('tool was not registered')
console.log('registered:', captured.name, '| params:', Object.keys(captured.parameters.properties).join(','))

const out = await captured.execute({ kind: 'done', message: '插件自检：notify_user 已经能弹窗了。' })
console.log('execute ->', out)

const second = await captured.execute({ kind: 'done', message: '应该被冷却拦下' })
console.log('cooldown ->', second)

const raw = await captured.execute({ kind: 'raw', title: '自检 raw', message: 'raw 档位，不带语音。', sound: false, seconds: 5 })
console.log('raw ->', raw)

// 队列 / 合并：第一张卡还在屏上时，同档位的第二条应该并进排队中的那一条。
const burstA = JSON.parse(await captured.execute({ kind: 'decide', message: '排队 A', sound: false }))
// 等过冷却窗口（1500ms）、但仍在合并窗口（3000ms）内，验证"合并"而不是"被冷却拦下"
await new Promise((resolve) => setTimeout(resolve, 1700))
const burstB = JSON.parse(await captured.execute({ kind: 'decide', message: '排队 B', sound: false }))
console.log('queue ->', burstA.queued, burstA.position_in_queue, '|', burstB.merged, burstB.count)
if (burstA.queued !== true) throw new Error('第二张卡没有排队：' + JSON.stringify(burstA))
if (burstB.merged !== true || burstB.count !== 2) throw new Error('同档位没有合并：' + JSON.stringify(burstB))

// 历史：第一张卡自动关掉时会把 action 写进历史文件。
const historyDeadline = Date.now() + 25000
let entries = []
while (Date.now() < historyDeadline) {
  try {
    entries = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
  } catch {
    entries = []
  }
  if (entries.length > 0) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}
if (entries.length === 0) throw new Error('历史里没有记录：' + historyFile)
if (!['timeout', 'dismiss', 'ok', 'snooze'].includes(entries[0].action)) {
  throw new Error('历史 action 不对：' + JSON.stringify(entries[0]))
}
console.log('history ok', entries.length, '|', entries[0].action, '|', entries[0].kind)

// 模板：标题加档位前缀、正文追加时间；两处占位符都应在结果里被替换掉。
let templated
apply(
  makeCtx((d) => {
    templated = d
  }),
  {
    seconds: 5,
    position: 'br',
    sound: false,
    cooldownMs: 0,
    dryRun: true,
    titleTemplate: '[{kind}] {title}',
    messageTemplate: '{message}（{time}）',
  },
)
const tpl = JSON.parse(await templated.execute({ kind: 'done', message: '模板正文', sound: false }))
console.log('template ->', tpl.title, '|', tpl.message)
if (!/^\[done\]/.test(tpl.title)) throw new Error('titleTemplate 没有生效')
if (!/^模板正文（\d{2}:\d{2}）$/.test(tpl.message)) throw new Error('messageTemplate 没有生效')
console.log('template ok')

// 按档位覆盖：done 用 doneCardBackground，decide 没配就退回通用 cardBackground。
let perKind
apply(
  makeCtx((d) => {
    perKind = d
  }),
  {
    seconds: 5,
    position: 'br',
    sound: false,
    cooldownMs: 0,
    dryRun: true,
    cardBackground: 'assets/提示音导入/完成提醒语音.wav',
    doneCardBackground: 'assets/提示音导入/需要你来决定.wav',
  },
)
const doneCard = JSON.parse(await perKind.execute({ kind: 'done', message: '按档位覆盖', sound: false }))
if (!/需要你来决定\.wav$/.test(String(doneCard.background))) throw new Error('done 档位没有用 doneCardBackground')
const decideCard = JSON.parse(await perKind.execute({ kind: 'decide', message: '退回通用背景', sound: false }))
if (!/完成提醒语音\.wav$/.test(String(decideCard.background))) throw new Error('decide 档位没有退回通用 cardBackground')
console.log('per-kind ok', doneCard.background, '|', decideCard.background)

// 按档位模板：done 用 doneTitleTemplate，decide 没配就退回通用 titleTemplate。
let perKindTpl
apply(
  makeCtx((d) => {
    perKindTpl = d
  }),
  {
    seconds: 5,
    position: 'br',
    sound: false,
    cooldownMs: 0,
    dryRun: true,
    titleTemplate: '通用 {title}',
    doneTitleTemplate: '完成啦 → {title}',
    messageTemplate: '{message}',
    decideMessageTemplate: '要你决定：{message}',
  },
)
const doneTpl = JSON.parse(await perKindTpl.execute({ kind: 'done', message: '收工', sound: false }))
if (!doneTpl.title.startsWith('完成啦 → ')) throw new Error('done 档位没有用 doneTitleTemplate')
const decideTpl = JSON.parse(await perKindTpl.execute({ kind: 'decide', message: '选一个', sound: false }))
if (decideTpl.title !== '通用 ' + decideTpl.title.slice(3)) throw new Error('decide 档位没有退回通用 titleTemplate')
if (decideTpl.message !== '要你决定：选一个') throw new Error('decide 档位没有用 decideMessageTemplate')
console.log('per-kind-template ok', doneTpl.title, '|', decideTpl.title, '|', decideTpl.message)

// 音频目录扫描：Host 路由的 data 来源，按扩展名过滤并且稳定排序。
const scanned = listAudioFiles(fileURLToPath(new URL('./assets/提示音导入', import.meta.url)))
if (!Array.isArray(scanned.files) || scanned.files.length === 0) throw new Error('音频目录扫描没有返回文件：' + JSON.stringify(scanned))
if (!scanned.files.every((name) => /\.(wav|mp3|ogg|m4a|flac|aac|wma)$/i.test(name))) throw new Error('扫描结果混进了非音频文件：' + scanned.files.join(','))
console.log('audio-scan ok', scanned.files.join(' | '))

// volatile 包装回归：宿主给插件的 config 字段是 { get() } 热更新包装，
// settingsOf() 必须解包，否则字符串会变成 "[object Object]"。
const { Config } = await import("./index.js")
if (Config === undefined) throw new Error("Config 没有导出，插件页不会有设置面板")
// cooldownMs: 0 —— 同档位冷却表是模块级的，前面刚跑过 done 档位，留着 1500ms 会把它拦成 skipped。
const liveConfig = Config({ seconds: 90, sound: true, doneAudio: "完成提醒语音.wav", titleTemplate: "热更 {title}", dryRun: true, cooldownMs: 0 })
if (typeof liveConfig.seconds?.get !== "function") throw new Error("Config 字段没有 volatile 包装，插件页拿不到设置面板")
let live
apply(
  makeCtx((d) => {
    live = d
  }),
  liveConfig,
)
const liveOut = JSON.parse(await live.execute({ kind: "done", message: "热更新" }))
if (liveOut.seconds !== 90) throw new Error("volatile 字段没有解包：seconds=" + JSON.stringify(liveOut.seconds))
if (!/完成提醒语音\.wav$/.test(String(liveOut.audio))) throw new Error("volatile 字段没有解包：audio=" + String(liveOut.audio))
if (liveOut.title !== "热更 Harness 已完成工作") throw new Error("volatile 模板没有生效：" + liveOut.title)
console.log("volatile ok", liveOut.seconds, "|", liveOut.audio, "|", liveOut.title)


// 试听接口的错误分支：没有配置音频 / 文件不存在，都要给出明确原因而不是起进程。
const missingAudio = await previewAudio('raw', { audioDir: fileURLToPath(new URL('./assets/提示音导入', import.meta.url)), rawAudio: '' })
if (missingAudio.ok !== false || missingAudio.error !== 'no-audio') throw new Error('空配置应该返回 no-audio：' + JSON.stringify(missingAudio))
const absentAudio = await previewAudio('done', { audioDir: fileURLToPath(new URL('./assets/提示音导入', import.meta.url)), doneAudio: '不存在.wav' })
if (absentAudio.ok !== false || absentAudio.error !== 'audio-not-found') throw new Error('缺失文件应该返回 audio-not-found：' + JSON.stringify(absentAudio))
console.log('preview ok', missingAudio.error, '|', absentAudio.error)


// 余额提醒：阈值解析 + 基线自动抬高 + 未启用时不提醒。
const th = parseThresholds('15，5, 15,abc')
if (JSON.stringify(th) !== '[15,5]') throw new Error('parseThresholds 结果不对：' + JSON.stringify(th))
if (JSON.stringify(parseThresholds('')) !== '[20,10,5]') throw new Error('parseThresholds 空值应回落到默认阈值')

const edits = []
function makeBalanceCtx(balances, { bonus = 0, accountId = 'user-a' } = {}) {
  const queue = Array.isArray(balances) ? [...balances] : [balances]
  const next = () => (queue.length > 1 ? queue.shift() : queue[0])
  return {
    get(name) {
      if (name === 'deepseekAccount') {
        return {
          getBalance: async () => ({
            status: 'ready',
            value: [{ currency: 'CNY', balance: String(next()) }],
            bonusWallets: bonus > 0 ? [{ currency: 'CNY', balance: String(bonus) }] : [],
          }),
          getProfile: async () => ({ status: 'ready', value: { id: accountId } }),
        }
      }
      if (name === 'configEditor') {
        return {
          edit: async (_entry, fn) => {
            edits.push(
              fn({
                balanceBaseline: balanceSettings.balanceBaseline,
                balanceBaselineAt: balanceSettings.balanceBaselineAt,
                balanceBaselineAccount: balanceSettings.balanceBaselineAccount,
                balanceBaselineSource: balanceSettings.balanceBaselineSource,
                balanceFired: balanceSettings.balanceFired,
              }),
            )
          },
        }
      }
      return undefined
    },
    fiber: { entry: {} },
    logger: console,
  }
}

const baseSettings = {
  balanceEnabled: false,
  balanceBaseline: 100,
  balanceThresholds: '20,10,5',
  balanceSpeak: false,
  balanceCheckMinutes: 30,
  balanceFired: 0,
  balanceBaselineAt: 0,
  balanceBaselineAccount: 'user-a',
  balanceBaselineSource: 'auto',
}
let balanceSettings = { ...baseSettings }

// 余额比基线高 → 抬基线、清空已报阈值，且不弹卡（enabled=false）。
balanceSettings = { ...baseSettings }
edits.length = 0
const raised = await checkBalance(makeBalanceCtx(150), () => balanceSettings)
if (raised.baseline !== 150) throw new Error('余额高于基线时应抬基线：' + JSON.stringify(raised))
if (edits.length === 0 || edits[0].balanceBaseline !== 150) throw new Error('抬基线没有写回配置：' + JSON.stringify(edits))
if (raised.pct !== 100) throw new Error('抬基线后百分比应为 100：' + raised.pct)

// 赠送金不参与基线（充值钱包 100 + 赠送 50 时，余额仍是 100，赠送只展示）。
balanceSettings = { ...baseSettings }
edits.length = 0
const withBonus = await checkBalance(makeBalanceCtx(100, { bonus: 50 }), () => balanceSettings)
if (withBonus.balance !== 100) throw new Error('赠送金不该并进余额：' + JSON.stringify(withBonus))
if (withBonus.bonus !== 50) throw new Error('赠送金应单独返回：' + JSON.stringify(withBonus))

// 换账号 → 旧基线作废，新基线取当前余额。
balanceSettings = { ...baseSettings }
edits.length = 0
const switched = await checkBalance(makeBalanceCtx(60, { accountId: 'user-b' }), () => balanceSettings)
if (switched.baseline !== 60) throw new Error('换账号后基线应重置为当前余额：' + JSON.stringify(switched))

// 跌破阈值但没启用 → 只算比例，不弹卡、不改 fired。
balanceSettings = { ...baseSettings }
edits.length = 0
const quiet = await checkBalance(makeBalanceCtx(8), () => balanceSettings)
if (quiet.pct !== 8) throw new Error('8/100 应算出 8%：' + quiet.pct)
if (quiet.firedNow !== null) throw new Error('未启用余额提醒时不该报：' + JSON.stringify(quiet))

// 刚抬升基线（30 分钟冷却内）→ 即使跌破阈值也不播报。
balanceSettings = { ...baseSettings, balanceEnabled: true, balanceBaselineAt: Date.now() }
edits.length = 0
const cooling = await checkBalance(makeBalanceCtx(8), () => balanceSettings)
if (cooling.firedNow !== null) throw new Error('冷却期内不该播报：' + JSON.stringify(cooling))
if (cooling.cooling !== true) throw new Error('应标记 cooling：' + JSON.stringify(cooling))

// 冷却已过 + 连续两次采样都在阈值下 → 播报最深一档。
balanceSettings = { ...baseSettings, balanceEnabled: true, balanceBaselineAt: Date.now() - 31 * 60 * 1000 }
edits.length = 0
const fired = await checkBalance(makeBalanceCtx([8, 8]), () => balanceSettings)
if (fired.firedNow !== 20) throw new Error('两次采样都在阈下时应报 20%：' + JSON.stringify(fired))

// 第一次在阈下、第二次回升 → 不播报（抖动降噪）。
balanceSettings = { ...baseSettings, balanceEnabled: true, balanceBaselineAt: Date.now() - 31 * 60 * 1000 }
edits.length = 0
const bounced = await checkBalance(makeBalanceCtx([8, 30]), () => balanceSettings)
if (bounced.firedNow !== null) throw new Error('第二次采样回升时不该播报：' + JSON.stringify(bounced))

console.log(
  'balance ok',
  th.join('/'),
  '| raise',
  raised.baseline,
  '| bonus',
  withBonus.bonus,
  '| switch',
  switched.baseline,
  '| pct',
  quiet.pct,
  '| fired',
  fired.firedNow,
)
