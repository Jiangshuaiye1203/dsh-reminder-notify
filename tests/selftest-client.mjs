// client.js 的离线自检：用极简 React/DOM 桩把设置面板渲染一遍。
// 面板的数据来自插件自己注册的同源 HTTP 路由（/dsh-reminder-notify/config 与 /audio），
// 所以这里 mock globalThis.fetch，断言：摘要文案、读取配置、保存 POST、目录选择、提示音下拉、只读、读取失败重试。
// 运行：node tests/selftest-client.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const CONFIG_URL = '/dsh-reminder-notify/config'
const AUDIO_URL = '/dsh-reminder-notify/audio'
const PREVIEW_URL = '/dsh-reminder-notify/preview'

// ---- 极简 React 桩：createElement / useState / useEffect ----
function createReactStub() {
  let hooks = []
  const effects = []
  let cursor = 0
  const stub = {
    createElement(type, props, ...children) {
      const merged = Object.assign({}, props)
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
      }
      return [hooks[index], set]
    },
    useEffect(fn) {
      effects.push(fn)
    },
  }
  return {
    stub,
    begin() {
      cursor = 0
    },
    runEffects() {
      const pending = effects.splice(0, effects.length)
      for (const fn of pending) fn()
    },
    reset() {
      effects.length = 0
      hooks = []
      cursor = 0
    },
  }
}

const react = createReactStub()
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

function mockFetch(handler) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const request = {
      url: String(url),
      method: (init && init.method) || 'GET',
      body: init && init.body ? JSON.parse(init.body) : null,
    }
    calls.push(request)
    const reply = handler(request)
    const status = reply.status === undefined ? 200 : reply.status
    return { ok: status < 400, status, json: async () => reply.body }
  }
  return { calls, restore() { globalThis.fetch = real } }
}

const baseValues = {
  seconds: 60,
  position: 'br',
  sound: true,
  cooldownMs: 1500,
  doneAudio: '完成提醒语音.wav',
  decideAudio: '需要你来决定.wav',
  rawAudio: '',
  audioDir: '',
  accentDone: '#2ECC71',
  accentDecide: '#F5A623',
  accentRaw: '#4C8DFF',
  hostMode: 'script',
  scriptPath: '',
  powershellPath: 'powershell.exe',
  clientDir: '',
}

// ---- 模块加载桩 ----
let loaded = null
const windowStub = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
}

const requireStub = (name) => {
  if (name === 'react') return react.stub
  throw new Error('unexpected require: ' + name)
}

const realWindow = globalThis.window
const realDocument = globalThis.document
globalThis.window = windowStub
globalThis.document = {
  getElementById: () => null,
  createElement: () => ({ dataset: {}, remove() {}, set textContent(v) {}, get textContent() { return '' } }),
  head: { appendChild() {} },
}

