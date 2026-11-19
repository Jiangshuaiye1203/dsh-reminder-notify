// 自检：不启动 DSH，用假 ctx 把插件当普通模块跑一遍，真的弹一次提醒。
import { apply } from './index.js'

let captured
const ctx = {
  get: () => ({
    register(definition) {
      captured = definition
      return () => {}
    },
  }),
  effect: (fn) => fn(),
  logger: console,
}

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
  { ...ctx, get: () => ({ register(d) { templated = d; return () => {} } }) },
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
