// 自检：不启动 DSH，用假 ctx 把插件当普通模块跑一遍，真的弹一次提醒。
import { fileURLToPath } from 'node:url'
import { apply, listAudioFiles } from './index.js'

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

apply(ctx, { seconds: 8, position: 'br', sound: true, cooldownMs: 1500 })
if (!captured) throw new Error('tool was not registered')
console.log('registered:', captured.name, '| params:', Object.keys(captured.parameters.properties).join(','))

const out = await captured.execute({ kind: 'done', message: '插件自检：notify_user 已经能弹窗了。' })
console.log('execute ->', out)

const second = await captured.execute({ kind: 'done', message: '应该被冷却拦下' })
console.log('cooldown ->', second)

const raw = await captured.execute({ kind: 'raw', title: '自检 raw', message: 'raw 档位，不带语音。', sound: false, seconds: 5 })
console.log('raw ->', raw)

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