try {
  new Function('window', 'document', source)(globalThis.window, globalThis.document)
  assert.ok(loaded !== null, 'client.js 没有调用 window.__ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-reminder-notify')

  const clientModule = loaded.factory(requireStub)
  assert.equal(clientModule.name, 'dsh-reminder-notify')

  // ---- 用假的 ctx 跑 apply，拿到注册的面板组件 ----
  let panel = null
  let zhDict = {}
  let enDict = {}
  const ctx = {
    effect(factory) {
      const cleanup = factory()
      return typeof cleanup === 'function' ? cleanup : () => {}
    },
    get() {
      return undefined
    },
    locale: {
      register(ns, dicts) {
        assert.equal(ns, 'dsh-reminder-notify')
        assert.ok(dicts.zh && dicts.en, 'locale 需要 zh/en 两套字典')
        zhDict = dicts.zh
        enDict = dicts.en
        return () => {}
      },
      bind() {
        return (key) => (Object.prototype.hasOwnProperty.call(zhDict, key) ? zhDict[key] : key)
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.bundle.config')
        callback()
        return () => {}
      },
      register(options, component) {
        assert.equal(options.name, 'plugins.bundle.config')
        assert.equal(options.key, 'dsh-reminder-notify')
        panel = component
        return () => {}
      },
    },
  }

  clientModule.apply(ctx)
  assert.ok(panel !== null, '没有注册 plugins.bundle.config 面板')

  // ---- 0. 文案与字段对账：新增字段最容易漏的是字典键 ----
  {
    const zhKeys = Object.keys(zhDict).sort()
    const enKeys = Object.keys(enDict).sort()
    assert.deepEqual(zhKeys, enKeys, 'zh / en 字典键不一致：' + zhKeys.filter((k) => !enDict[k]).concat(enKeys.filter((k) => !zhDict[k])).join(','))

    const fieldKeys = [...source.matchAll(/\{ key: '([A-Za-z0-9_]+)', group: '([A-Za-z]+)'/g)].map((m) => m[1])
    assert.ok(fieldKeys.length > 30, '没有解析到 FIELDS：' + fieldKeys.length)
    for (const key of fieldKeys) {
      assert.ok(zhDict[key] !== undefined, 'FIELDS 字段缺少中文标签：' + key)
      assert.ok(enDict[key] !== undefined, 'FIELDS 字段缺少英文标签：' + key)
    }

    const groupKeys = new Set([...source.matchAll(/group: '([A-Za-z]+)'/g)].map((m) => m[1]))
    for (const group of groupKeys) {
      assert.ok(zhDict['group' + group[0].toUpperCase() + group.slice(1)] !== undefined, '分组缺少中文标题：' + group)
      assert.ok(enDict['group' + group[0].toUpperCase() + group.slice(1)] !== undefined, '分组缺少英文标题：' + group)
    }

    const hintKeys = [...source.matchAll(/: '([A-Za-z0-9_]+Hint)'/g)].map((m) => m[1])
    for (const key of hintKeys) {
      assert.ok(zhDict[key] !== undefined, '提示缺少中文：' + key)
      assert.ok(enDict[key] !== undefined, '提示缺少英文：' + key)
    }
    console.log('dict-keys ok', fieldKeys.length, 'fields |', groupKeys.size, 'groups |', hintKeys.length, 'hints')
  }

  const t = ctx.locale.bind('dsh-reminder-notify')

  // 渲染一次并跑完 effect（读完配置），然后重渲染拿到就绪态
  async function mount(props) {
    react.begin()
    panel(props)
    react.runEffects()
    await tick()
    react.begin()
    return panel(props)
  }

  // ---- 1. summary 视图 ----
  const summary = panel({ view: 'summary', t })
  assert.match(collectText(summary), /桌面提醒：右下角 · 60 秒 · 提示音开/, 'summary 文案不对')

  // ---- 2. page 视图：读取配置 → 改秒数 → 保存发出 POST ----
  react.reset()
  let stored = Object.assign({}, baseValues)
  let api = mockFetch((request) => {
    if (request.url !== CONFIG_URL) throw new Error('unexpected url: ' + request.url)
    if (request.method === 'POST') {
      stored = Object.assign({}, stored, request.body.values)
      return { body: { ok: true, writable: true, values: stored } }
    }
    return { body: { ok: true, writable: true, values: stored } }
  })
  try {
    let tree = await mount({ view: 'page', t })
    assert.equal(api.calls.filter((call) => call.method === 'GET').length >= 1, true, '面板应该先 GET 配置')

    const secondsInput = findAll(tree, (node) => node.type === 'input' && node.props.type === 'number')[0]
    assert.ok(secondsInput, '没有找到数字输入框')
    secondsInput.props.onChange({ target: { value: '90' } })
    tree = await mount({ view: 'page', t })

    const saveButton = findAll(tree, (node) => node.type === 'button' && /drn-btn primary/.test(node.props.className || ''))[0]
    assert.ok(saveButton, '没有找到保存按钮')
    assert.equal(saveButton.props.disabled, false, '有改动时保存按钮应可用')
    saveButton.props.onClick()
    await tick()

    const posts = api.calls.filter((call) => call.method === 'POST')
    assert.equal(posts.length, 1, '应该 POST 一次')
    assert.deepEqual(posts[0].body, { values: { seconds: 90 } }, 'POST body 不对：' + JSON.stringify(posts[0].body))
  } finally {
    api.restore()
  }

  // ---- 3. 目录选择按钮：把宿主选中的目录填进字段 ----
  react.reset()
  api = mockFetch(() => ({ body: { ok: true, writable: true, values: Object.assign({}, baseValues, { audioDir: '' }) } }))
  try {
    const pickCalls = []
    const props = {
      view: 'page',
      t,
      pickDirectory: () => {
        pickCalls.push(1)
        return Promise.resolve('D:\\\\我的提示音')
      },
    }
    let tree = await mount(props)
    const browseButton = findAll(tree, (node) => node.type === 'button' && /drn-btn small/.test(node.props.className || ''))[0]
    assert.ok(browseButton, '目录字段旁边应该有「浏览…」按钮')
    browseButton.props.onClick()
    await tick()
    assert.equal(pickCalls.length, 1, '点浏览应该调用一次 pickDirectory')

    tree = await mount(props)
    const picked = findAll(tree, (node) => node.type === 'input' && String(node.props.value || '') === 'D:\\\\我的提示音')[0]
    assert.ok(picked, '选中的目录没有填进输入框')
    console.log('picker ok')
  } finally {
    api.restore()
  }

  // ---- 4. 提示音下拉按扩展名分组 + 试听按钮 POST 到宿主 ----
  react.reset()
  api = mockFetch((request) => {
    if (request.url.startsWith(PREVIEW_URL)) {
      return { body: { ok: true, kind: 'done', audio: 'D:\\\\提示音\\\\完成提醒语音.wav' } }
    }
    if (request.url.startsWith(AUDIO_URL)) {
      return { body: { dir: 'D:\\\\提示音', files: ['完成提醒语音.wav', '需要你来决定.mp3'] } }
    }
    return { body: { ok: true, writable: true, values: Object.assign({}, baseValues, { doneAudio: '', audioDir: 'D:\\\\提示音' }) } }
  })
  try {
    let tree = await mount({ view: 'page', t })
    const allSelects = findAll(tree, (node) => node.type === 'select' && node.props.className === 'drn-select')
    const audioSelects = allSelects.filter(
      (node) => findAll(node, (child) => child.type === 'option' && child.props.value === '完成提醒语音.wav').length === 1,
    )
    assert.equal(audioSelects.length, 3, '三个提示音字段都应该有下拉，实际 ' + audioSelects.length)
    const groups = findAll(audioSelects[0], (node) => node.type === 'optgroup').map((node) => node.props.label)
    assert.deepEqual(groups, ['mp3', 'wav'], '下拉应按扩展名分组，实际：' + JSON.stringify(groups))
    const options = findAll(audioSelects[0], (node) => node.type === 'option').map((node) => node.props.value)
    assert.deepEqual(options, ['', '需要你来决定.mp3', '完成提醒语音.wav'], '下拉选项不对：' + JSON.stringify(options))

    const previewButton = findAll(tree, (node) => node.type === 'button' && /drn-preview/.test(node.props.className || ''))[0]
    assert.ok(previewButton, '每个提示音字段旁边应该有「试听」按钮')
    previewButton.props.onClick()
    await tick()
    const posts = api.calls.filter((call) => call.url.startsWith(PREVIEW_URL))
    assert.equal(posts.length, 1, '点试听应该 POST 一次 /preview')
    assert.equal(posts[0].method, 'POST', '试听必须用 POST')
    assert.deepEqual(posts[0].body, { kind: 'done' }, '试听请求体应为 { kind }')

    tree = await mount({ view: 'page', t })
    assert.match(collectText(tree), /已播放/, '试听成功后应给出提示')
    console.log('audio-select ok')
  } finally {
    api.restore()
  }

  // ---- 5. 只读：保存按钮与输入框都禁用 ----
  react.reset()
  api = mockFetch(() => ({ body: { ok: true, writable: false, values: Object.assign({}, baseValues) } }))
  try {
    const tree = await mount({ view: 'page', t })
    const saveButton = findAll(tree, (node) => node.type === 'button' && /drn-btn primary/.test(node.props.className || ''))[0]
    assert.equal(saveButton.props.disabled, true, '只读时保存按钮必须禁用')
    const disabledInputs = findAll(tree, (node) => node.type === 'input').filter((node) => node.props.disabled === true)
    assert.ok(disabledInputs.length > 0, '只读时输入框必须禁用')
    console.log('readonly ok')
  } finally {
    api.restore()
  }

  // ---- 6. 读取失败：给出错误提示与「重试」，点重试会重新 GET ----
  react.reset()
  api = mockFetch(() => ({ status: 500, body: { ok: false, error: 'boom' } }))
  try {
    let tree = await mount({ view: 'page', t })
    const text = collectText(tree)
    assert.match(text, /读取配置失败/, '读取失败时应提示，实际：' + text)
    assert.match(text, /boom/, '应带上错误细节')
    const retry = findAll(tree, (node) => node.type === 'button' && /重试/.test(collectText(node)))[0]
    assert.ok(retry, '应该有重试按钮')
    const before = api.calls.length
    retry.props.onClick()
    tree = await mount({ view: 'page', t })
    assert.ok(api.calls.length > before, '点重试应该重新请求配置')
    console.log('load-error ok')
  } finally {
    api.restore()
  }

  console.log('client selftest ok')
} finally {
  globalThis.window = realWindow
  globalThis.document = realDocument
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  if (node.props) {
    findAll(node.props.children, predicate, out)
    for (const [key, value] of Object.entries(node.props)) {
      if (key !== 'children') findAll(value, predicate, out)
    }
  }
  return out
}

function collectText(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(collectText).join('')
  if (typeof node !== 'object') return ''
  return collectText(node.props ? node.props.children : undefined)
}
