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
    // 与 index.js 里 Host 注册的路由保持一致（同源 GET，返回 { dir, files, error? }）。
    const AUDIO_ROUTE = '/dsh-reminder-notify/audio'
    const CONFIG_ROUTE = '/dsh-reminder-notify/config'
    const AUDIO_KEYS = ['doneAudio', 'decideAudio', 'rawAudio']
    const PREVIEW_ROUTE = '/dsh-reminder-notify/preview'
    const BALANCE_ROUTE = '/dsh-reminder-notify/balance'
    // 0.11 新增：提醒历史（GET 拿统计+最近记录，POST { mode: 'clear' } 清空）。
    const HISTORY_ROUTE = '/dsh-reminder-notify/history'
    const DIGEST_ROUTE = '/dsh-reminder-notify/digest'
    // 下拉按扩展名分组：wav 一组、mp3 一组……组内按文件名排序，一眼能看出格式。
    function groupAudioFiles(files) {
      const byExt = new Map()
      for (const name of files) {
        const dot = name.lastIndexOf('.')
        const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : 'other'
        if (!byExt.has(ext)) byExt.set(ext, [])
        byExt.get(ext).push(name)
      }
      return [...byExt.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ext, names]) => ({ ext, names: names.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')) }))
    }

    const zh = {
      title: '桌面提醒设置',
      intro: '调整弹窗停留时间、位置、提示音和卡片配色。改完点保存，立刻生效，不用重启。',
      unavailable: '这个页面拿不到插件配置（可能是宿主版本较旧），请改用 cordis.patch.yml 修改。',
      loading: '正在读取插件配置…',
      loadFailed: '读取配置失败：',
      retry: '重试',
      readonly: '当前配置由更高优先级的层覆盖，这里只能查看。',
      groupBasic: '基本',
      groupAudio: '提示音',
      groupLook: '外观',
      groupBalance: 'DeepSeek 余额',
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
      doneTitleTemplate: 'done 专用标题模板',
      doneMessageTemplate: 'done 专用正文模板',
      decideTitleTemplate: 'decide 专用标题模板',
      decideMessageTemplate: 'decide 专用正文模板',
      rawTitleTemplate: 'raw 专用标题模板',
      rawMessageTemplate: 'raw 专用正文模板',
      perKindTemplateHint: '留空 = 用上面的通用模板；可用占位符 {title} {message} {kind} {time}。',
      audioPick: '从目录选',
      audioScanning: '正在读取音频目录…',
      audioEmpty: '音频目录里没有可用的音频文件',
      audioFailed: '读取音频目录失败：',
      preview: '试听',
      previewing: '播放中…',
      previewOk: '已播放：',
      previewFailed: '试听失败：',
      hostMode: '宿主模式',
      hostModeScript: '包内脚本（推荐）',
      hostModeExe: '外部 exe 客户端',
      scriptPath: '脚本宿主路径',
      scriptPathHint: '留空 = 插件自带的 host/ReminderHost.ps1。',
      balanceEnabled: '启用余额提醒',
      balanceHint: '定期查 DeepSeek 账户余额，跌破阈值时弹卡片并语音播报（用本机已登录的 DSH 账号，不需要 API key）。',
      balanceThresholds: '余额阈值（百分比，逗号分隔）',
      balanceThresholdsHint: '相对于「基线」的百分比，例如 20,10,5：剩 20%、10%、5% 各提醒一次，不重复报。',
      balanceCheckMinutes: '检查间隔（分钟）',
      balanceCheckHint: '5–1440 分钟；余额检查不会很频繁，避免打扰账号服务。',
      balanceSpeak: '语音播报余额',
      balanceSpeakHint: '勾上后除了弹卡还会念出来；关闭则只弹卡片。',
      balanceStatus: '当前余额',
      balanceQuery: '立即查询',
      balanceQuerying: '查询中…',
      balanceReset: '把当前余额设为基线',
      balanceUnknown: '还没查过余额',
      balanceBaseline: '基线',
      balanceBonus: '赠送金',
      balanceBaselineAuto: '自动',
      balanceBaselineManual: '手动',
      balanceBaselineHint: '基线只认「充值余额」，赠送金不算；换账号会自动重来，刚充值后的 30 分钟内不播报，连续两次查到低于阈值才响。',
      balanceAccountUnavailable: '这台机器的宿主没提供账号服务，查不到余额。',
      balanceSignedOut: 'DSH 还没登录 DeepSeek 账号，查不到余额。',
      balanceUnavailable: '账号服务暂时拿不到余额。',
      balanceNoWallet: '账号里没有人民币（CNY）钱包。',
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
      intro: 'Tune the popup duration, position, sounds and card colours. Saving applies immediately, no restart.',
      unavailable: 'This page cannot read the plugin config (older host). Edit cordis.patch.yml instead.',
      loading: 'Reading the plugin config…',
      loadFailed: 'Could not read the config: ',
      retry: 'Retry',
      readonly: 'A higher-priority layer overrides this config; it is read-only here.',
      groupBasic: 'Basics',
      groupAudio: 'Sounds',
      groupLook: 'Appearance',
      groupBalance: 'DeepSeek balance',
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
      doneTitleTemplate: 'Done-only title template',
      doneMessageTemplate: 'Done-only message template',
      decideTitleTemplate: 'Decide-only title template',
      decideMessageTemplate: 'Decide-only message template',
      rawTitleTemplate: 'Raw-only title template',
      rawMessageTemplate: 'Raw-only message template',
      perKindTemplateHint: 'Empty falls back to the shared template; placeholders: {title} {message} {kind} {time}.',
      audioPick: 'Pick from the directory',
      audioScanning: 'Reading the sound directory…',
      audioEmpty: 'No audio files in the sound directory',
      audioFailed: 'Could not read the sound directory: ',
      preview: 'Play',
      previewing: 'Playing…',
      previewOk: 'Played: ',
      previewFailed: 'Preview failed: ',
      hostMode: 'Host mode',
      hostModeScript: 'Bundled script (recommended)',
      hostModeExe: 'External exe client',
      scriptPath: 'Script host path',
      scriptPathHint: 'Empty uses the bundled host/ReminderHost.ps1.',
      balanceEnabled: 'Balance alerts',
      balanceHint: 'Polls your DeepSeek balance and alerts when it drops below a share of the baseline. Uses the signed-in DSH account, no API key needed.',
      balanceThresholds: 'Thresholds (% of baseline, comma separated)',
      balanceThresholdsHint: 'Relative to the baseline, e.g. 20,10,5 alerts at 20%, 10% and 5% once each.',
      balanceCheckMinutes: 'Check interval (minutes)',
      balanceCheckHint: '5–1440 minutes; keep it polite to the account service.',
      balanceSpeak: 'Speak the balance',
      balanceSpeakHint: 'Reads the number aloud in addition to the card.',
      balanceStatus: 'Current balance',
      balanceQuery: 'Check now',
      balanceQuerying: 'Checking…',
      balanceReset: 'Set current balance as baseline',
      balanceUnknown: 'Not checked yet',
      balanceBaseline: 'baseline',
      balanceBonus: 'bonus',
      balanceBaselineAuto: 'auto',
      balanceBaselineManual: 'manual',
      balanceBaselineHint: 'The baseline counts the recharge wallet only (bonus credit excluded). It resets when the account changes, stays quiet for 30 minutes after a top-up, and needs two consecutive readings below a threshold.',
      balanceAccountUnavailable: 'The account service is unavailable on this host.',
      balanceSignedOut: 'DSH is not signed in to a DeepSeek account.',
      balanceUnavailable: 'The balance is temporarily unavailable.',
      balanceNoWallet: 'No CNY wallet on this account.',
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

    // 0.11 新增文案：排队与合并、卡片按钮、免打扰、全屏降级、语音、历史与统计。
    Object.assign(zh, {
      groupQueue: '排队与免打扰',
      groupHistory: '历史与统计',
      groupDigest: '日报与推送',
      speakEnabled: '朗读提醒内容',
      buttonsEnabled: '卡片显示按钮',
      snoozeMinutes: '「稍后提醒」延后分钟',
      queueEnabled: '提醒排队显示',
      queueMax: '排队上限',
      mergeWindowMs: '合并窗口（毫秒）',
      quietEnabled: '免打扰时段',
      quietStart: '免打扰开始',
      quietEnd: '免打扰结束',
      quietMode: '免打扰处理方式',
      quietModeHold: '留到结束后补弹',
      quietModeSkip: '直接跳过',
      pushFormatWecom: '企业微信机器人',
      pushFormatServerchan: 'Server 酱',
      pushFormatJson: '通用 JSON',
      pushFormatText: '纯文本',
      compactOnFullscreen: '全屏时用紧凑卡片',
      historyEnabled: '记录提醒历史',
      historyLimit: '历史保留条数',
      digestEnabled: '每日提醒日报',
      digestTime: '日报时间',
      digestTitle: '日报标题',
      digestIncludeBalance: '日报带上余额',
      digestAlertCount: '当天条数预警',
      pushEnabled: '推送到手机',
      pushUrl: '推送地址',
      pushFormat: '推送格式',
      pushDecide: '「需要你来决定」也推送',
      pushDigest: '日报也推送',
      speakEnabledHint: '用系统语音把标题和正文念出来；要装中文语音包，没装就静音。',
      buttonsEnabledHint: '卡片右下角给出「知道了」和「稍后提醒」；关掉就只剩自动关闭，点卡片仍可提前关。',
      snoozeMinutesHint: '点「稍后提醒」后隔多久再弹一次。',
      queueEnabledHint: '关掉后多条提醒会同时叠在屏幕上。',
      queueMaxHint: '排队最多留几条，超出的丢掉最旧的。',
      mergeWindowMsHint: '同档位在这段时间内再次触发，会并进排队中的那一条，不重复弹。',
      quietEnabledHint: '时段内不再弹「完成」和普通提醒；「需要你来决定」不受影响。',
      quietStartHint: '24 小时制，例如 22:00。',
      quietEndHint: '跨零点会自动识别，例如 08:00。',
      quietModeHint: '留到时段结束后补弹（holding），还是这段时间内直接不提醒。',
      compactOnFullscreenHint: '检测到前台是全屏应用时改用窄卡片，少挡内容。',
      historyEnabledHint: '每条提醒的结果都会记下来（自动关闭 / 点了按钮 / 稍后提醒 / 免打扰跳过）。',
      historyLimitHint: '超过这个条数就丢掉最旧的记录。',
      digestEnabledHint: '每天到点弹一条「今天弹了几条、你点掉了几条」的日报。',
      digestTimeHint: 'HH:MM 24 小时制，一天只发一条；关机错过了不补。',
      digestTitleHint: '日报卡片的标题，例如「今日提醒日报」。',
      digestIncludeBalanceHint: '日报末尾附上当前 DeepSeek 余额。',
      digestAlertCountHint: '当天提醒超过这个条数时，额外弹一张「提醒有点多」的预警卡；0 = 关闭。',
      pushUrlHint: '企业微信机器人或 Server 酱的 webhook 地址，只需要填 URL 本身。',
      pushFormatHint: 'wecom = 企业微信机器人；serverchan = Server 酱；json = 通用 JSON；text = 纯文本。',
      pushDecideHint: '需要你拍板的提醒也发到手机，人不在电脑前也能收到。',
      pushDigestHint: '日报也发到手机。',
      digestStatus: '日报预览',
      digestRefresh: '刷新预览',
      digestSend: '现在发一条',
      digestSending: '发送中…',
      digestLoading: '正在读取…',
      digestUnavailable: '日报接口不可用',
      digestDisabled: '日报未开启（开启后每天到点自动发）',
      historyStatus: '提醒统计',
      historyLoading: '读取中…',
      historyUnavailable: '读不到历史文件：',
      historyDisabled: '历史记录已关闭。',
      historyTotalPrefix: '共 ',
      historyTotalMid: ' 条 · 今天 ',
      historyTotalSuffix: ' 条',
      historyRefresh: '刷新',
      historyRefreshing: '读取中…',
      historyClear: '清空',
      historyRecent: '最近记录',
      historyKindDone: '完成',
      historyKindDecide: '要你决定',
      historyKindRaw: '普通',
      historyActionTimeout: '自动关闭',
      historyActionDismiss: '点了卡片',
      historyActionOk: '知道了',
      historyActionSnooze: '稍后提醒',
      historyActionQuietSkip: '免打扰跳过',
    })

    Object.assign(en, {
      groupQueue: 'Queue & quiet hours',
      groupHistory: 'History & stats',
      groupDigest: 'Digest & push',
      speakEnabled: 'Speak the reminder',
      buttonsEnabled: 'Show card buttons',
      snoozeMinutes: 'Snooze minutes',
      queueEnabled: 'Queue reminders',
      queueMax: 'Queue limit',
      mergeWindowMs: 'Merge window (ms)',
      quietEnabled: 'Quiet hours',
      quietStart: 'Quiet from',
      quietEnd: 'Quiet until',
      quietMode: 'Quiet-hours behaviour',
      quietModeHold: 'Hold until it ends',
      quietModeSkip: 'Skip it',
      pushFormatWecom: 'WeCom bot',
      pushFormatServerchan: 'ServerChan',
      pushFormatJson: 'Generic JSON',
      pushFormatText: 'Plain text',
      compactOnFullscreen: 'Compact card on fullscreen',
      historyEnabled: 'Keep reminder history',
      historyLimit: 'History entries kept',
      digestEnabled: 'Daily digest',
      digestTime: 'Digest time',
      digestTitle: 'Digest title',
      digestIncludeBalance: 'Include balance',
      digestAlertCount: 'Daily alert threshold',
      pushEnabled: 'Push to phone',
      pushUrl: 'Push URL',
      pushFormat: 'Push format',
      pushDecide: 'Push decisions too',
      pushDigest: 'Push the digest too',
      speakEnabledHint: 'Read the title and body with the system voice; needs a Chinese voice pack, otherwise silent.',
      buttonsEnabledHint: 'Show “Got it” and “Snooze” on the card. Off means auto-dismiss only; clicking the card still closes it.',
      snoozeMinutesHint: 'How long to wait before the snoozed reminder pops again.',
      queueEnabledHint: 'Off means several reminders stack on screen at once.',
      queueMaxHint: 'How many queued reminders to keep; the oldest are dropped.',
      mergeWindowMsHint: 'Same-kind reminders within this window merge into the queued one instead of popping twice.',
      quietEnabledHint: 'No “done” or plain reminders during this window; “needs your call” is never suppressed.',
      quietStartHint: '24-hour clock, for example 22:00.',
      quietEndHint: 'Midnight crossing is handled, for example 08:00.',
      quietModeHint: 'Hold them until the window ends, or skip them entirely.',
      compactOnFullscreenHint: 'Use a narrower card when a fullscreen app is in front.',
      historyEnabledHint: 'Every reminder result is recorded (auto-close / button / snooze / quiet-skip).',
      historyLimitHint: 'Older entries are dropped past this count.',
      digestEnabledHint: 'Pops one daily card with how many reminders fired and how you handled them.',
      digestTimeHint: 'HH:MM, 24-hour. One digest per day; a missed day is not replayed.',
      digestTitleHint: 'Title of the digest card.',
      digestIncludeBalanceHint: 'Append the current DeepSeek balance to the digest.',
      digestAlertCountHint: 'When today passes this many reminders, pop one extra "a lot of reminders" card; 0 = off.',
      pushUrlHint: 'A WeCom bot or ServerChan webhook URL. Only the URL is needed.',
      pushFormatHint: 'wecom = WeCom bot; serverchan = ServerChan; json = generic JSON; text = plain text.',
      pushDecideHint: 'Also push "needs your decision" reminders, so you get them away from the PC.',
      pushDigestHint: 'Also push the daily digest.',
      digestStatus: 'Digest preview',
      digestRefresh: 'Refresh preview',
      digestSend: 'Send one now',
      digestSending: 'Sending…',
      digestLoading: 'Loading…',
      digestUnavailable: 'Digest endpoint unavailable',
      digestDisabled: 'Digest is off (turn it on to send daily)',
      historyStatus: 'Reminder stats',
      historyLoading: 'Reading…',
      historyUnavailable: 'Cannot read the history file: ',
      historyDisabled: 'History recording is off.',
      historyTotalPrefix: '',
      historyTotalMid: ' total · ',
      historyTotalSuffix: ' today',
      historyRefresh: 'Refresh',
      historyRefreshing: 'Reading…',
      historyClear: 'Clear',
      historyRecent: 'Recent entries',
      historyKindDone: 'done',
      historyKindDecide: 'needs you',
      historyKindRaw: 'plain',
      historyActionTimeout: 'auto-closed',
      historyActionDismiss: 'clicked',
      historyActionOk: 'got it',
      historyActionSnooze: 'snoozed',
      historyActionQuietSkip: 'quiet-skip',
    })

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
      { key: 'doneTitleTemplate', group: 'look', kind: 'text' },
      { key: 'doneMessageTemplate', group: 'look', kind: 'text' },
      { key: 'decideTitleTemplate', group: 'look', kind: 'text' },
      { key: 'decideMessageTemplate', group: 'look', kind: 'text' },
      { key: 'rawTitleTemplate', group: 'look', kind: 'text' },
      { key: 'rawMessageTemplate', group: 'look', kind: 'text' },
      { key: 'balanceEnabled', group: 'balance', kind: 'boolean' },
      { key: 'balanceThresholds', group: 'balance', kind: 'text' },
      { key: 'balanceCheckMinutes', group: 'balance', kind: 'number' },
      { key: 'balanceSpeak', group: 'balance', kind: 'boolean' },
      // 0.11：排队与合并、卡片按钮、免打扰、全屏降级、语音。
      { key: 'speakEnabled', group: 'queue', kind: 'boolean' },
      { key: 'buttonsEnabled', group: 'queue', kind: 'boolean' },
      { key: 'snoozeMinutes', group: 'queue', kind: 'number' },
      { key: 'queueEnabled', group: 'queue', kind: 'boolean' },
      { key: 'queueMax', group: 'queue', kind: 'number' },
      { key: 'mergeWindowMs', group: 'queue', kind: 'number' },
      { key: 'quietEnabled', group: 'queue', kind: 'boolean' },
      { key: 'quietStart', group: 'queue', kind: 'text' },
      { key: 'quietEnd', group: 'queue', kind: 'text' },
      { key: 'quietMode', group: 'queue', kind: 'select', options: ['hold', 'skip'], optionLabels: ['quietModeHold', 'quietModeSkip'] },
      { key: 'compactOnFullscreen', group: 'queue', kind: 'boolean' },
      { key: 'historyEnabled', group: 'history', kind: 'boolean' },
      { key: 'historyLimit', group: 'history', kind: 'number' },
      // 0.12：日报与手机推送。
      { key: 'digestEnabled', group: 'digest', kind: 'boolean' },
      { key: 'digestTime', group: 'digest', kind: 'text' },
      { key: 'digestTitle', group: 'digest', kind: 'text' },
      { key: 'digestIncludeBalance', group: 'digest', kind: 'boolean' },
      { key: 'digestAlertCount', group: 'digest', kind: 'number' },
      { key: 'pushEnabled', group: 'digest', kind: 'boolean' },
      { key: 'pushUrl', group: 'digest', kind: 'text' },
      { key: 'pushFormat', group: 'digest', kind: 'select', options: ['wecom', 'serverchan', 'json', 'text'], optionLabels: ['pushFormatWecom', 'pushFormatServerchan', 'pushFormatJson', 'pushFormatText'] },
      { key: 'pushDecide', group: 'digest', kind: 'boolean' },
      { key: 'pushDigest', group: 'digest', kind: 'boolean' },
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
      doneTitleTemplate: 'perKindTemplateHint',
      doneMessageTemplate: 'perKindTemplateHint',
      decideTitleTemplate: 'perKindTemplateHint',
      decideMessageTemplate: 'perKindTemplateHint',
      rawTitleTemplate: 'perKindTemplateHint',
      rawMessageTemplate: 'perKindTemplateHint',
      scriptPath: 'scriptPathHint',
      balanceEnabled: 'balanceHint',
      balanceThresholds: 'balanceThresholdsHint',
      balanceCheckMinutes: 'balanceCheckHint',
      balanceSpeak: 'balanceSpeakHint',
      speakEnabled: 'speakEnabledHint',
      buttonsEnabled: 'buttonsEnabledHint',
      snoozeMinutes: 'snoozeMinutesHint',
      queueEnabled: 'queueEnabledHint',
      queueMax: 'queueMaxHint',
      mergeWindowMs: 'mergeWindowMsHint',
      quietEnabled: 'quietEnabledHint',
      quietStart: 'quietStartHint',
      quietEnd: 'quietEndHint',
      quietMode: 'quietModeHint',
      compactOnFullscreen: 'compactOnFullscreenHint',
      historyEnabled: 'historyEnabledHint',
      historyLimit: 'historyLimitHint',
      digestEnabled: 'digestEnabledHint',
      digestTime: 'digestTimeHint',
      digestTitle: 'digestTitleHint',
      digestIncludeBalance: 'digestIncludeBalanceHint',
      digestAlertCount: 'digestAlertCountHint',
      pushEnabled: 'pushUrlHint',
      pushUrl: 'pushUrlHint',
      pushFormat: 'pushFormatHint',
      pushDecide: 'pushDecideHint',
      pushDigest: 'pushDigestHint',
    }

    const GROUPS = ['basic', 'audio', 'look', 'queue', 'history', 'digest', 'balance', 'host']
    const GROUP_LABELS = { basic: 'groupBasic', audio: 'groupAudio', look: 'groupLook', queue: 'groupQueue', history: 'groupHistory', digest: 'groupDigest', balance: 'groupBalance', host: 'groupHost' }

    function sameValue(a, b) {
      return JSON.stringify(a) === JSON.stringify(b)
    }

    function ReminderConfigPanel(props) {
      const t = props.t
      // 配置读写走插件自己注册的同源 HTTP 路由（Host 端用 configEditor 落盘），
      // 不依赖宿主是否把 ConfigPageForm 传进槽位——那条链路在部分宿主版本里拿不到。
      const [state, setState] = React.useState({ status: 'loading', values: {}, writable: true, error: null })
      const [reload, setReload] = React.useState(0)
      const values = state.values
      const writable = state.writable !== false
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [picking, setPicking] = React.useState(false)
      const [previewing, setPreviewing] = React.useState(null)
      const [message, setMessage] = React.useState(null)
      const [audio, setAudio] = React.useState({ dir: '', files: [], error: null })
      const [balance, setBalance] = React.useState(null)
      const [balanceBusy, setBalanceBusy] = React.useState(false)
      const [history, setHistory] = React.useState(null)
      const [historyBusy, setHistoryBusy] = React.useState(false)
      const [digest, setDigest] = React.useState(null)
      const [digestBusy, setDigestBusy] = React.useState(false)

      React.useEffect(() => {
        if (typeof fetch !== 'function') {
          setState({ status: 'error', values: {}, writable: false, error: 'fetch is unavailable' })
          return undefined
        }
        let cancelled = false
        Promise.resolve()
          .then(() => fetch(CONFIG_ROUTE, { headers: { accept: 'application/json' } }))
          .then((response) => {
            const status = response ? response.status : 0
            const body = response && typeof response.json === 'function' ? response.json() : Promise.resolve(null)
            return Promise.resolve(body)
              .catch(() => null)
              .then((data) => {
                if (response && response.ok && data && data.ok !== false) return data
                const detail = data && data.error ? data.error : 'HTTP ' + status
                throw new Error(detail)
              })
          })
          .then((data) => {
            if (cancelled) return
            setState({ status: 'ready', values: (data && data.values) || {}, writable: (data && data.writable) !== false, error: null })
          })
          .catch((error) => {
            if (cancelled) return
            setState({ status: 'error', values: {}, writable: false, error: String((error && error.message) || error) })
          })
        return () => {
          cancelled = true
        }
      }, [reload])

      // 音频候选：Host 端注册了只读路由 /dsh-reminder-notify/audio，页面同源 fetch 拿目录清单。
      // 拿不到（旧宿主 / 路由被拦）就静默降级成手填文件名，不打扰用户。
      const scanDir = (draft && typeof draft.audioDir === 'string' && draft.audioDir !== '' ? draft.audioDir : values.audioDir) || ''
      React.useEffect(() => {
        if (typeof fetch !== 'function') return undefined
        let cancelled = false
        const url = AUDIO_ROUTE + (scanDir === '' ? '' : '?dir=' + encodeURIComponent(scanDir))
        Promise.resolve()
          .then(() => fetch(url, { headers: { accept: 'application/json' } }))
          .then((response) => (response && response.ok ? response.json() : Promise.reject(new Error('HTTP ' + (response ? response.status : '?')))))
          .then((data) => {
            if (cancelled) return
            setAudio({ dir: (data && data.dir) || scanDir, files: data && Array.isArray(data.files) ? data.files : [], error: (data && data.error) || null })
          })
          .catch((error) => {
            if (cancelled) return
            setAudio({ dir: scanDir, files: [], error: String((error && error.message) || error) })
          })
        return () => {
          cancelled = true
        }
      }, [scanDir])

      // 打开面板时读一次余额快照（不触发提醒，只是显示）。
      React.useEffect(() => {
        refreshBalance()
        refreshHistory()
        refreshDigest()
      }, [])

      if (props.view === 'summary') {
        const tr = typeof t === 'function' ? t : (key) => key
        const posKey = values.position === 'center' ? 'positionCenter' : values.position === 'tr' ? 'positionTr' : 'positionBr'
        const sound = values.sound === false ? tr('soundOff') : tr('soundOn')
        return h('span', null, `${tr('summaryPrefix')}${tr(posKey)} · ${values.seconds === undefined ? 60 : values.seconds}${tr('secondsUnit')} · ${sound}`)
      }

      if (state.status === 'loading') {
        return h('div', { className: 'drn-panel' }, h('div', { className: 'drn-hint' }, typeof t === 'function' ? t('loading') : 'loading…'))
      }

      if (state.status === 'error') {
        return h(
          'div',
          { className: 'drn-panel' },
          h('div', { className: 'drn-hint error' }, (typeof t === 'function' ? t('loadFailed') : 'cannot read config: ') + (state.error || '')),
          h(
            'div',
            { className: 'drn-actions' },
            h('button', { type: 'button', className: 'drn-btn', onClick: () => setReload(reload + 1) }, typeof t === 'function' ? t('retry') : 'Retry'),
          ),
        )
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

      function changedPatch() {
        const patch = {}
        for (const field of FIELDS) {
          const current = effective[field.key]
          const saved = values[field.key]
          if (sameValue(current, saved)) continue
          patch[field.key] = current === undefined ? '' : current
        }
        return patch
      }

      const patch = changedPatch()
      const dirty = Object.keys(patch).length > 0

      function save() {
        if (!dirty || busy) return
        setBusy(true)
        setMessage(null)
        Promise.resolve()
          .then(() =>
            fetch(CONFIG_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ values: patch }),
            }),
          )
          .then((response) =>
            response && typeof response.json === 'function'
              ? response.json().then((data) => ({ ok: !!(response.ok && data && data.ok !== false), data }))
              : Promise.reject(new Error('HTTP ' + (response ? response.status : '?'))),
          )
          .then(({ ok, data }) => {
            setBusy(false)
            if (!ok) throw new Error((data && data.error) || 'save rejected')
            setState({ status: 'ready', values: (data && data.values) || effective, writable: (data && data.writable) !== false, error: null })
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

      // 试听：面板没有本地文件访问能力，交给宿主按档位代播（POST /preview）。
      // 先保存再用当前编辑值试听会更准，但这里刻意不落盘 —— 试听不该改动配置。
      function previewAudio(key) {
        if (previewing !== null) return
        const kind = key === 'decideAudio' ? 'decide' : key === 'rawAudio' ? 'raw' : 'done'
        setPreviewing(key)
        setMessage(null)
        Promise.resolve()
          .then(() =>
            fetch(PREVIEW_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ kind }),
            }),
          )
          .then((response) => {
            const status = response ? response.status : 0
            const body = response && typeof response.json === 'function' ? response.json() : Promise.resolve(null)
            return Promise.resolve(body)
              .catch(() => null)
              .then((data) => {
                if (response && response.ok && data && data.ok !== false) return data
                const detail = data && (data.detail || data.error) ? (data.detail || data.error) : 'HTTP ' + status
                throw new Error(detail)
              })
          })
          .then((data) => {
            setPreviewing(null)
            const label = typeof t === 'function' ? t('previewOk') : 'Playing: '
            setMessage({ ok: true, text: label + String((data && data.audio) || '') })
          })
          .catch((error) => {
            setPreviewing(null)
            const prefix = typeof t === 'function' ? t('previewFailed') : 'preview failed: '
            setMessage({ ok: false, text: prefix + String((error && error.message) || error) })
          })
      }

      // 余额：数字与「立即查询 / 重置基线」都走同一个路由（宿主侧问账号服务）。
      function shortTime(ms) {
        const n = Number(ms)
        if (!Number.isFinite(n) || n <= 0) return ''
        const d = new Date(n)
        const pad = (v) => (v < 10 ? '0' + v : String(v))
        return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
      }

      function balanceText() {
        const label = typeof t === 'function' ? t : (key) => key
        if (balance === null) return label('balanceUnknown')
        if (balance.ok === false) {
          const reasons = {
            'account-unavailable': label('balanceAccountUnavailable'),
            'signed-out': label('balanceSignedOut'),
            'balance-unavailable': label('balanceUnavailable'),
            'no-cny-wallet': label('balanceNoWallet'),
          }
          return (reasons[balance.error] || String(balance.error || ''))
        }
        if (balance.balance === null || balance.balance === undefined) return label('balanceUnknown')
        const parts = ['¥' + Number(balance.balance).toFixed(2)]
        if (balance.pct !== null && balance.pct !== undefined) parts.push('（' + balance.pct + '%）')
        if (balance.baseline) {
          const source =
            balance.baselineSource === 'manual'
              ? label('balanceBaselineManual')
              : balance.baselineSource === 'auto'
                ? label('balanceBaselineAuto')
                : ''
          const at = shortTime(balance.baselineAt)
          const tail = [source, at].filter(Boolean).join(' · ')
          parts.push(' · ' + label('balanceBaseline') + ' ¥' + Number(balance.baseline).toFixed(2) + (tail ? '（' + tail + '）' : ''))
        }
        if (Number(balance.bonus) > 0) {
          parts.push(' · ' + label('balanceBonus') + ' ¥' + Number(balance.bonus).toFixed(2))
        }
        return parts.join('')
      }

      function applyBalance(payload) {
        if (payload && typeof payload === 'object') setBalance(payload)
      }

      function balanceFetch(options) {
        setBalanceBusy(true)
        Promise.resolve()
          .then(() => fetch(BALANCE_ROUTE, options))
          .then((response) => {
            const body = response && typeof response.json === 'function' ? response.json() : Promise.resolve(null)
            return Promise.resolve(body).catch(() => null)
          })
          .then((data) => {
            setBalanceBusy(false)
            if (data && typeof data === 'object') applyBalance(data)
          })
          .catch((error) => {
            setBalanceBusy(false)
            setBalance({ ok: false, error: String((error && error.message) || error) })
          })
      }

      function refreshBalance() {
        balanceFetch({ headers: { accept: 'application/json' } })
      }

      function queryBalance() {
        balanceFetch({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' })
      }

      function resetBalance() {
        balanceFetch({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ mode: 'reset' }) })
      }

      // 历史：GET 拿统计与最近记录，POST { mode: 'clear' } 清空。
      function historyFetch(options) {
        setHistoryBusy(true)
        Promise.resolve()
          .then(() => fetch(HISTORY_ROUTE, options))
          .then((response) => (response && typeof response.json === 'function' ? response.json() : Promise.resolve(null)))
          .then((data) => {
            setHistoryBusy(false)
            if (data && typeof data === 'object') setHistory(data)
            else setHistory({ ok: false, error: 'empty-response' })
          })
          .catch((error) => {
            setHistoryBusy(false)
            setHistory({ ok: false, error: String((error && error.message) || error) })
          })
      }

      function digestFetch(options) {
        setDigestBusy(true)
        Promise.resolve()
          .then(() => fetch(DIGEST_ROUTE, options))
          .then((response) => (response && typeof response.json === 'function' ? response.json() : Promise.resolve(null)))
          .then((data) => {
            setDigestBusy(false)
            if (data && typeof data === 'object') setDigest(data)
            else setDigest({ ok: false, error: 'empty-response' })
          })
          .catch((error) => {
            setDigestBusy(false)
            setDigest({ ok: false, error: String((error && error.message) || error) })
          })
      }

      function refreshDigest() {
        digestFetch({ headers: { accept: 'application/json' } })
      }

      function sendDigest() {
        const label = typeof t === 'function' ? t : (key) => key
        setMessage(null)
        setDigestBusy(true)
        Promise.resolve()
          .then(() =>
            fetch(DIGEST_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ mode: 'send' }),
            }),
          )
          .then((response) => (response && typeof response.json === 'function' ? response.json() : Promise.reject(new Error('HTTP ' + (response ? response.status : '?')))))
          .then((data) => {
            setDigestBusy(false)
            if (!data || data.ok === false) throw new Error((data && data.error) || 'send rejected')
            setDigest(data)
            const push = data.push
            if (!push) {
              setMessage({ ok: true, text: label('digestSentNoPush') })
              return
            }
            if (push.ok) {
              setMessage({ ok: true, text: label('digestPushOkPrefix') + String(push.status === undefined ? '200' : push.status) + ')' })
              return
            }
            const reason = push.reason || push.error || push.body || String(push.status || '')
            setMessage({ ok: false, text: label('digestPushFailedPrefix') + String(reason) })
          })
          .catch((error) => {
            setDigestBusy(false)
            setMessage({ ok: false, text: label('digestSendFailedPrefix') + String((error && error.message) || error) })
          })
      }

      function digestText() {
        const label = typeof t === 'function' ? t : (key) => key
        if (digest === null) return label('digestLoading')
        if (digest.ok === false) {
          return label('digestUnavailable') + (digest.error ? '（' + String(digest.error) + '）' : '')
        }
        if (digest.enabled === false) return label('digestDisabled')
        return String(digest.message || '').split('\n').join(' / ')
      }

      function refreshHistory() {
        historyFetch({ headers: { accept: 'application/json' } })
      }

      function clearHistory() {
        historyFetch({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ mode: 'clear' }) })
      }

      function historyText() {
        const label = typeof t === 'function' ? t : (key) => key
        if (history === null) return label('historyLoading')
        if (history.ok === false) {
          return label('historyUnavailable') + (history.error ? '（' + String(history.error) + '）' : '')
        }
        if (history.enabled === false) return label('historyDisabled')
        const stats = history.stats || {}
        const total = Number(stats.total) || 0
        const today = Number(stats.today) || 0
        return label('historyTotalPrefix') + total + label('historyTotalMid') + today + label('historyTotalSuffix')
      }

      function entryText(entry) {
        const label = typeof t === 'function' ? t : (key) => key
        const kinds = { done: 'historyKindDone', decide: 'historyKindDecide', raw: 'historyKindRaw' }
        const actions = {
          timeout: 'historyActionTimeout',
          dismiss: 'historyActionDismiss',
          ok: 'historyActionOk',
          snooze: 'historyActionSnooze',
          'quiet-skip': 'historyActionQuietSkip',
        }
        const head = [shortTime(entry.at), label(kinds[entry.kind] || 'historyKindRaw'), label(actions[entry.action] || entry.action)]
        if (entry.count > 1) head.push('×' + entry.count)
        const text = String(entry.message || '').replace(/\s+/g, ' ').slice(0, 46)
        if (text !== '') head.push(text)
        return head.filter(Boolean).join(' · ')
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
        if (AUDIO_KEYS.includes(field.key) && audio.files.length > 0) {
          const groups = groupAudioFiles(audio.files)
          const options = [h('option', { value: '', key: '__pick' }, typeof t === 'function' ? t('audioPick') : 'pick')]
          for (const group of groups) {
            const children = group.names.map((name) => h('option', { key: name, value: name }, name))
            options.push(h('optgroup', { key: 'grp-' + group.ext, label: group.ext }, children))
          }
          return h(
            'div',
            { className: 'drn-pick' },
            input,
            h(
              'select',
              {
                className: 'drn-select',
                disabled,
                value: '',
                onChange: (e) => {
                  const picked = e.target.value
                  if (picked !== '') edit(field.key, picked, 'text')
                },
              },
              options,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'drn-btn small drn-preview',
                disabled: disabled || previewing !== null,
                onClick: () => previewAudio(field.key),
              },
              previewing === field.key
                ? (typeof t === 'function' ? t('previewing') : 'Playing…')
                : (typeof t === 'function' ? t('preview') : 'Play'),
            ),
          )
        }
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

      const groups = GROUPS.map((group) => {
        const rows = FIELDS.filter((field) => field.group === group).map((field) =>
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
        )
        if (group === 'history') {
          const label = typeof t === 'function' ? t : (key) => key
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'history-status' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, label('historyStatus')),
                h('div', { className: 'drn-hint' }, historyText()),
              ),
              h(
                'div',
                { className: 'drn-pick' },
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: historyBusy, onClick: refreshHistory },
                  label(historyBusy ? 'historyRefreshing' : 'historyRefresh'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: historyBusy, onClick: clearHistory },
                  label('historyClear'),
                ),
              ),
            ),
          )
          const entries = history && Array.isArray(history.entries) ? history.entries.slice(0, 8) : []
          if (entries.length > 0) {
            rows.push(
              h(
                'div',
                { className: 'drn-row', key: 'history-list' },
                h(
                  'div',
                  { className: 'drn-row-main' },
                  h('div', { className: 'drn-label' }, label('historyRecent')),
                  entries.map((entry, index) => h('div', { className: 'drn-hint', key: 'h' + index }, entryText(entry))),
                ),
              ),
            )
          }
        }
        if (group === 'digest') {
          const label = typeof t === 'function' ? t : (key) => key
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'digest-status' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, label('digestStatus')),
                h('div', { className: 'drn-hint' }, digestText()),
              ),
              h(
                'div',
                { className: 'drn-pick' },
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: digestBusy, onClick: refreshDigest },
                  label('digestRefresh'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: digestBusy, onClick: sendDigest },
                  label(digestBusy ? 'digestSending' : 'digestSend'),
                ),
              ),
            ),
          )
        }
        if (group === 'balance') {
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'balance-status' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, typeof t === 'function' ? t('balanceStatus') : 'DeepSeek balance'),
                h('div', { className: 'drn-hint' }, balanceText()),
                typeof t === 'function'
                  ? h('div', { className: 'drn-hint drn-balance-rule' }, t('balanceBaselineHint'))
                  : null,
              ),
              h(
                'div',
                { className: 'drn-pick' },
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: balanceBusy, onClick: queryBalance },
                  typeof t === 'function' ? t(balanceBusy ? 'balanceQuerying' : 'balanceQuery') : 'Check now',
                ),
                h(
                  'button',
                  { type: 'button', className: 'drn-btn small', disabled: balanceBusy, onClick: resetBalance },
                  typeof t === 'function' ? t('balanceReset') : 'Reset baseline',
                ),
              ),
            ),
          )
        }
        return h(
          'div',
          { className: 'drn-group', key: group },
          h('div', { className: 'drn-group-title' }, typeof t === 'function' ? t(GROUP_LABELS[group]) : group),
          rows,
        )
      })

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
