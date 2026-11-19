// dsh-reminder-notify —— Client 半边：插件页里的「桌面提醒」设置面板
//
// 只做一件事：在 bundle 详情页（plugins.bundle.config 槽位，key = 包名）渲染
// 分组表单，把用户改过的字段通过宿主给的 ConfigPageForm 写回去：
//   values 来自 props.form.state.value（宿主已接受的那一份）
//   保存 = props.form.mutate([{ op: 'set', path: [key], value }], revision)
// 面板本身不持久化任何东西；改完由 loader 写 profile 并重启插件生效。
// 样式全部走主题 token，跟随明暗主题，不写死颜色。

window.__ModuleLoader__.load({
  id: 'dsh-reminder-notify',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-reminder-notify'

    const zh = {
      title: '桌面提醒设置',
      intro: '调整弹窗停留时间、位置、提示音和卡片配色。改完点保存，插件会重启一次后生效。',
      unavailable: '这个页面拿不到插件配置（可能是宿主版本较旧），请改用 cordis.patch.yml 修改。',
      readonly: '当前配置由更高优先级的层覆盖，这里只能查看。',
      groupBasic: '基本',
      groupAudio: '提示音',
      groupLook: '外观',
      groupHost: '宿主与路径',
      seconds: '停留秒数',
      secondsHint: '2–600 秒，到点自动关闭。',
      position: '弹窗位置',
      positionBr: '右下角',
      positionCenter: '屏幕居中',
      positionTr: '右上角',
      sound: '播放提示音',
      soundHint: '关掉后只弹卡片不出声。',
      cooldownMs: '同档位冷却（毫秒）',
      cooldownHint: '防止模型在同一轮里重复弹同一种提醒。',
      doneAudio: '完成（done）提示音文件',
      decideAudio: '需要决定（decide）提示音文件',
      rawAudio: '通用（raw）提示音文件',
      audioHint: '填文件名（wav / mp3，ogg 取决于系统解码器），在下面的提示音目录里找；留空表示静音。',
      audioDir: '提示音目录',
      audioDirHint: '留空 = 用插件自带的 assets/提示音导入/。',
      accentDone: '完成强调色',
      accentDecide: '需要决定强调色',
      accentRaw: '通用强调色',
      cardBackground: '卡片背景图',
      cardBackgroundHint: 'png / jpg 路径（绝对路径或相对插件目录），留空 = 纯色背景。',
      cardIcon: '标题图标',
      cardIconHint: '标题左侧的小图标（png），留空 = 不显示。',
      doneCardBackground: 'done 专用背景图',
      decideCardBackground: 'decide 专用背景图',
      rawCardBackground: 'raw 专用背景图',
      doneCardIcon: 'done 专用图标',
      decideCardIcon: 'decide 专用图标',
      rawCardIcon: 'raw 专用图标',
      perKindHint: '按档位覆盖通用设置，留空就用上面的通用背景 / 图标。',
      titleTemplate: '标题模板',
      messageTemplate: '正文模板',
      templateHint: '可用占位符 {title} {message} {kind} {time}。',
      hostMode: '宿主模式',
      hostModeScript: '包内脚本（推荐）',
      hostModeExe: '外部 exe 客户端',
      scriptPath: '脚本宿主路径',
      scriptPathHint: '留空 = 插件自带的 host/ReminderHost.ps1。',
      powershellPath: 'PowerShell 可执行文件',
      clientDir: '客户端目录（仅 exe 模式）',
      empty: '（留空用默认）',
      browse: '浏览…',
      picking: '选择中…',
      pickFailed: '打开目录选择器失败：',
      save: '保存',
      saving: '保存中…',
      reset: '撤销修改',
      saved: '已保存，插件重启后生效。',
      failed: '保存失败：',
      summaryPrefix: '桌面提醒：',
      soundOn: '提示音开',
      soundOff: '提示音关',
      secondsUnit: ' 秒',
    }

    const en = {
      title: 'Desktop reminder settings',
      intro: 'Tune the popup duration, position, sounds and card colours. Saving restarts the plugin once.',
      unavailable: 'This page cannot read the plugin config (older host). Edit cordis.patch.yml instead.',
      readonly: 'A higher-priority layer overrides this config; it is read-only here.',
      groupBasic: 'Basics',
      groupAudio: 'Sounds',
      groupLook: 'Appearance',
      groupHost: 'Host and paths',
      seconds: 'Duration (seconds)',
      secondsHint: '2–600 seconds, then it closes itself.',
      position: 'Position',
      positionBr: 'Bottom right',
      positionCenter: 'Centred',
      positionTr: 'Top right',
      sound: 'Play sound',
      soundHint: 'Off shows the card silently.',
      cooldownMs: 'Same-kind cooldown (ms)',
      cooldownHint: 'Stops the model repeating one reminder within a turn.',
      doneAudio: 'Done sound file',
      decideAudio: 'Decide sound file',
      rawAudio: 'Raw sound file',
      audioHint: 'A file name resolved inside the sound directory (wav / mp3; ogg depends on system codecs); empty means silent.',
      audioDir: 'Sound directory',
      audioDirHint: 'Empty uses the bundled assets/提示音导入/.',
      accentDone: 'Done accent',
      accentDecide: 'Decide accent',
      accentRaw: 'Raw accent',
      cardBackground: 'Card background',
      cardBackgroundHint: 'A png / jpg path (absolute or relative to the plugin); empty keeps the solid colour.',
      cardIcon: 'Title icon',
      cardIconHint: 'A small png shown left of the title; empty hides it.',
      doneCardBackground: 'Done-only background',
      decideCardBackground: 'Decide-only background',
      rawCardBackground: 'Raw-only background',
      doneCardIcon: 'Done-only icon',
      decideCardIcon: 'Decide-only icon',
      rawCardIcon: 'Raw-only icon',
      perKindHint: 'Overrides the shared background / icon per kind; empty falls back to the shared value.',
      titleTemplate: 'Title template',
      messageTemplate: 'Message template',
      templateHint: 'Placeholders: {title} {message} {kind} {time}.',
      hostMode: 'Host mode',
      hostModeScript: 'Bundled script (recommended)',
      hostModeExe: 'External exe client',
      scriptPath: 'Script host path',
      scriptPathHint: 'Empty uses the bundled host/ReminderHost.ps1.',
      powershellPath: 'PowerShell executable',
      clientDir: 'Client directory (exe mode)',
      empty: '(empty uses the default)',
      browse: 'Browse…',
      picking: 'Choosing…',
      pickFailed: 'Could not open the directory picker: ',
      save: 'Save',
      saving: 'Saving…',
      reset: 'Discard changes',
      saved: 'Saved; the plugin restarts to apply it.',
      failed: 'Save failed: ',
      summaryPrefix: 'Desktop reminder: ',
      soundOn: 'sound on',
      soundOff: 'sound off',
      secondsUnit: 's',
    }

    const CSS = `
.drn-panel { display: flex; flex-direction: column; gap: 18px; color: var(--dsw-alias-label-primary); }
.drn-head { display: flex; flex-direction: column; gap: 4px; }
.drn-head-title { font-size: 14px; font-weight: 600; }
.drn-head-intro { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.drn-group { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 12px; }
.drn-group-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); letter-spacing: .02em; }
.drn-row { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.drn-row-main { display: flex; flex-direction: column; gap: 2px; min-width: 180px; flex: 1 1 220px; }
.drn-label { font-size: 13px; }
.drn-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.45; }
.drn-control { flex: 0 1 260px; display: flex; justify-content: flex-end; }
.drn-input, .drn-select { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.drn-input:focus, .drn-select:focus { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.drn-input[disabled], .drn-select[disabled] { opacity: .6; }
.drn-color { width: 56px; height: 30px; padding: 2px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.drn-switch { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.drn-actions { display: flex; align-items: center; gap: 10px; }
.drn-btn { font: inherit; font-size: 13px; padding: 6px 14px; border-radius: 7px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.drn-btn.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.drn-btn[disabled] { opacity: .5; cursor: default; }
.drn-pick { display: flex; gap: 6px; width: 100%; align-items: center; }
.drn-pick .drn-input { flex: 1 1 auto; min-width: 0; }
.drn-btn.small { padding: 5px 10px; white-space: nowrap; }
.drn-msg { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.drn-msg.error { color: var(--dsw-alias-state-error-primary); }
`

    // 字段表：kind 决定控件类型，group 决定分组，缺省值来自宿主 config。
    const FIELDS = [
      { key: 'seconds', group: 'basic', kind: 'number' },
      { key: 'position', group: 'basic', kind: 'select', options: ['br', 'center', 'tr'], optionLabels: ['positionBr', 'positionCenter', 'positionTr'] },
      { key: 'sound', group: 'basic', kind: 'boolean' },
      { key: 'cooldownMs', group: 'basic', kind: 'number' },
      { key: 'doneAudio', group: 'audio', kind: 'text' },
      { key: 'decideAudio', group: 'audio', kind: 'text' },
      { key: 'rawAudio', group: 'audio', kind: 'text' },
      { key: 'audioDir', group: 'audio', kind: 'text', pick: 'directory' },
      { key: 'accentDone', group: 'look', kind: 'color' },
      { key: 'accentDecide', group: 'look', kind: 'color' },
      { key: 'accentRaw', group: 'look', kind: 'color' },
      { key: 'cardBackground', group: 'look', kind: 'text' },
      { key: 'cardIcon', group: 'look', kind: 'text' },
      { key: 'doneCardBackground', group: 'look', kind: 'text' },
      { key: 'decideCardBackground', group: 'look', kind: 'text' },
      { key: 'rawCardBackground', group: 'look', kind: 'text' },
      { key: 'doneCardIcon', group: 'look', kind: 'text' },
      { key: 'decideCardIcon', group: 'look', kind: 'text' },
      { key: 'rawCardIcon', group: 'look', kind: 'text' },
      { key: 'titleTemplate', group: 'look', kind: 'text' },
      { key: 'messageTemplate', group: 'look', kind: 'text' },
      { key: 'hostMode', group: 'host', kind: 'select', options: ['script', 'exe'], optionLabels: ['hostModeScript', 'hostModeExe'] },
      { key: 'scriptPath', group: 'host', kind: 'text' },
      { key: 'powershellPath', group: 'host', kind: 'text' },
      { key: 'clientDir', group: 'host', kind: 'text', pick: 'directory' },
    ]

    const HINTS = {
      seconds: 'secondsHint',
      sound: 'soundHint',
      cooldownMs: 'cooldownHint',
      doneAudio: 'audioHint',
      audioDir: 'audioDirHint',
      cardBackground: 'cardBackgroundHint',
      cardIcon: 'cardIconHint',
      doneCardBackground: 'perKindHint',
      decideCardBackground: 'perKindHint',
      rawCardBackground: 'perKindHint',
      doneCardIcon: 'perKindHint',
      decideCardIcon: 'perKindHint',
      rawCardIcon: 'perKindHint',
      titleTemplate: 'templateHint',
      messageTemplate: 'templateHint',
      scriptPath: 'scriptPathHint',
    }

    const GROUPS = ['basic', 'audio', 'look', 'host']
    const GROUP_LABELS = { basic: 'groupBasic', audio: 'groupAudio', look: 'groupLook', host: 'groupHost' }

    function sameValue(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }

    function ReminderConfigPanel(props) {
      const t = props.t
      const form = props.form
      const state = form && form.state ? form.state : undefined
      const values = (state && state.value) || {}
      const writable = !!(state && state.writable)
      const revision = state && state.revision
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [message, setMessage] = React.useState(null)

      if (props.view === 'summary') {
        const tr = typeof t === 'function' ? t : (key) => key
        const posKey = values.position === 'center' ? 'positionCenter' : values.position === 'tr' ? 'positionTr' : 'positionBr'
        const sound = values.sound === false ? tr('soundOff') : tr('soundOn')
        return h('span', null, `${tr('summaryPrefix')}${tr(posKey)} · ${values.seconds === undefined ? 60 : values.seconds}${tr('secondsUnit')} · ${sound}`)
      }

      if (form === undefined || state === undefined) {
        return h('div', { className: 'drn-panel' }, h('div', { className: 'drn-hint' }, typeof t === 'function' ? t('unavailable') : 'unavailable'))
      }

      const effective = draft === null ? values : Object.assign({}, values, draft)

      function edit(key, raw, kind) {
        let value = raw
        if (kind === 'number') {
          const n = Number(raw)
          value = raw === '' || !Number.isFinite(n) ? raw : n
        }
        setMessage(null)
        setDraft(Object.assign({}, draft || {}, { [key]: value }))
      }

      function changedOps() {
        const ops = []
        for (const field of FIELDS) {
          const current = effective[field.key]
          const saved = values[field.key]
          if (sameValue(current, saved)) continue
          ops.push({ op: 'set', path: [field.key], value: current === '' ? (field.kind === 'text' ? '' : current) : current })
        }
        return ops
      }

      const ops = changedOps()
      const dirty = ops.length > 0

      function save() {
        if (!dirty || busy) return
        setBusy(true)
        setMessage(null)
        Promise.resolve(form.mutate(ops, revision))
          .then(() => {
            setBusy(false)
            setDraft(null)
            setMessage({ ok: true, text: typeof t === 'function' ? t('saved') : 'saved' })
          })
          .catch((error) => {
            setBusy(false)
            const prefix = typeof t === 'function' ? t('failed') : 'failed: '
            setMessage({ ok: false, text: prefix + String((error && error.message) || error) })
          })
      }

      // 目录类字段的「浏览…」：调宿主原生的目录选择器（client uiWorkspace.pickDirectory），
      // 选完直接把绝对路径写进草稿；面板拿不到选择器时按钮不渲染，字段照旧手填。
      function browse(key) {
        const pick = props.pickDirectory
        if (typeof pick !== 'function' || picking) return
        setPicking(true)
        setMessage(null)
        Promise.resolve()
          .then(() => pick())
          .then((picked) => {
            setPicking(false)
            if (typeof picked === 'string' && picked !== '') edit(key, picked, 'text')
          })
          .catch((error) => {
            setPicking(false)
            const prefix = typeof t === 'function' ? t('pickFailed') : 'pick failed: '
            setMessage({ ok: false, text: prefix + String((error && error.message) || error) })
          })
      }

      function control(field) {
        const value = effective[field.key]
        const disabled = !writable || busy
        if (field.kind === 'boolean') {
          return h(
            'label',
            { className: 'drn-switch' },
            h('input', { type: 'checkbox', checked: value !== false, disabled, onChange: (e) => edit(field.key, e.target.checked, 'boolean') }),
            h('span', null, value !== false ? '✓' : '—'),
          )
        }
        if (field.kind === 'select') {
          return h(
            'select',
            { className: 'drn-select', value: value === undefined ? '' : String(value), disabled, onChange: (e) => edit(field.key, e.target.value, 'select') },
            field.options.map((option, index) =>
              h('option', { key: option, value: option }, typeof t === 'function' ? t(field.optionLabels[index]) : option),
            ),
          )
        }
        if (field.kind === 'color') {
          return h('input', {
            className: 'drn-color',
            type: 'color',
            value: typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000',
            disabled,
            onChange: (e) => edit(field.key, e.target.value, 'color'),
          })
        }
        const input = h('input', {
          className: 'drn-input',
          type: field.kind === 'number' ? 'number' : 'text',
          value: value === undefined || value === null ? '' : String(value),
          placeholder: typeof t === 'function' ? t('empty') : '',
          disabled,
          onChange: (e) => edit(field.key, e.target.value, field.kind),
        })
        if (field.pick === 'directory' && typeof props.pickDirectory === 'function') {
          return h(
            'div',
            { className: 'drn-pick' },
            input,
            h(
              'button',
              { type: 'button', className: 'drn-btn small', disabled: disabled || picking, onClick: () => browse(field.key) },
              typeof t === 'function' ? t(picking ? 'picking' : 'browse') : 'Browse…',
            ),
          )
        }
        return input
      }

      const groups = GROUPS.map((group) =>
        h(
          'div',
          { className: 'drn-group', key: group },
          h('div', { className: 'drn-group-title' }, typeof t === 'function' ? t(GROUP_LABELS[group]) : group),
          FIELDS.filter((field) => field.group === group).map((field) =>
            h(
              'div',
              { className: 'drn-row', key: field.key },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, typeof t === 'function' ? t(field.key) : field.key),
                HINTS[field.key] && typeof t === 'function'
                  ? h('div', { className: 'drn-hint' }, t(HINTS[field.key]))
                  : null,
              ),
              h('div', { className: 'drn-control' }, control(field)),
            ),
          ),
        ),
      )

      return h(
        'div',
        { className: 'drn-panel' },
        h(
          'div',
          { className: 'drn-head' },
          h('div', { className: 'drn-head-title' }, typeof t === 'function' ? t('title') : 'Desktop reminder settings'),
          h('div', { className: 'drn-head-intro' }, typeof t === 'function' ? t(writable ? 'intro' : 'readonly') : ''),
        ),
        groups,
        h(
          'div',
          { className: 'drn-actions' },
          h(
            'button',
            { type: 'button', className: 'drn-btn primary', disabled: !dirty || busy || !writable, onClick: save },
            typeof t === 'function' ? t(busy ? 'saving' : 'save') : 'Save',
          ),
          h(
            'button',
            { type: 'button', className: 'drn-btn', disabled: !dirty || busy, onClick: () => { setDraft(null); setMessage(null) } },
            typeof t === 'function' ? t('reset') : 'Discard',
          ),
          message !== null
            ? h('span', { className: 'drn-msg' + (message.ok ? '' : ' error') }, message.text)
            : null,
        ),
      )
    }

    const name = 'dsh-reminder-notify'
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-reminder-notify: settings dictionaries')

      // 目录选择器来自 Client 的 uiWorkspace 服务；旧宿主没有这个服务时保持 undefined，
      // 面板会退化成纯手填，不影响保存。
      const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
      const pickDirectory = workspace && typeof workspace.pickDirectory === 'function'
        ? () => workspace.pickDirectory()
        : undefined

      ctx.effect(() => {
        if (typeof document === 'undefined') return
        const previous = document.getElementById('drn-panel-style')
        if (previous !== null) return () => {}
        const tag = document.createElement('style')
        tag.id = 'drn-panel-style'
        tag.dataset.plugin = NS
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, 'dsh-reminder-notify: panel styles')

      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          {
            name: 'plugins.bundle.config',
            key: NS,
            locale: NS,
            inject: () => ({ t: ctx.locale.bind(NS), pickDirectory }),
          },
          ReminderConfigPanel,
        ),
      )
    }

    return { name, inject, apply }
  },
})
