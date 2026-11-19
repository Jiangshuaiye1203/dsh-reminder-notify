// client.js 的离线自检：用极简 React/DOM 桩把设置面板渲染一遍，
// 断言「摘要文案」「改动字段 → mutate 的 ops」「只读时按钮禁用」三条行为。
// 运行：node tests/selftest-client.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

// ---- 极简 React 桩：只实现 createElement / useState ----
function createReactStub() {
  let hooks = []
  let cursor = 0
  let rerender = null
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
        if (rerender !== null) rerender()
      }
      return [hooks[index], set]
    },
    useEffect() {},
  }
  return {
    stub,
    begin() {
      cursor = 0
    },
    reset() {
      hooks = []
      cursor = 0
      rerender = null
    },
    onRerender(fn) {
      rerender = fn
    },
  }
}

const react = createReactStub()

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
  const registered = []
  const ctx = {
    effect(factory, label) {
      const cleanup = factory()
      if (typeof cleanup === 'function') registered.push(cleanup)
      return () => {}
    },
    locale: {
      register(ns, dicts) {
        assert.equal(ns, 'dsh-reminder-notify')
        assert.ok(dicts.zh && dicts.en, 'locale 需要 zh/en 两套字典')
        zhDict = dicts.zh
        return () => {}
      },
      bind(ns) {
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

  const t = ctx.locale.bind('dsh-reminder-notify')

  // ---- 1. summary 视图 ----
  const summary = panel({ view: 'summary', form: undefined, t })
  const summaryText = collectText(summary)
  assert.match(summaryText, /桌面提醒：右下角 · 60 秒 · 提示音开/, 'summary 文案不对：' + summaryText)

  // ---- 2. page 视图 + 保存 ----
  const saved = []
  let currentValue = { seconds: 60, position: 'br', sound: true, cooldownMs: 1500, doneAudio: '完成提醒语音.wav', decideAudio: '需要你来决定.wav', rawAudio: '', audioDir: '', accentDone: '#2ECC71', accentDecide: '#F5A623', accentRaw: '#4C8DFF', hostMode: 'script', scriptPath: '', powershellPath: 'powershell.exe', clientDir: '' }
  const form = {
    state: { value: currentValue, revision: 7, writable: true, status: 'ready' },
    mutate(ops, revision) {
      saved.push({ ops, revision })
      const next = Object.assign({}, currentValue)
      for (const op of ops) next[op.path[0]] = op.value
      currentValue = next
      form.state = Object.assign({}, form.state, { value: next, revision: revision + 1 })
      return Promise.resolve(true)
    },
  }

  let tree = render()
  // 找到秒数输入框并模拟用户输入 90
  const secondsInput = findAll(tree, (node) => node.type === 'input' && node.props.type === 'number')[0]
  assert.ok(secondsInput, '没有找到数字输入框')
  secondsInput.props.onChange({ target: { value: '90' } })
  tree = render()
  const saveButton = findAll(tree, (node) => node.type === 'button' && /drn-btn primary/.test(node.props.className || ''))[0]
  assert.ok(saveButton, '没有找到保存按钮')
  assert.equal(saveButton.props.disabled, false, '有改动时保存按钮应可用')
  saveButton.props.onClick()

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(saved.length, 1, '没有调用 form.mutate')
  assert.deepEqual(saved[0].ops, [{ op: 'set', path: ['seconds'], value: 90 }], 'ops 不对：' + JSON.stringify(saved[0].ops))
  assert.equal(saved[0].revision, 7, 'revision 应该原样传回宿主')

  // ---- 3. 目录选择按钮：点「浏览…」把宿主选中的目录填进字段 ----
  react.reset()
  const pickCalls = []
  const pickProps = {
    t,
    pickDirectory: () => {
      pickCalls.push(1)
      return Promise.resolve('D:\\我的提示音')
    },
  }
  const pickForm = {
    state: { value: { seconds: 60, position: 'br', sound: true, audioDir: '', clientDir: '' }, revision: 11, writable: true, status: 'ready' },
    mutate() {
      throw new Error('选择目录后还没点保存，不应该调用 mutate')
    },
  }
  react.begin()
  let pickTree = panel(Object.assign({ view: 'page', form: pickForm }, pickProps))
  const browseButton = findAll(pickTree, (node) => node.type === 'button' && /drn-btn small/.test(node.props.className || ''))[0]
  assert.ok(browseButton, '目录字段旁边应该有「浏览…」按钮')
  browseButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(pickCalls.length, 1, '点浏览应该调用一次 pickDirectory')
  react.begin()
  pickTree = panel(Object.assign({ view: 'page', form: pickForm }, pickProps))
  const pickedInput = findAll(pickTree, (node) => node.type === 'input' && node.props.value === 'D:\\我的提示音')[0]
  assert.ok(pickedInput, '选中的目录没有填进输入框')
  console.log('picker ok')

  // ---- 4. 只读时不能保存 ----
  react.reset()
  currentValue = Object.assign({}, currentValue)
  const readonlyForm = {
    state: { value: currentValue, revision: 8, writable: false, status: 'ready' },
    mutate() {
      throw new Error('只读状态不应该调用 mutate')
    },
  }
  let readonlyTree = renderForm(readonlyForm)
  const disabledSave = findAll(readonlyTree, (node) => node.type === 'button' && /drn-btn primary/.test(node.props.className || ''))[0]
  assert.equal(disabledSave.props.disabled, true, '只读时保存按钮必须禁用')
  const disabledInputs = findAll(readonlyTree, (node) => node.type === 'input').filter((node) => node.props.disabled === true)
  assert.ok(disabledInputs.length > 0, '只读时输入框必须禁用')

  // ---- 4. 没有 form 时给提示而不是崩溃 ----
  react.reset()
  const fallback = panel({ view: 'page', form: undefined, t })
  assert.match(collectText(fallback), /cordis\.patch\.yml/, '缺少 form 时应提示改 cordis.patch.yml')

  console.log('client selftest ok')

  // 重渲染：在没有真实 DOM 的情况下，component() 返回的树即最新状态
  function render() {
    react.begin()
    return panel({ view: 'page', form, t })
  }

  function renderForm(owner) {
    react.begin()
    return panel({ view: 'page', form: owner, t })
  }
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
