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
