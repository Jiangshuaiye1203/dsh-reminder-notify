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
    const RECUR_ROUTE = '/dsh-reminder-notify/recurring'
    const MOBILE_LINK_ROUTE = '/dsh-reminder-notify/mobile/link'
    const DOCTOR_ROUTE = '/dsh-reminder-notify/doctor'
    const TRAY_ROUTE = '/dsh-reminder-notify/tray'
const EXPORT_ROUTE = '/dsh-reminder-notify/export'
const STATS_ROUTE = '/dsh-reminder-notify/stats'
const FEEDBACK_ROUTE = '/dsh-reminder-notify/feedback'
const BACKUP_ROUTE = '/dsh-reminder-notify/backup'
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
      cardsEnabled: '弹出窗口',
      secondsHint: '2–600 秒，到点自动关闭。',
      cardsEnabledHint: '关掉后一张卡都不弹（历史照常记录，日报和手机推送也不受影响）。',
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
      cardsEnabled: 'Pop-up cards',
      secondsHint: '2–600 seconds, then it closes itself.',
      cardsEnabledHint: 'Turn off to stop all pop-up cards (history and push still work).',
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
      // 0.13：高频项在前，其余收进折叠块；说明搬到插件详情页。
      groupAdvanced: '高级：历史、余额与宿主',
      foldExpand: '展开',
      foldCollapse: '收起',
      tryTitle: '试试看：',
      tryDone: '发一张完成卡',
      tryDecide: '发一张决定卡',
      tryRaw: '发一张通用卡',
      hintsShow: '显示小字',
      hintsHide: '隐藏小字',
      hintsShowHint: '把每一项下面的说明文字展开',
      hintsHideHint: '收起说明文字，只看标题和控件',
      tryShown: '已经弹出一张样卡，20 秒后自动关闭。',
      tryQuiet: '现在在免打扰时段，样卡被拦住了（正常行为）。',
      tryFailed: '没能弹出示意卡：',
      retryHostOnce: '宿主失败时重试一次',
      retryHostOnceHint: '第一次没画出卡片（比如被系统策略拦下）时，静音再弹一次。',
      groupDoctor: '工程与可靠性：自检',
      doctorHint: '「运行自检」逐条检查宿主路径、提示音、历史可写与各项服务；「弹样卡」会真的弹一张，验证宿主能不能画。',
      doctorNotRun: '还没运行过自检。',
      doctorRun: '运行自检',
      doctorRunning: '检查中…',
      doctorAllOk: '全部通过。',
      doctorHasFailures: '有项目没通过，见下面的 ✗。',
      doctorProbe: '弹样卡',
      doctorProbeOk: '样卡已弹出，能看到就说明宿主正常。',
      doctorProbeFailed: '自检失败：',
      doctorGithub: '测 GitHub',
      doctorGithubOk: 'GitHub 能连上：HTTP ',
      doctorGithubFailed: 'GitHub 连不上：',
      check_github: 'GitHub 连通性',
      doctorLastExit: '最近退出码',
      doctorFailures: '最近失败次数',
      check_platform: '系统',
      check_powershell: 'PowerShell',
      check_host_script: '宿主脚本',
      check_audio_dir: '提示音目录',
      check_audio_files: '提示音文件',
      check_history_writable: '历史文件可写',
      check_routes: '面板路由',
      check_tools: 'notify_user',
      check_config_editor: '配置可写',
      check_account: '余额接口',
      check_service_api: '宿主服务',
      check_host_exit: '宿主退出码',
      groupCond: '条件提醒',
      conditionsEnabled: '开启条件提醒',
      conditionsEnabledHint: '满足条件时主动弹一张卡，不用等模型调用。每 60 秒检查一次。',
      condBalanceBelow: '余额跌破阈值时提醒',
      condBalanceBelowHint: '拿实时余额和「余额提醒」里的百分比阈值比较，命中就弹一张。',
      condQueueBacklog: '排队超过几条时提醒',
      condQueueBacklogHint: '积压的卡片超过这个数就提醒你（0 表示关闭这一条）。',
      condHostFailures: '宿主连续失败几次时提醒',
      condHostFailuresHint: '宿主画不出卡片累计到这个次数就提醒（0 表示关闭这一条）。',
      condQuietEnter: '进入免打扰时段时提醒',
      condQuietEnterHint: '每天进入免打扰时弹一张，提醒你之后的提醒会被压住。',
      condDailyCount: '当天超过几条时提醒',
      condDailyCountHint: '当天提醒条数超过这个数就提醒你「今天有点多」（0 表示关闭这一条）。',
      condCooldownMinutes: '条件提醒最小间隔（分钟）',
      condCooldownMinutesHint: '同一条条件在这段时间内只提醒一次。',
      toastEnabled: '同时发系统通知',
      toastEnabledHint: '卡片弹出的同时，在 Windows 右下角再弹一个系统气泡（关掉卡片也能看到）。',
      toastSeconds: '系统通知停留秒数',
      toastSecondsHint: '3–60 秒；系统会不会缩短由 Windows 决定。',
      trayEnabled: '启动时开托盘图标',
      trayEnabledHint: '托盘里能切静音 / 免打扰，也能用热键手动弹一张。',
      trayHotkey: '手动弹卡热键',
      trayHotkeyHint: '形如 Ctrl+Alt+R；托盘没开时不生效。',
      trayStatus: '托盘状态',
      trayRunning: '运行中',
      trayStoppedState: '未启动',
      trayStart: '启动托盘',
      trayStop: '停止托盘',
      trayToastTest: '发一条原生通知',
      trayRefresh: '刷新状态',
      trayToastOk: '系统通知已发（右下角应该出现气泡）。',
      trayToastFailed: '系统通知没发出去。',
      trayStarted: '托盘已启动，热键可以用了。',
      trayStopped: '托盘已停止。',
      trayFailed: '托盘操作失败：',
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
      pushFormatTelegram: 'Telegram',
      pushFormatFeishu: '飞书',
      pushFormatDingtalk: '钉钉',
      pushChat: '会话 ID（telegram）',
      pushChatHint: 'telegram 机器人要填 chat_id；其它格式留空即可。',
      maxHoldSeconds: '单卡最长停留（秒）',
      maxHoldSecondsHint: '0 = 不额外限制（最多 600 秒）；填 30 就是任何卡最多挂 30 秒。',
      exportCsv: '导出 CSV',
      exportJson: '导出 JSON',
      exportDone: '已导出到桌面：',
      exportFailed: '导出失败：',
      last30: '近 30 天：',
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
      replyEnabled: '卡片上有输入框（可以回话）',
      replyEnabledHint: '卡片上多一个输入框，打完按 Enter 就把这句话回给模型；回复会进历史，也能顺手推到手机。',
      customButtons: '卡片上的自定义按钮',
      customButtonsHint: '写成「标签|网址」，多个用分号隔开，最多 3 个。带网址的点开链接，不带网址的只记一次点击。',
      focusAssistMute: '专注助手开着时自动静音',
      focusAssistMuteHint: 'Windows 专注助手 / 演示模式开着时，卡片照样弹但不响，免得打断你。',
      pushReply: '卡片回话也推送',
      pushReplyHint: '你在卡片上回的话，也按上面的推送地址发到手机。',
      historyActionReplied: '卡片回话',
      historyActionCustom: '点了自定义按钮',
      historyActionChoice: '选了候选项',
      historyChoicePrefix: '选了：',
      historyReplyPrefix: '回复：',
      historyAttachPrefix: '附件 ',
      historyButtonPrefix: '按钮：',
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
      historyChart: '最近 30 天',
      historyChartHint: '每根柱子一天，越长说明那天弹得越多；鼠标停住看日期与条数。',
      groupBackup: '备份与恢复',
      backupHint: '重装插件会把设置重置成默认值；这里每天自动留一份，也能随时手动备份/导出/恢复。',
      backupNow: '备份一次',
      backupExport: '导出配置',
      backupRestoreLatest: '恢复最近一次',
      backupImport: '导入配置',
      backupImportPlaceholder: '把导出的 JSON 粘到这里，再点「导入配置」。',
      backupNone: '还没有备份。点「备份一次」就行。',
      backupSaved: '已备份。',
      backupRestored: '已恢复：',
      backupExportHint: '导出会下载一个 JSON 文件（含推送地址等，别随便发给别人）。',
      backupFailed: '操作失败：',
      backupRestore: '恢复',
      groupStats: '本插件下载量',
      statsHint: '数据来自 npm 公开统计：安装、升级都会计一次，不等于人数；走 npm 的安装才算。',
      statsYesterday: '昨天',
      statsWeek: '近 7 天',
      statsMonth: '近 30 天',
      statsUpdated: '数据时间',
      statsCached: '缓存',
      statsRefresh: '刷新',
      statsLoading: '读取中…',
      statsFailed: '没读到下载量：',
      groupFeedback: '反馈与留言',
      feedbackHint: '写建议、问题或体验。保存只留在本机；想让我看到就点「在 GitHub 上提交」。',
      feedbackPlaceholder: '比如：卡片停留时间想再长一点 / 希望支持某种用法 …',
      feedbackCategorySuggest: '建议',
      feedbackCategoryProblem: '问题',
      feedbackCategoryExperience: '体验',
      feedbackAttachEnv: '附上环境信息（版本、系统、最近 3 条提醒的档位与处理方式，不含正文）',
      feedbackSave: '保存到本地',
      feedbackCopy: '复制',
      feedbackIssue: '在 GitHub 上提交',
      feedbackIssueTip: '浏览器没自动打开？手动点这里：',
      feedbackNone: '还没有留言。',
      feedbackDelete: '删除',
      feedbackSaved: '已存到本机留言板。',
      feedbackCopied: '已复制到剪贴板。',
      feedbackCopyFailed: '复制失败，请手动选中文本。',
      feedbackEmpty: '先写点什么。',
      feedbackIssueOpened: '已打开 GitHub 新建 issue 页面，确认后发布。',
      feedbackFailed: '保存失败：',
      recurringTitle: '周期提醒',
      recurringNone: '现在没有周期提醒。让模型用 every: "30m" 发一条就能建。',
      recurringNext: '下次',
      recurringHint: '到点自动弹卡；times 用完就自动消失。取消只看最近一条。',
      recurringRefresh: '刷新',
      mobileTitle: '手机页面（同一 Wi-Fi）',
      mobileHint: '手机连同一个 Wi-Fi，打开这个地址就能看最近的提醒并回一句话；地址里的 t= 是口令，别外传。',
      mobileRefresh: '刷新地址',
      mobileCopy: '复制地址',
      mobileLoading: '正在取地址…',
      mobileUnavailable: '还没取到地址，点「刷新地址」试试。',
      mobileCopied: '手机地址已复制',
      recurringCancel: '取消最近一条',
      groupHelp: '使用说明（点开才看）',
      helpIntro: '下面每条点开才看，平时不占地方。',
      helpUse: '什么时候会弹',
      helpUseText: '模型在任务收尾时发「完成」，在要你拍板前发「需要你来决定」，也可以直接用「普通」发任意一句话。你不需要手动触发。',
      helpCard: '卡片上能做什么',
      helpCardText: '「知道了」立刻关掉；「稍后提醒」过 N 分钟再弹一次（N 在设置里改）；什么都不点就按停留秒数自动关闭。卡片不抢焦点，鼠标点一下也能关。',
      helpQueue: '同时来好几条',
      helpQueueText: '同一时间只显示一张，其余排队（上限在设置里改）。同档位在合并窗口内再次触发会并进排队那条，不重复弹。',
      helpQuiet: '免打扰时段',
      helpQuietText: '时段内不再弹「完成」和普通提醒：「需要你来决定」照常弹。处理方式可选「留到结束后补弹」或「直接跳过」。全屏时会自动换成窄卡片，少挡内容。',
      helpDigest: '日报与手机推送',
      helpDigestText: '打开日报后每天到点发一条，内容是当天条数与处理方式统计，可选带上余额。推送需要你自己的 webhook：企业微信机器人地址（格式选「企业微信机器人」）或 Server 酱的 sctapi.ftqq.com 地址（格式选「Server 酱」）。发失败时这里会写明原因。',
      helpBalance: '余额提醒',
      helpBalanceText: '用本机已登录的 DSH 账号查 DeepSeek 余额，低于阈值的百分比就提醒；基线是「最近一次充值后的余额」，赠送金不计入，刚充值后的 30 分钟内不播报。',
      helpHost: '宿主与排查',
      helpHostText: '卡片由包内 host/ReminderHost.ps1 用系统 PowerShell 绘制，没有 exe，所以不触发 SmartScreen。没有卡片时先按「试试看」三个按钮；还不行就检查宿主设置里的脚本路径，或在设置面板最下方看历史记录里有没有对应条目。',
      helpTip: '完整说明在包内 docs/detail.zh.md；改完记得点最下面的「保存」。',
    })

    Object.assign(en, {
      groupQueue: 'Queue & quiet hours',
      groupHistory: 'History & stats',
      groupDigest: 'Digest & push',
      groupAdvanced: 'Advanced: history, balance & host',
      foldExpand: 'expand',
      foldCollapse: 'collapse',
      tryTitle: 'Try it:',
      tryDone: 'Show a done card',
      tryDecide: 'Show a decision card',
      tryRaw: 'Show a plain card',
      hintsShow: 'Show hints',
      hintsHide: 'Hide hints',
      hintsShowHint: 'Expand the explanation under every setting',
      hintsHideHint: 'Collapse explanations, keep only labels and controls',
      tryShown: 'A sample card is on screen; it closes itself in 20 seconds.',
      tryQuiet: 'Quiet hours are active, so the sample was held back (expected).',
      tryFailed: 'Could not show the sample: ',
      retryHostOnce: 'Retry once when the host fails',
      retryHostOnceHint: 'If the first card never drew (blocked by policy, for example), try once more with sound off.',
      groupDoctor: 'Reliability: self-check',
      doctorHint: 'Run the self-check to verify the host path, audio files, writable history and every service; "probe" pops a real card to prove the host can draw.',
      doctorNotRun: 'The self-check has not run yet.',
      doctorRun: 'Run self-check',
      doctorRunning: 'Checking…',
      doctorAllOk: 'Everything passed.',
      doctorHasFailures: 'Some checks failed — see the ✗ lines below.',
      doctorProbe: 'Probe a card',
      doctorProbeOk: 'A probe card is on screen; if you can see it, the host is fine.',
      doctorProbeFailed: 'Self-check failed: ',
      doctorGithub: 'Test GitHub',
      doctorGithubOk: 'GitHub reachable: HTTP ',
      doctorGithubFailed: 'GitHub unreachable: ',
      check_github: 'GitHub reachability',
      doctorLastExit: 'last exit code',
      doctorFailures: 'recent failures',
      check_platform: 'platform',
      check_powershell: 'PowerShell',
      check_host_script: 'host script',
      check_audio_dir: 'audio directory',
      check_audio_files: 'audio files',
      check_history_writable: 'history file writable',
      check_routes: 'panel routes',
      check_tools: 'notify_user',
      check_config_editor: 'config writable',
      check_account: 'balance API',
      check_service_api: 'host service API',
      check_host_exit: 'host exit code',
      groupCond: 'Conditional reminders',
      conditionsEnabled: 'Enable conditional reminders',
      conditionsEnabledHint: 'Pop a card by itself when a condition matches, without waiting for the model. Checked every 60 seconds.',
      condBalanceBelow: 'Remind when balance drops below a threshold',
      condBalanceBelowHint: 'Compares the live balance with the percentage thresholds from "Balance reminders" and pops a card when one is crossed.',
      condQueueBacklog: 'Remind when the queue backs up',
      condQueueBacklogHint: 'Remind you when more than this many cards are waiting (0 turns this rule off).',
      condHostFailures: 'Remind after repeated host failures',
      condHostFailuresHint: 'Remind you when the host has failed to draw this many times (0 turns this rule off).',
      condQuietEnter: 'Remind when quiet hours start',
      condQuietEnterHint: 'Pops one card a day when quiet hours begin, so you know later cards are held back.',
      condDailyCount: 'Remind when the day gets busy',
      condDailyCountHint: 'Remind you when today has more than this many cards (0 turns this rule off).',
      condCooldownMinutes: 'Minimum minutes between conditional reminders',
      condCooldownMinutesHint: 'The same condition reminds you at most once in this window.',
      toastEnabled: 'Also send a system notification',
      toastEnabledHint: 'Alongside the card, show a Windows balloon tip as well (visible even with the card closed).',
      toastSeconds: 'System notification seconds',
      toastSecondsHint: '3 to 60 seconds; Windows may shorten it.',
      trayEnabled: 'Start the tray icon with the plugin',
      trayEnabledHint: 'The tray lets you toggle mute / quiet hours and pop a card from a hotkey.',
      trayHotkey: 'Manual card hotkey',
      trayHotkeyHint: 'For example Ctrl+Alt+R; ignored while the tray is off.',
      trayStatus: 'Tray status',
      trayRunning: 'running',
      trayStoppedState: 'not started',
      trayStart: 'Start tray',
      trayStop: 'Stop tray',
      trayToastTest: 'Send a system notification',
      trayRefresh: 'Refresh status',
      trayToastOk: 'System notification sent (a balloon should appear).',
      trayToastFailed: 'The system notification did not go out.',
      trayStarted: 'The tray is running and the hotkey is live.',
      trayStopped: 'The tray has stopped.',
      trayFailed: 'Tray action failed: ',
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
      pushFormatTelegram: 'Telegram',
      pushFormatFeishu: 'Feishu',
      pushFormatDingtalk: 'DingTalk',
      pushChat: 'Chat ID (Telegram)',
      pushChatHint: 'Telegram bots need a chat_id; leave empty for other formats.',
      maxHoldSeconds: 'Max card lifetime (s)',
      maxHoldSecondsHint: '0 = no extra cap (600 s max); 30 means no card stays longer than 30 s.',
      exportCsv: 'Export CSV',
      exportJson: 'Export JSON',
      exportDone: 'Exported to Desktop: ',
      exportFailed: 'Export failed: ',
      last30: 'Last 30 days: ',
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
      replyEnabled: 'Reply box on the card',
      replyEnabledHint: 'Adds a text box; press Enter to send the line back to the model. Replies land in history and can also be pushed to your phone.',
      customButtons: 'Custom buttons on the card',
      customButtonsHint: 'Write “label|url”, separate several with semicolons, at most 3. With a URL it opens the link; without one it only records the click.',
      focusAssistMute: 'Mute while Focus Assist is on',
      focusAssistMuteHint: 'When Windows Focus Assist / presentation mode is on, the card still shows but stays silent.',
      pushReply: 'Push card replies too',
      pushReplyHint: 'Also push the lines you type on the card to your phone.',
      historyActionReplied: 'replied',
      historyActionCustom: 'custom button',
      historyActionChoice: 'picked an option',
      historyChoicePrefix: 'picked: ',
      historyReplyPrefix: 'reply: ',
      historyAttachPrefix: 'files ',
      historyButtonPrefix: 'button: ',
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
      historyActionQuietSkip: 'skipped (quiet hours)',
      historyChart: 'Last 30 days',
      historyChartHint: 'One bar per day; taller means more reminders. Hover for the date and count.',
      groupBackup: 'Backup & restore',
      backupHint: 'Reinstalling resets settings to defaults. A copy is kept here every day; you can also back up, export and restore by hand.',
      backupNow: 'Back up now',
      backupExport: 'Export config',
      backupRestoreLatest: 'Restore latest',
      backupImport: 'Import config',
      backupImportPlaceholder: 'Paste an exported JSON here, then click “Import config”.',
      backupNone: 'No backups yet — click “Back up now”.',
      backupSaved: 'Backed up.',
      backupRestored: 'Restored: ',
      backupExportHint: 'Export downloads a JSON file (it contains your webhook URL — do not share it casually).',
      backupFailed: 'Failed: ',
      backupRestore: 'Restore',
      groupStats: 'This plugin\'s downloads',
      statsHint: 'From public npm stats: installs and upgrades both count, so this is downloads, not people.',
      statsYesterday: 'Yesterday',
      statsWeek: 'Last 7 days',
      statsMonth: 'Last 30 days',
      statsUpdated: 'Updated',
      statsCached: 'cached',
      statsRefresh: 'Refresh',
      statsLoading: 'Loading…',
      statsFailed: 'Could not read downloads: ',
      groupFeedback: 'Feedback',
      feedbackHint: 'Write a suggestion, a problem or your experience. Saving keeps it on this machine; use “Submit on GitHub” if you want me to see it.',
      feedbackPlaceholder: 'e.g. cards could stay a bit longer / I wish it supported …',
      feedbackCategorySuggest: 'Suggestion',
      feedbackCategoryProblem: 'Problem',
      feedbackCategoryExperience: 'Experience',
      feedbackAttachEnv: 'Attach environment (version, OS, kind+action of the last 3 reminders; no message text)',
      feedbackSave: 'Save locally',
      feedbackCopy: 'Copy',
      feedbackIssue: 'Submit on GitHub',
      feedbackIssueTip: 'Browser did not open? Click here: ',
      feedbackNone: 'No notes yet.',
      feedbackDelete: 'Delete',
      feedbackSaved: 'Saved to the local feedback board.',
      feedbackCopied: 'Copied to clipboard.',
      feedbackCopyFailed: 'Copy failed, please select the text manually.',
      feedbackEmpty: 'Write something first.',
      feedbackIssueOpened: 'Opened a GitHub new-issue page — submit it there.',
      feedbackFailed: 'Save failed: ',
      recurringTitle: 'Recurring reminders',
      recurringNone: 'No recurring reminders. Ask the model to send one with every: "30m".',
      recurringNext: 'next',
      recurringHint: 'Each one fires on schedule and disappears after its times limit. Cancel removes the newest one.',
      recurringRefresh: 'Refresh',
      mobileTitle: 'Phone page (same Wi-Fi)',
      mobileHint: 'Open this URL on a phone in the same Wi-Fi to see recent reminders and reply. The t= value is the access token.',
      mobileRefresh: 'Refresh URL',
      mobileCopy: 'Copy URL',
      mobileLoading: 'Loading URL…',
      mobileUnavailable: 'No URL yet; click Refresh URL.',
      mobileCopied: 'Phone URL copied',
      recurringCancel: 'Cancel newest',
      groupHelp: 'How it works (expand to read)',
      helpIntro: 'Each topic stays folded until you open it.',
      helpUse: 'When a card appears',
      helpUseText: 'The model fires "done" when a task finishes, "decide" before it needs your call, and can also send a plain "raw" message. You never trigger it by hand.',
      helpCard: 'What the card can do',
      helpCardText: '"Got it" closes it right away; "Snooze" brings it back after N minutes (configurable); doing nothing lets it auto-close after the stay time. The card never steals focus, and a click on it also dismisses it.',
      helpQueue: 'Several at once',
      helpQueueText: 'Only one card shows at a time, the rest queue up (limit is configurable). A repeat from the same kind inside the merge window joins the queued card instead of popping twice.',
      helpQuiet: 'Quiet hours',
      helpQuietText: 'Inside the window, "done" and raw reminders stay silent while "decide" still shows. Choose either "hold until it ends" or "skip it". On a full-screen app the card switches to a compact layout.',
      helpDigest: 'Daily digest & phone push',
      helpDigestText: 'With the digest on, one summary is sent each day: counts and how you handled them, optionally with the balance. Pushing needs your own webhook: a WeCom bot URL (format "WeCom bot") or a Server Chan sctapi.ftqq.com URL (format "Server Chan"). Failures are reported right here.',
      helpBalance: 'Balance alerts',
      helpBalanceText: 'Reads the DeepSeek balance through the signed-in DSH account and warns when it drops below a percentage of the baseline. The baseline is the balance right after your last top-up, bonus credit is excluded, and nothing fires within 30 minutes of a top-up.',
      helpHost: 'Host & troubleshooting',
      helpHostText: 'Cards are drawn by host/ReminderHost.ps1 with the built-in PowerShell, so there is no exe and no SmartScreen prompt. If nothing shows, press one of the three "try it" buttons first; then check the script path under host settings, or look for the entry in the history list at the bottom of this panel.',
      helpTip: 'The full document ships in docs/detail.en.md. Remember to press "Save" at the bottom.',
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
.drn-hints-off .drn-field-hint { display: none; }
.drn-hints-btn { margin-left: auto; }
.drn-bars { display: flex; align-items: flex-end; gap: 2px; height: 56px; margin: 6px 0 2px; }
.drn-feedback-text { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; line-height: 1.5; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); resize: vertical; }
.drn-bar { flex: 1 1 0; min-height: 2px; background: var(--dsw-alias-brand-primary, #3b82f6); opacity: .85; border-radius: 2px; }
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
.drn-summary { font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); border: 1px dashed var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; }
.drn-try { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.drn-try-title { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.drn-fold { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.drn-fold-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); background: transparent; border: 0; padding: 10px 14px; cursor: pointer; text-align: left; }
.drn-fold-body { display: flex; flex-direction: column; gap: 12px; padding: 0 14px 14px; }
.drn-fold-body > .drn-group { border: 0; padding: 0; background: transparent; }
.drn-fold-body > .drn-group > .drn-group-title { display: none; }
.drn-help { display: flex; flex-direction: column; gap: 8px; }
.drn-help-body { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.drn-chevron { font-size: 11px; }
`

    // 字段表：kind 决定控件类型，group 决定分组，缺省值来自宿主 config。
    const FIELDS = [
      { key: 'cardsEnabled', group: 'basic', kind: 'boolean' },
      { key: 'seconds', group: 'basic', kind: 'number' },
      { key: 'position', group: 'basic', kind: 'select', options: ['br', 'center', 'tr'], optionLabels: ['positionBr', 'positionCenter', 'positionTr'] },
      { key: 'sound', group: 'basic', kind: 'boolean' },
      { key: 'cooldownMs', group: 'host', kind: 'number' },
      { key: 'retryHostOnce', group: 'host', kind: 'boolean' },
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
      // 0.20：卡片输入框回复、自定义按钮、专注助手静音、回复也推手机。
      { key: 'replyEnabled', group: 'queue', kind: 'boolean' },
      { key: 'customButtons', group: 'queue', kind: 'text' },
      { key: 'focusAssistMute', group: 'queue', kind: 'boolean' },
      { key: 'pushReply', group: 'digest', kind: 'boolean' },
      { key: 'snoozeMinutes', group: 'queue', kind: 'number' },
      { key: 'queueEnabled', group: 'queue', kind: 'boolean' },
      { key: 'queueMax', group: 'queue', kind: 'number' },
      { key: 'mergeWindowMs', group: 'queue', kind: 'number' },
      { key: 'maxHoldSeconds', group: 'queue', kind: 'number' },
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
      { key: 'pushFormat', group: 'digest', kind: 'select', options: ['wecom', 'serverchan', 'telegram', 'feishu', 'dingtalk', 'json', 'text'], optionLabels: ['pushFormatWecom', 'pushFormatServerchan', 'pushFormatTelegram', 'pushFormatFeishu', 'pushFormatDingtalk', 'pushFormatJson', 'pushFormatText'] },
      { key: 'pushChat', group: 'digest', kind: 'text' },
      { key: 'pushDecide', group: 'digest', kind: 'boolean' },
      { key: 'pushDigest', group: 'digest', kind: 'boolean' },
      // 0.18：条件提醒（余额、排队、宿主失败、免打扰、条数）。
      { key: 'conditionsEnabled', group: 'cond', kind: 'boolean' },
      { key: 'condBalanceBelow', group: 'cond', kind: 'boolean' },
      { key: 'condQueueBacklog', group: 'cond', kind: 'number' },
      { key: 'condHostFailures', group: 'cond', kind: 'number' },
      { key: 'condQuietEnter', group: 'cond', kind: 'boolean' },
      { key: 'condDailyCount', group: 'cond', kind: 'number' },
      { key: 'condCooldownMinutes', group: 'cond', kind: 'number' },
      // 0.18：原生系统通知与托盘热键。
      { key: 'toastEnabled', group: 'host', kind: 'boolean' },
      { key: 'toastSeconds', group: 'host', kind: 'number' },
      { key: 'trayEnabled', group: 'host', kind: 'boolean' },
      { key: 'trayHotkey', group: 'host', kind: 'text' },
      { key: 'hostMode', group: 'host', kind: 'select', options: ['script', 'exe'], optionLabels: ['hostModeScript', 'hostModeExe'] },
      { key: 'scriptPath', group: 'host', kind: 'text' },
      { key: 'powershellPath', group: 'host', kind: 'text' },
      { key: 'clientDir', group: 'host', kind: 'text', pick: 'directory' },
    ]

    const HINTS = {
      cardsEnabled: 'cardsEnabledHint',
      seconds: 'secondsHint',
      sound: 'soundHint',
      cooldownMs: 'cooldownHint',
      pushChat: 'pushChatHint',
      maxHoldSeconds: 'maxHoldSecondsHint',
      retryHostOnce: 'retryHostOnceHint',
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
      replyEnabled: 'replyEnabledHint',
      customButtons: 'customButtonsHint',
      focusAssistMute: 'focusAssistMuteHint',
      pushReply: 'pushReplyHint',
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
      conditionsEnabled: 'conditionsEnabledHint',
      condBalanceBelow: 'condBalanceBelowHint',
      condQueueBacklog: 'condQueueBacklogHint',
      condHostFailures: 'condHostFailuresHint',
      condQuietEnter: 'condQuietEnterHint',
      condDailyCount: 'condDailyCountHint',
      condCooldownMinutes: 'condCooldownMinutesHint',
      toastEnabled: 'toastEnabledHint',
      toastSeconds: 'toastSecondsHint',
      trayEnabled: 'trayEnabledHint',
      trayHotkey: 'trayHotkeyHint',
    }

    const GROUPS = ['basic', 'audio', 'look', 'queue', 'cond', 'history', 'digest', 'balance', 'host']
    const GROUP_LABELS = { basic: 'groupBasic', audio: 'groupAudio', look: 'groupLook', queue: 'groupQueue', cond: 'groupCond', history: 'groupHistory', digest: 'groupDigest', balance: 'groupBalance', host: 'groupHost' }

    // 0.13：面板分两层。常用层只放「不填就不对劲」的项，其余按主题收进四个折叠块。
    const COMMON_DIGEST = ['pushEnabled', 'pushUrl', 'pushFormat', 'digestEnabled', 'digestTime']
    const ADV_DIGEST = ['digestTitle', 'digestIncludeBalance', 'digestAlertCount', 'pushDecide', 'pushDigest']
    const ADV_BLOCKS = [
      { id: 'look', label: 'groupLook', groups: ['look'] },
      { id: 'audio', label: 'groupAudio', groups: ['audio'] },
      { id: 'queue', label: 'groupQueue', groups: ['queue'] },
      { id: 'cond', label: 'groupCond', groups: ['cond'] },
      { id: 'misc', label: 'groupAdvanced', groups: ['digest', 'history', 'balance', 'host'] },
      { id: 'backup', label: 'groupBackup', groups: [] },
      { id: 'stats', label: 'groupStats', groups: [] },
      { id: 'feedback', label: 'groupFeedback', groups: [] },
      { id: 'help', label: 'groupHelp', groups: [] },
      { id: 'doctor', label: 'groupDoctor', groups: [] },
    ]

    // 0.14：说明收进面板里，按条目折叠。
    const HELP_ITEMS = [
      { id: 'use', title: 'helpUse', body: 'helpUseText' },
      { id: 'card', title: 'helpCard', body: 'helpCardText' },
      { id: 'queue', title: 'helpQueue', body: 'helpQueueText' },
      { id: 'quiet', title: 'helpQuiet', body: 'helpQuietText' },
      { id: 'digest', title: 'helpDigest', body: 'helpDigestText' },
      { id: 'balance', title: 'helpBalance', body: 'helpBalanceText' },
      { id: 'host', title: 'helpHost', body: 'helpHostText' },
    ]

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
      const [recurring, setRecurring] = React.useState(null)
      const [recurringBusy, setRecurringBusy] = React.useState(false)
      const [mobile, setMobile] = React.useState(null)
      const [mobileBusy, setMobileBusy] = React.useState(false)
      const [digest, setDigest] = React.useState(null)
      const [digestBusy, setDigestBusy] = React.useState(false)
      // 0.13：折叠块的展开状态（默认全收起）与「试试看」的忙碌标记。
      const [openBlocks, setOpenBlocks] = React.useState({})
      const [tryBusy, setTryBusy] = React.useState(null)
      const [hintsOn, setHintsOn] = React.useState(() => {
        try {
          return window.localStorage.getItem('drn-hints') === '1'
        } catch (error) {
          return false
        }
      })
      const toggleHints = () => {
        const next = !hintsOn
        setHintsOn(next)
        try {
          window.localStorage.setItem('drn-hints', next ? '1' : '0')
        } catch (error) {
          // 存不了就算了，只影响下次默认值
        }
      }
      const [helpOpen, setHelpOpen] = React.useState({})
      const [doctor, setDoctor] = React.useState(null)
      const [tray, setTray] = React.useState(null)
      const [doctorBusy, setDoctorBusy] = React.useState(false)
      const [stats, setStats] = React.useState(null)
      const [backupList, setBackupList] = React.useState([])
      const [backupBusy, setBackupBusy] = React.useState(false)
      const [importText, setImportText] = React.useState('')
      const [statsBusy, setStatsBusy] = React.useState(false)
      const [feedbackText, setFeedbackText] = React.useState('')
      const [feedbackCategory, setFeedbackCategory] = React.useState('suggest')
      const [feedbackAttach, setFeedbackAttach] = React.useState(true)
      const [feedbackList, setFeedbackList] = React.useState([])
      const [feedbackBusy, setFeedbackBusy] = React.useState(false)
      const [feedbackIssue, setFeedbackIssue] = React.useState('')

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
        refreshRecurring()
        refreshMobile()
        refreshTray()
        refreshDigest()
        refreshStats()
        refreshBackup()
        refreshFeedback()
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

      // 0.16 自检：把宿主路径、提示音、历史可写、各项服务逐条查一遍；顺带能弹一张样卡验证宿主。
      function runDoctor(mode) {
        if (doctorBusy) return
        setDoctorBusy(true)
        setMessage(null)
        Promise.resolve()
          .then(() => {
            const init = mode === 'probe' || mode === 'github'
              ? {
                  method: 'POST',
                  headers: { 'content-type': 'application/json', accept: 'application/json' },
                  body: JSON.stringify({ mode }),
                }
              : { headers: { accept: 'application/json' } }
            return fetch(DOCTOR_ROUTE, init)
          })
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
            setDoctorBusy(false)
            if (data && data.report) setDoctor(data.report)
            const label = typeof t === 'function' ? t : (key) => key
            if (mode === 'github') {
              const probe = data && data.github ? data.github : {}
              if (probe.ok === true) {
                setMessage({ ok: true, text: label('doctorGithubOk') + String(probe.statusCode || '') + ' · ' + String(probe.ms || 0) + 'ms' })
              } else {
                setMessage({ ok: false, text: label('doctorGithubFailed') + String(probe.error || ('HTTP ' + (probe.statusCode || 0))) })
              }
              return
            }
            if (mode === 'probe') {
              const card = data && data.card ? data.card : {}
              if (card.ok === false) {
                setMessage({ ok: false, text: label('doctorProbeFailed') + String(card.detail || card.error || '') })
                return
              }
              setMessage({ ok: true, text: label('doctorProbeOk') })
            }
          })
          .catch((error) => {
            setDoctorBusy(false)
            const prefix = typeof t === 'function' ? t('doctorProbeFailed') : 'self-check failed: '
            setMessage({ ok: false, text: prefix + String((error && error.message) || error) })
          })
      }
      // 0.13「试试看」：让宿主真的弹一张样卡（POST /preview，mode=card），
      // 比读说明书更快知道每一档长什么样。样卡只停 20 秒，不改任何配置。
      function tryCard(kind) {
        if (tryBusy !== null) return
        setTryBusy(kind)
        setMessage(null)
        Promise.resolve()
          .then(() =>
            fetch(PREVIEW_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ mode: 'card', kind }),
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
            setTryBusy(null)
            const label = typeof t === 'function' ? t : (key) => key
            const card = data && data.card ? data.card : {}
            if (card.ok === false) {
              setMessage({ ok: false, text: label('tryFailed') + String(card.detail || card.error || '') })
              return
            }
            if (card.skipped === 'quiet') {
              setMessage({ ok: true, text: label('tryQuiet') })
              return
            }
            setMessage({ ok: true, text: label('tryShown') })
          })
          .catch((error) => {
            setTryBusy(null)
            const prefix = typeof t === 'function' ? t('tryFailed') : 'cannot show a sample: '
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

      function refreshMobile() {
        setMobileBusy(true)
        fetch(MOBILE_LINK_ROUTE, { headers: { accept: 'application/json' } })
          .then((res) => res.json())
          .then((data) => setMobile(data && data.ok ? data : { ok: false }))
          .catch(() => setMobile({ ok: false }))
          .then(() => setMobileBusy(false))
      }

      function copyMobile() {
        if (!mobile || !mobile.url) return
        const label = typeof t === 'function' ? t : (key) => key
        try {
          navigator.clipboard.writeText(mobile.url)
          setMessage({ ok: true, text: label('mobileCopied') })
        } catch {
          setMessage({ ok: true, text: mobile.url })
        }
      }

      function recurringFetch(options) {
        setRecurringBusy(true)
        return fetch(RECUR_ROUTE, options)
          .then((res) => res.json())
          .then((data) => {
            setRecurring(data && data.ok ? data : null)
          })
          .catch(() => setRecurring(null))
          .finally(() => setRecurringBusy(false))
      }

      function refreshRecurring() {
        recurringFetch({ headers: { accept: 'application/json' } })
      }

      function cancelRecurring(id) {
        return recurringFetch({
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ action: 'cancel', id }),
        })
      }

      function refreshHistory() {
        historyFetch({ headers: { accept: 'application/json' } })
      }

      function clearHistory() {
        historyFetch({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ mode: 'clear' }) })
      }

      async function runExport(format) {
        const label = typeof t === 'function' ? t : (key) => key
        try {
          const response = await fetch(`${EXPORT_ROUTE}?format=${format}&days=30`)
          const data = await response.json()
          if (data && data.ok === true) {
            setMessage(`${label('exportDone')}${data.file}（${data.count} 条）`)
          } else {
            setMessage(`${label('exportFailed')}${(data && (data.detail || data.error)) || ''}`)
          }
        } catch (error) {
          setMessage(`${label('exportFailed')}${String(error && error.message ? error.message : error)}`)
        }
      }

      function barsOf(buckets) {
        const list = Array.isArray(buckets) ? buckets.slice(-30) : []
        const max = list.reduce((top, item) => Math.max(top, Number(item && item.count) || 0), 0)
        return list.map((item, index) => {
          const count = Number(item && item.count) || 0
          const height = max > 0 ? Math.round((count / max) * 100) : 0
          return h('span', {
            key: 'b' + index,
            className: 'drn-bar',
            title: `${(item && item.date) || ''} · ${count}`,
            style: { height: `${Math.max(height, count > 0 ? 8 : 2)}%` },
          })
        })
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

      function recurringEveryText(job) {
        const minutes = Number(job && job.everyMinutes) || 0
        const text =
          minutes >= 1440 && minutes % 1440 === 0
            ? `${minutes / 1440} 天`
            : minutes >= 60 && minutes % 60 === 0
              ? `${minutes / 60} 小时`
              : `${minutes} 分钟`
        const title = (job && job.title) || (job && job.message) || ''
        const short = String(title).slice(0, 24)
        return `每 ${text} · ${short}`
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
          replied: 'historyActionReplied',
          custom: 'historyActionCustom',
          choice: 'historyActionChoice',
        }
        const head = [shortTime(entry.at), label(kinds[entry.kind] || 'historyKindRaw'), label(actions[entry.action] || entry.action)]
        if (entry.count > 1) head.push('×' + entry.count)
        if (String(entry.reply || '') !== '') head.push(label('historyReplyPrefix') + String(entry.reply).slice(0, 40))
        if (String(entry.button || '') !== '') head.push(label('historyButtonPrefix') + String(entry.button).slice(0, 16))
        if (String(entry.choice || '') !== '') head.push(label('historyChoicePrefix') + String(entry.choice).slice(0, 16))
        if (Array.isArray(entry.attachments) && entry.attachments.length > 0) head.push(label('historyAttachPrefix') + entry.attachments.length)
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

      // 一张分组卡片。allowed 有值时只渲染其中的键（用于把 digest 组拆成「常用」与「高级」两半）。
      const groupCard = (group, allowed, withExtras) => {
        const rows = FIELDS.filter(
          (field) => field.group === group && (allowed === undefined || allowed.includes(field.key)),
        ).map((field) =>
          h(
            'div',
            { className: 'drn-row', key: field.key },
            h(
              'div',
              { className: 'drn-row-main' },
              h('div', { className: 'drn-label' }, typeof t === 'function' ? t(field.key) : field.key),
              HINTS[field.key] && typeof t === 'function'
                ? h('div', { className: 'drn-hint drn-field-hint' }, t(HINTS[field.key]))
                : null,
            ),
            h('div', { className: 'drn-control' }, control(field)),
          ),
        )
        if (withExtras !== false && group === 'history') {
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
                h(
                  'button',
                  { type: 'button', className: 'drn-btn drn-digest-btn', disabled: historyBusy, onClick: () => runExport('csv') },
                  label('exportCsv'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'drn-btn drn-digest-btn', disabled: historyBusy, onClick: () => runExport('json') },
                  label('exportJson'),
                ),
              ),
            ),
          )
          const buckets = history && history.stats ? history.stats.last30 : null
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'history-chart' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, label('historyChart')),
                h('div', { className: 'drn-bars' }, barsOf(buckets)),
                h('div', { className: 'drn-hint' }, label('historyChartHint')),
              ),
            ),
          )
          const entries = history && Array.isArray(history.entries) ? history.entries.slice(0, 8) : []
          const jobs = recurring && Array.isArray(recurring.jobs) ? recurring.jobs : []
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'recurring-list' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, label('recurringTitle')),
                jobs.length === 0
                  ? h('div', { className: 'drn-hint' }, label('recurringNone'))
                  : jobs.map((job, index) =>
                      h(
                        'div',
                        { className: 'drn-hint', key: 'job' + index },
                        `${recurringEveryText(job)} · ${label('recurringNext')} ${shortTime(Date.parse(job.nextAt))}`,
                      ),
                    ),
                h('div', { className: 'drn-hint' }, label('recurringHint')),
              ),
              jobs.length === 0
                ? null
                : h(
                    'div',
                    { className: 'drn-pick' },
                    h(
                      'button',
                      { type: 'button', className: 'drn-btn drn-digest-btn', disabled: recurringBusy, onClick: refreshRecurring },
                      label('recurringRefresh'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'drn-btn drn-digest-btn',
                        disabled: recurringBusy,
                        onClick: () => {
                          const job = jobs[jobs.length - 1]
                          if (job) cancelRecurring(job.id)
                        },
                      },
                      label('recurringCancel'),
                    ),
                  ),
            ),
          )
          const mobileUrl = mobile && mobile.ok === true && mobile.url ? mobile.url : ''
          rows.push(
            h(
              'div',
              { className: 'drn-row', key: 'mobile-link' },
              h(
                'div',
                { className: 'drn-row-main' },
                h('div', { className: 'drn-label' }, label('mobileTitle')),
                h(
                  'div',
                  { className: 'drn-hint' },
                  mobileUrl === '' ? label(mobileBusy ? 'mobileLoading' : 'mobileUnavailable') : mobileUrl,
                ),
                h('div', { className: 'drn-hint' }, label('mobileHint')),
              ),
              h(
                'div',
                { className: 'drn-pick' },
                h(
                  'button',
                  { type: 'button', className: 'drn-btn drn-digest-btn', disabled: mobileBusy, onClick: refreshMobile },
                  label('mobileRefresh'),
                ),
                mobileUrl === ''
                  ? null
                  : h(
                      'button',
                      { type: 'button', className: 'drn-btn drn-digest-btn', disabled: mobileBusy, onClick: copyMobile },
                      label('mobileCopy'),
                    ),
              ),
            ),
          )
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
        if (withExtras !== false && group === 'digest') {
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
                  { type: 'button', className: 'drn-btn drn-digest-btn', disabled: digestBusy, onClick: refreshDigest },
                  label('digestRefresh'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'drn-btn drn-digest-btn', disabled: digestBusy, onClick: sendDigest },
                  label(digestBusy ? 'digestSending' : 'digestSend'),
                ),
              ),
            ),
          )
        }
        if (withExtras !== false && group === 'balance') {
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
      }

      const label = typeof t === 'function' ? t : (key) => key

      // 一句话状态：让人不开任何折叠就知道现在是「哪儿、多久、有没有声、推送/日报开没开」。
      const summaryText = () => {
        const posKey = values.position === 'center' ? 'positionCenter' : values.position === 'tr' ? 'positionTr' : 'positionBr'
        const sound = values.sound === false ? label('soundOff') : label('soundOn')
        const secs = values.seconds === undefined || values.seconds === null ? 60 : values.seconds
        const parts = [`${label(posKey)} · ${secs}${label('secondsUnit')} · ${sound}`]
        if (values.pushEnabled === true) {
          const fmt =
            values.pushFormat === 'serverchan'
              ? 'pushFormatServerchan'
              : values.pushFormat === 'json'
                ? 'pushFormatJson'
                : values.pushFormat === 'text'
                  ? 'pushFormatText'
                  : 'pushFormatWecom'
          parts.push(`${label('pushEnabled')} · ${label(fmt)}`)
        }
        if (values.digestEnabled === true) parts.push(`${label('digestEnabled')} · ${values.digestTime || '09:00'}`)
        return label('summaryPrefix') + parts.join(' · ')
      }

      const foldOf = (id, labelKey, children) => {
        const open = openBlocks[id] === true
        return h(
          'div',
          { className: 'drn-fold', key: 'fold-' + id },
          h(
            'button',
            {
              type: 'button',
              className: 'drn-fold-head',
              onClick: () => setOpenBlocks(Object.assign({}, openBlocks, { [id]: !open })),
            },
            h('span', null, label(labelKey)),
            h('span', { className: 'drn-chevron' }, open ? '▾ ' + label('foldCollapse') : '▸ ' + label('foldExpand')),
          ),
          h('div', { className: 'drn-fold-body', style: open ? undefined : { display: 'none' } }, children),
        )
      }
      const common = [
        groupCard('basic'),
        foldOf('digest', 'groupDigest', [groupCard('digest', COMMON_DIGEST, true)]),
      ]

      async function trayAction(action) {
        try {
          const res = await fetch(TRAY_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
          const data = await res.json()
          if (data && data.tray) setTray(data.tray)
          if (action === 'toast') {
            setMessage({ kind: data && data.sent ? 'ok' : 'error', text: label(data && data.sent ? 'trayToastOk' : 'trayToastFailed') })
          } else {
            setMessage({ kind: 'ok', text: label(action === 'stop' ? 'trayStopped' : 'trayStarted') })
          }
        } catch (error) {
          setMessage({ kind: 'error', text: label('trayFailed') + ' ' + String(error && error.message ? error.message : error) })
        }
      }
      async function refreshTray() {
        try {
          const res = await fetch(TRAY_ROUTE)
          const data = await res.json()
          if (data && data.tray) setTray(data.tray)
        } catch {
          /* 读不到就当作没开 */
        }
      }

      // 0.33：配置备份与恢复
      async function refreshBackup() {
        try {
          const res = await fetch(BACKUP_ROUTE)
          const data = await res.json()
          if (data && Array.isArray(data.backups)) setBackupList(data.backups)
        } catch {
          /* 读不到就留着上一次 */
        }
      }

      async function backupAction(action, name) {
        setBackupBusy(true)
        try {
          const res = await fetch(BACKUP_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, name }),
          })
          const data = await res.json()
          if (!data || data.ok !== true) throw new Error((data && data.error) || 'failed')
          if (action === 'save') setMessage({ kind: 'ok', text: label('backupSaved') + ' ' + String(data.name || '') })
          else setMessage({ kind: 'ok', text: label('backupRestored') + String(data.restored === undefined ? '' : data.restored) })
          await refreshBackup()
        } catch (error) {
          setMessage({ kind: 'error', text: label('backupFailed') + ' ' + String((error && error.message) || error) })
        } finally {
          setBackupBusy(false)
        }
      }

      async function importBackup() {
        const raw = String(importText || '').trim()
        if (raw === '') {
          setMessage({ kind: 'error', text: label('backupImportPlaceholder') })
          return
        }
        setBackupBusy(true)
        try {
          const res = await fetch(BACKUP_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'import', json: raw }),
          })
          const data = await res.json()
          if (!data || data.ok !== true) throw new Error((data && data.error) || 'failed')
          setImportText('')
          setMessage({ kind: 'ok', text: label('backupRestored') + String(data.restored === undefined ? '' : data.restored) })
          await refreshBackup()
        } catch (error) {
          setMessage({ kind: 'error', text: label('backupFailed') + ' ' + String((error && error.message) || error) })
        } finally {
          setBackupBusy(false)
        }
      }

      function backupBlock() {
        const list = Array.isArray(backupList) ? backupList : []
        return [
          h(
            'div',
            { className: 'drn-help', key: 'backup-panel' },
            h('div', { className: 'drn-head-intro' }, label('backupHint')),
            h(
              'div',
              { className: 'drn-pick' },
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: backupBusy, onClick: () => backupAction('save', '') }, label('backupNow')),
              h(
                'a',
                { className: 'drn-btn drn-digest-btn', href: BACKUP_ROUTE + '?download=1', target: '_blank', rel: 'noreferrer' },
                label('backupExport'),
              ),
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: backupBusy || list.length === 0, onClick: () => backupAction('restore', '') }, label('backupRestoreLatest')),
            ),
            h('div', { className: 'drn-hint' }, label('backupExportHint')),
            list.length === 0
              ? h('div', { className: 'drn-hint' }, label('backupNone'))
              : h(
                  'div',
                  { className: 'drn-help' },
                  list.slice(0, 5).map((item) =>
                    h(
                      'div',
                      { className: 'drn-hint', key: String(item && item.name) },
                      shortTime(item && item.at) + ' · ' + Math.max(1, Math.round(Number(item && item.size) / 1024)) + ' KB ',
                      h(
                        'button',
                        { type: 'button', className: 'drn-btn drn-digest-btn', disabled: backupBusy, onClick: () => backupAction('restore', item && item.name) },
                        label('backupRestore'),
                      ),
                    ),
                  ),
                ),
            h('textarea', {
              className: 'drn-feedback-text',
              rows: 3,
              value: importText,
              placeholder: label('backupImportPlaceholder'),
              onChange: (event) => setImportText(event.currentTarget.value),
            }),
            h(
              'div',
              { className: 'drn-pick' },
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: backupBusy || String(importText || '').trim() === '', onClick: () => importBackup() }, label('backupImport')),
            ),
          ),
        ]
      }

      // 0.32：本插件下载量（npm 公开统计）
      async function refreshStats(force) {
        setStatsBusy(true)
        try {
          const res = await fetch(STATS_ROUTE + (force === true ? '?refresh=1' : ''))
          const data = await res.json()
          if (data && data.stats) setStats(data.stats)
          else setStats({ error: (data && data.error) || 'unavailable' })
        } catch (error) {
          setStats({ error: String((error && error.message) || error) })
        } finally {
          setStatsBusy(false)
        }
      }

      function statsBlock() {
        const value = stats || {}
        const series = Array.isArray(value.series) ? value.series : []
        const max = series.reduce((top, item) => Math.max(top, Number(item && item.downloads) || 0), 0)
        const bars = series.map((item, index) => {
          const count = Number(item && item.downloads) || 0
          const height = max > 0 ? Math.round((count / max) * 100) : 0
          return h('span', {
            key: 'ns' + index,
            className: 'drn-bar',
            title: String((item && item.day) || '') + ' · ' + count,
            style: { height: Math.max(height, count > 0 ? 8 : 2) + '%' },
          })
        })
        return [
          h(
            'div',
            { className: 'drn-help', key: 'stats-panel' },
            h('div', { className: 'drn-head-intro' }, label('statsHint')),
            value.error
              ? h('div', { className: 'drn-hint' }, label('statsFailed') + ' ' + String(value.error))
              : h(
                  'div',
                  { className: 'drn-hint' },
                  label('statsYesterday') + ' ' + String(value.day === undefined ? '—' : value.day) + ' · ' +
                    label('statsWeek') + ' ' + String(value.week === undefined ? '—' : value.week) + ' · ' +
                    label('statsMonth') + ' ' + String(value.month === undefined ? '—' : value.month),
                ),
            series.length > 0 ? h('div', { className: 'drn-bars' }, bars) : null,
            h(
              'div',
              { className: 'drn-hint' },
              label('statsUpdated') + ' ' + (value.at ? shortTime(Date.parse(value.at)) : '—') + (value.cached ? ' · ' + label('statsCached') : ''),
            ),
            h(
              'div',
              { className: 'drn-pick' },
              h(
                'button',
                { type: 'button', className: 'drn-btn drn-digest-btn', disabled: statsBusy, onClick: () => refreshStats(true) },
                label(statsBusy ? 'statsLoading' : 'statsRefresh'),
              ),
            ),
          ),
        ]
      }

      // 0.32：反馈与留言（本地 JSONL + 一键提交 issue）
      function feedbackCategoryLabel(category) {
        const key = category === 'problem' ? 'feedbackCategoryProblem' : category === 'experience' ? 'feedbackCategoryExperience' : 'feedbackCategorySuggest'
        return label(key)
      }

      async function refreshFeedback() {
        try {
          const res = await fetch(FEEDBACK_ROUTE)
          const data = await res.json()
          if (data && Array.isArray(data.entries)) setFeedbackList(data.entries)
        } catch {
          /* 读不到就留着上一次 */
        }
      }

      async function deleteFeedback(id) {
        try {
          const res = await fetch(FEEDBACK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'delete', id }),
          })
          const data = await res.json()
          if (data && Array.isArray(data.entries)) setFeedbackList(data.entries)
        } catch (error) {
          setMessage({ kind: 'error', text: label('feedbackFailed') + ' ' + String((error && error.message) || error) })
        }
      }

      async function saveFeedback(action) {
        const text = String(feedbackText || '').trim()
        if (text === '') {
          setMessage({ kind: 'error', text: label('feedbackEmpty') })
          return
        }
        if (action === 'copy') {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text)
            setMessage({ kind: 'ok', text: label('feedbackCopied') })
          } catch {
            setMessage({ kind: 'error', text: label('feedbackCopyFailed') })
          }
          return
        }
        setFeedbackBusy(true)
        try {
          const res = await fetch(FEEDBACK_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, category: feedbackCategory, env: feedbackAttach === true }),
          })
          const data = await res.json()
          if (!data || data.ok !== true) throw new Error((data && data.error) || 'failed')
          setFeedbackList((current) => [data.entry].concat(Array.isArray(current) ? current : []).slice(0, 20))
          setFeedbackText('')
          if (action === 'issue' && data.issueUrl) {
            setFeedbackIssue(data.issueUrl)
            try {
              window.open(data.issueUrl, '_blank', 'noopener')
            } catch {
              /* 弹窗被拦就用下面那条链接 */
            }
            setMessage({ kind: 'ok', text: label('feedbackIssueOpened') })
          } else {
            setMessage({ kind: 'ok', text: label('feedbackSaved') })
          }
        } catch (error) {
          setMessage({ kind: 'error', text: label('feedbackFailed') + ' ' + String((error && error.message) || error) })
        } finally {
          setFeedbackBusy(false)
        }
      }

      function feedbackBlock() {
        const list = Array.isArray(feedbackList) ? feedbackList : []
        return [
          h(
            'div',
            { className: 'drn-help', key: 'feedback-panel' },
            h('div', { className: 'drn-head-intro' }, label('feedbackHint')),
            h('textarea', {
              className: 'drn-feedback-text',
              rows: 4,
              maxLength: 2000,
              value: feedbackText,
              placeholder: label('feedbackPlaceholder'),
              onChange: (event) => setFeedbackText(event.currentTarget.value),
            }),
            h(
              'div',
              { className: 'drn-pick' },
              h(
                'select',
                { className: 'drn-select', style: { maxWidth: '160px' }, value: feedbackCategory, onChange: (event) => setFeedbackCategory(event.currentTarget.value) },
                h('option', { value: 'suggest' }, label('feedbackCategorySuggest')),
                h('option', { value: 'problem' }, label('feedbackCategoryProblem')),
                h('option', { value: 'experience' }, label('feedbackCategoryExperience')),
              ),
              h(
                'label',
                { className: 'drn-hint' },
                h('input', { type: 'checkbox', checked: feedbackAttach, onChange: (event) => setFeedbackAttach(event.currentTarget.checked) }),
                ' ' + label('feedbackAttachEnv'),
              ),
            ),
            h(
              'div',
              { className: 'drn-pick' },
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: feedbackBusy, onClick: () => saveFeedback('save') }, label('feedbackSave')),
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: feedbackBusy, onClick: () => saveFeedback('copy') }, label('feedbackCopy')),
              h('button', { type: 'button', className: 'drn-btn drn-digest-btn', disabled: feedbackBusy, onClick: () => saveFeedback('issue') }, label('feedbackIssue')),
            ),
            feedbackIssue === ''
              ? null
              : h(
                  'div',
                  { className: 'drn-hint' },
                  label('feedbackIssueTip'),
                  h('a', { href: feedbackIssue, target: '_blank', rel: 'noreferrer' }, feedbackIssue.slice(0, 80) + '…'),
                ),
            list.length === 0
              ? h('div', { className: 'drn-hint' }, label('feedbackNone'))
              : h(
                  'div',
                  { className: 'drn-help' },
                  list.slice(0, 5).map((entry) =>
                    h(
                      'div',
                      { className: 'drn-hint', key: String(entry && entry.id) },
                      shortTime(entry && entry.at) + ' · ' + feedbackCategoryLabel(entry && entry.category) + ' · ' + String((entry && entry.text) || '').slice(0, 60) + ' ',
                      h('button', { type: 'button', className: 'drn-btn drn-digest-btn', onClick: () => deleteFeedback(entry && entry.id) }, label('feedbackDelete')),
                    ),
                  ),
                ),
          ),
        ]
      }

      const advanced = ADV_BLOCKS.map((block) => {
        const open = openBlocks[block.id] === true
        const children = block.id === 'backup' ? backupBlock() : block.id === 'stats' ? statsBlock() : block.id === 'feedback' ? feedbackBlock() : block.id === 'doctor'
          ? [
              h(
                'div',
                { className: 'drn-help', key: 'doctor-panel' },
                h('div', { className: 'drn-head-intro' }, label('doctorHint')),
                doctor === null
                  ? h('div', { className: 'drn-hint' }, label('doctorNotRun'))
                  : h(
                      'div',
                      { className: 'drn-help' },
                      h('div', { className: 'drn-hint' }, doctor.ok === true ? label('doctorAllOk') : label('doctorHasFailures')),
                      (doctor.checks || []).map((check, index) =>
                        h(
                          'div',
                          { className: 'drn-hint', key: 'check-' + index },
                          (check.ok ? '✓ ' : '✗ ') + label('check_' + String(check.id || '').replace(/-/g, '_')) + ' · ' + String(check.detail || ''),
                        ),
                      ),
                      h('div', { className: 'drn-hint' }, label('doctorLastExit') + ' ' + String(doctor.host && doctor.host.lastExit === null ? '—' : doctor.host && doctor.host.lastExit) + ' · ' + label('doctorFailures') + ' ' + String(doctor.host ? doctor.host.failureCount : 0)),
                    ),
                h(
                  'div',
                  { className: 'drn-pick' },
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', disabled: doctorBusy, onClick: () => runDoctor('check') },
                    label(doctorBusy ? 'doctorRunning' : 'doctorRun'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', disabled: doctorBusy, onClick: () => runDoctor('probe') },
                    label('doctorProbe'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', disabled: doctorBusy, onClick: () => runDoctor('github') },
                    label(doctorBusy ? 'doctorRunning' : 'doctorGithub'),
                  ),
                ),
                h(
                  'div',
                  { className: 'drn-hint', key: 'tray-state' },
                  label('trayStatus') + ' ' + (tray && tray.running ? label('trayRunning') + ' · PID ' + String(tray.pid) : label('trayStoppedState')) + (tray && tray.hotkey ? ' · ' + String(tray.hotkey) : ''),
                ),
                h(
                  'div',
                  { className: 'drn-pick', key: 'tray-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', onClick: () => trayAction('start') },
                    label('trayStart'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', onClick: () => trayAction('stop') },
                    label('trayStop'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', onClick: () => trayAction('toast') },
                    label('trayToastTest'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'drn-btn drn-digest-btn', onClick: () => refreshTray() },
                    label('trayRefresh'),
                  ),
                ),
              ),
            ]
          : block.id === 'help'
          ? [
              h(
                'div',
                { className: 'drn-help', key: 'help-list' },
                h('div', { className: 'drn-head-intro' }, label('helpIntro')),
                HELP_ITEMS.map((item) => {
                  const opened = helpOpen[item.id] === true
                  return h(
                    'div',
                    { className: 'drn-fold', key: 'help-' + item.id },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'drn-fold-head',
                        onClick: () => setHelpOpen(Object.assign({}, helpOpen, { [item.id]: !opened })),
                      },
                      h('span', null, label(item.title)),
                      h('span', { className: 'drn-chevron' }, opened ? '▾ ' + label('foldCollapse') : '▸ ' + label('foldExpand')),
                    ),
                    h(
                      'div',
                      { className: 'drn-fold-body', style: opened ? undefined : { display: 'none' } },
                      h('div', { className: 'drn-help-body' }, label(item.body)),
                    ),
                  )
                }),
                h('div', { className: 'drn-head-intro' }, label('helpTip')),
              ),
            ]
          : block.groups.map((group) =>
              group === 'digest' ? groupCard('digest', ADV_DIGEST, false) : groupCard(group),
            )
        return foldOf(block.id, block.label, children)
      })

      const tryRow = h(
        'div',
        { className: 'drn-try' },
        h('span', { className: 'drn-try-title' }, label('tryTitle')),
        h(
          'button',
          { type: 'button', className: 'drn-btn drn-try-btn', disabled: tryBusy !== null, onClick: () => tryCard('done') },
          label('tryDone'),
        ),
        h(
          'button',
          { type: 'button', className: 'drn-btn drn-try-btn', disabled: tryBusy !== null, onClick: () => tryCard('decide') },
          label('tryDecide'),
        ),
        h(
          'button',
          { type: 'button', className: 'drn-btn drn-try-btn', disabled: tryBusy !== null, onClick: () => tryCard('raw') },
          label('tryRaw'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'drn-btn drn-hints-btn',
            title: label(hintsOn ? 'hintsHideHint' : 'hintsShowHint'),
            onClick: toggleHints,
          },
          label(hintsOn ? 'hintsHide' : 'hintsShow'),
        ),
      )

      return h(
        'div',
        { className: hintsOn ? 'drn-panel' : 'drn-panel drn-hints-off' },
        h(
          'div',
          { className: 'drn-head' },
          h('div', { className: 'drn-head-title' }, typeof t === 'function' ? t('title') : 'Desktop reminder settings'),
          h('div', { className: 'drn-head-intro' }, typeof t === 'function' ? t(writable ? 'intro' : 'readonly') : ''),
          h('div', { className: 'drn-summary' }, summaryText()),
        ),
        tryRow,
        common,
        advanced,
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
