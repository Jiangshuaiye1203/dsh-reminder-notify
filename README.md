# dsh-reminder-notify

给 DeepSeek Harness 加一个 **`notify_user`** 工具：模型在任务收尾（`kind=done`）或征求同意之前（`kind=decide`）调用它，屏幕上就弹一张右下角卡片 + 播放对应语音，不抢焦点、按秒自动关闭。

**仓库里没有任何 exe**：卡片由包内的 `host/ReminderHost.ps1` 用系统自带的 PowerShell 5.1 + WinForms 在运行期编译绘制（`Add-Type` + 内联 C#），所以下载后不会被 SmartScreen / 杀软当成未知程序拦下来，也不需要代码签名证书。

## 装

```bash
dsh plugin --profile desktop add link:<本目录绝对路径>
# 或在插件页用 install_bundle 指向本目录
```

装完新会话就有 `notify_user`。

## 0.18 起多了什么

- **条件提醒**：不用等模型调用，满足条件就自己弹一张——余额跌破阈值、卡片排队积压、宿主连续失败、进入免打扰时段、当天提醒条数超限（各条可单独开关，同一条有冷却）。
- **原生系统通知**：`toastEnabled` 打开后，卡片弹出的同时在 Windows 右下角发一个系统气泡（`host/ToastHost.ps1`，`NotifyIcon.ShowBalloonTip`，3–60 秒）。
- **托盘与热键**：`trayEnabled` 打开后起托盘图标（`host/TrayHost.ps1`），菜单里有静音 / 免打扰 / 打开目录；`Ctrl+Alt+R`（可改 `trayHotkey`）随时手弹一张提醒。面板「工程与可靠性：自检」里能启停托盘、发一条原生通知、看托盘状态。

## 0.19 起多了什么

- **周期提醒**：`notify_user(kind, message, every: "30m", times: 5)` 会登记一条周期任务（`30m` / `2h` / `1d`，1 分钟–7 天），到点自己弹卡；`times` 不传就一直重复。任务存在 `~/.dsh/dsh-reminder-notify/recurring.json`，`GET /dsh-reminder-notify/recurring` 能看列表，POST `{"action":"cancel","id":"…"}` 或 `{"action":"cancel-all"}` 可取消。
- **历史图表**：面板「历史与统计」里多了一排 30 天柱状图（每天一根，鼠标停上去看日期和条数），一眼看出哪天提醒多。

## 0.22.1 修了什么

- 手机页的「安装到桌面」在内网 http 地址上以前点了没反应（浏览器对 http 页面不注册 service worker、也不发安装事件）。现在按安全上下文分流：http 地址显示「添加到主屏幕」并给出 Safari / Chrome 的菜单路径说明，https 地址才走真正的 PWA 安装与离线缓存。

## 0.22 起多了什么

- **手机页面能装到桌面了**：手机浏览器打开面板里那个地址，页面顶部会出现「安装到桌面」按钮（iOS 用 Safari 的「添加到主屏幕」），装完像个小 App 一样有图标、全屏打开，离线时也能看见上次的内容。
- **手机回话会自己跑到模型眼前**：你在手机上回一句话，下一次模型开始干活时，提示词里会带上「用户刚从手机上回了话」和原文，不用你再复制一次；`GET /dsh-reminder-notify/mobile/inbox` 能看还有几条没被读走，`POST` 一下记成已读。
## 0.27 起：设置里的小字默认收起

面板右上角多了一个「显示小字 / 隐藏小字」按钮：默认收起每一项下面的说明文字，只看标题和控件，
想读说明时点一下展开（选择记在浏览器 localStorage 里，下次打开还是上次的选择）。

## 0.26 起：详情页只留两行

插件详情页里那段说明原来有十几行（含各版本更新），把设置面板顶得很靠下。现在说明只留两行：
一句话说清插件干什么 + 一句话告诉你「开关都在下面面板里」。历史版本更新都收在 README，面板里的「使用说明」仍是逐条折叠。

## 0.25 起多了什么

- 手机页可以有 https 入口：跑一次 `scripts/make-cert.ps1`（生成自签证书 `~/.dsh/dsh-reminder-notify/mobile.pfx`），
  配置里把「https 入口」打开（默认端口 1319），手机打开 `https://<内网IP>:1319/dsh-reminder-notify/mobile?t=<口令>`。
  在这个地址上浏览器才给麦克风（能录音），「安装到桌面」也才是真 PWA；首次会提示证书不受信任，选继续访问即可。面板里改完这个开关 5 秒内生效，不用重启。
- https 入口只放行手机页相关路径，其它接口一律 404。

## 0.24 起多了什么

手机页从「一屏最近记录」升级成完整小 App，三页切换（地址后面自动带你配置的口令）：

- **概览**：今天 / 总共 / 要你决定 三块统计 + 最近 7 天的柱状图 + 最近 5 条。
- **历史**：按「全部 / 完成 / 要你决定 / 普通」筛选，每页 20 条，带上一页下一页。
- **设置**：提示音、免打扰、推送到手机、每日日报、系统通知气泡五个开关（点保存立即生效），
  外加「导出 CSV / 导出 JSON」（近 30 天，直接下载到手机），以及停留秒数、位置、日报时间等只读状态。
- 新增路由：`GET /dsh-reminder-notify/mobile/export?format=csv|json&days=30`（带 `t` 口令，返回下载）、
  `POST /dsh-reminder-notify/mobile/settings`（body `{"values":{...}}`，只接受上面五个开关）。
- 手机页的输入框 / 附件按钮仍然吸在底部，任何一页都能直接回话。
- 0.24.1：底部那块（附件按钮 + 输入框）比较高，把页面底部留白从 40px 加到 190px，否则最后一屏内容会被挡住。

## 0.23 起多了什么

- **手机回话可以带图片和语音**：手机页底部有「拍照 / 选图」「录一段话」「选音频」三个入口，最多 3 个附件、单个 12MB；
  文件存在本机 `~/.dsh/dsh-reminder-notify/uploads/`，不进公网。
- 带附件的回话进历史时记成 `附件 N`，提示词里写成「手机回话：…（附 2 个：a.png、b.webm）」，模型能看到文件名并自己去读。
- 上传走 `POST /dsh-reminder-notify/mobile/upload?t=<口令>`（body 是原始文件字节，`content-type` 决定扩展名；
  支持 jpg/png/webp/gif/wav/mp3/m4a/ogg/webm）。
- 0.23.1：把「拍照 / 选图 / 录音」和输入框一起吸在页面底部——之前它们排在长列表末尾，手机上一进页面根本看不到。


## 0.21 起多了什么

- **手机页面（局域网）**：面板「高级：历史、余额与宿主」里会显示一个 `http://<内网IP>:<端口>/dsh-reminder-notify/mobile?t=…` 地址。
  手机连同一个 Wi-Fi 打开它，就能看最近的提醒、点「发送」回一句话（回话会进历史、按 `pushReply` 推手机）。
  地址里的 `t=` 是随机口令（存在配置 `mobileToken`，留空时第一次取地址自动生成），别外传；不走公网、不需要备案。
- 想把口令换掉：把配置里的 `mobileToken` 清空，再点一次「刷新地址」即可重新生成。

## 0.20 起多了什么

- **卡片上能回话**：`replyEnabled` 打开后卡上有输入框，打完按 Enter 就把这句话回给模型（`GET /dsh-reminder-notify/replies` 能取到最近 20 条，服务里也有 `replies()`）。
- **自定义按钮**：`customButtons` 写「标签|网址」，多条分号隔开，最多 3 个；单条提醒也可以带 `buttons: [{ label, url }]`。
- **专注助手静音**：`focusAssistMute` 打开后，Windows 专注助手 / 演示模式开着时卡片照弹但不响。

- **0.20.1 修了一个漏的**：`notify_user` 的 `buttons` 现在真的会传到卡片（之前只有全局 `customButtons` 生效）。

## 0.18.1 修了什么

- **面板路由更稳**（0.18.1）：冷启动时 `webServer` 可能比插件晚就绪，路由现在会等它就绪再挂（最多等 60 秒），不再出现「面板一直 404」。

## 0.17 起多了什么

- **定时提醒**：`notify_user` 支持 `at: "22:00"`（今天已过就排到明天）或 `inMinutes: 25`，到点才弹，不进队列占位。
- **优先级**：`decide` 卡永远排在 `done`/`raw` 前面；`maxHoldSeconds` 可给任何卡设「最多挂多久」。
- **卡片上的链接**：传 `url` 会在卡上加「打开链接」按钮；键盘 `Enter` 知道了、`S` 稍后提醒、`Esc` 关掉。
- **历史导出**：面板「历史与统计」多了「导出 CSV / 导出 JSON」，文件落在桌面，统计里同时给近 30 天。
- **更多推送格式**：除企业微信/Server酱/JSON/纯文本，还支持 Telegram（填 chat_id）、飞书、钉钉。
- **服务契约第 2 版**：`ctx.get('reminder')` 现在带 `apiVersion`、`events()`（最近 20 条 shown/notified）和 `registerSource()`，别的插件也能挂自己的提醒来源。

## 用

| 场景 | 调用 |
| --- | --- |
| 活儿干完了 | `notify_user(kind="done")` |
| 要用户拍板 | `notify_user(kind="decide")` |
| 自定义 | `notify_user(kind="raw", title="…", message="…", seconds=20, sound=false)` |

返回值是 JSON（`pid`、`host`、`audio`、`hostMode`、`queued` 等），失败也不抛异常。

0.11 起卡片的行为：

- 卡片右下角有「知道了」和「稍后提醒」（`buttonsEnabled`，默认开）；点「稍后」会过 `snoozeMinutes` 分钟再弹一次。
- 多条提醒**排队**显示（`queueEnabled`）；同档位在 `mergeWindowMs` 内再次触发会**并进**排队中的那一条，不重复弹。
- **免打扰时段**（`quietEnabled` + `quietStart`/`quietEnd`，`quietMode: hold|skip`）只压「完成」和普通提醒，「需要你来决定」照弹。
- 前台是全屏应用时自动换窄卡片（`compactOnFullscreen`）。
- `speakEnabled` 用系统语音把标题和正文念出来（需要中文语音包）。
- 每条结果写进 `~/.dsh/dsh-reminder-notify/history.json`（`historyEnabled` / `historyLimit`），
  插件页「历史与统计」里能看到总计 / 今日条数和最近记录，可以一键清空。

0.12 起多了两件「离屏也能知道」的事：

- **每日日报**（`digestEnabled` + `digestTime`，默认 09:00）：到点弹一张卡，写今天弹了几条、你点掉了几条，
  末尾附当前余额；一天只发一条，关机错过不补。
- **条数预警**（`digestAlertCount`，默认 0 = 关）：当天提醒条数超过阈值时，额外弹一张「提醒有点多」。
- **手机推送**（`pushEnabled` + `pushUrl` + `pushFormat`）：`wecom` 企业微信机器人 / `serverchan` Server 酱 /
  `json` 通用 webhook / `text` 纯文本；`pushDecide` 管「需要你来决定」要不要推，`pushDigest` 管日报要不要推。
  推送失败不影响桌面卡片，也不会拖慢 `notify_user`。

0.13 起设置面板只放「要改的东西」：

- 顶部一行状态摘要（位置 · 秒数 · 提示音，开了推送/日报再各加一段）+ 三个「试试看」按钮（完成卡 / 决定卡 / 通用卡），
  点了就立刻弹一张样卡，二十秒自动关，不用等我真发。
- 常用两组直接展开：**基本**、**日报与推送**；其余四块（外观 / 提示音 / 排队与免打扰 / 历史·余额·宿主）收在「高级」里，点标题展开。
- 使用说明不再塞进面板，全部写在插件详情页（本插件的说明文档）里。

## 资产

| 东西 | 位置 |
| --- | --- |
| 卡片宿主 | `host/ReminderHost.ps1`（纯文本，约 10 KB） |
| 提示音 | `assets/提示音导入/{完成提醒语音,需要你来决定}.wav` |
| 图标 | `icon.svg` |

整包只有音频是二进制，剩下的都是可读文本。

## 为什么不用 exe

旧方案是 `spawn('Harness完成提醒.exe', argv)`——弹出效果一样好，但分享给别人时：
未签名 exe 会被 SmartScreen 拦一次，杀软可能直接删掉它，用户还得先「仍要运行」。

现在宿主是脚本：仓库零二进制、可审计、可改样式；`hostMode: "exe"` 仍然保留，
给自己已经装了客户端的机器当兼容开关。

## 配置

都在插件 Config 里（`cordis.patch.yml` / 插件页）：`seconds`（默认 60）、`position`（`br`/`center`/`tr`）、
`sound`、`doneAudio`/`decideAudio`、`accentDone`/`accentDecide`/`accentRaw`、`cooldownMs`（默认 1500）。
`hostMode` 切宿主实现，`scriptPath`/`powershellPath`/`audioDir` 一般不用动。

0.11 新增：`speakEnabled`、`buttonsEnabled`、`snoozeMinutes`（10）、`queueEnabled`、`queueMax`（5）、
`mergeWindowMs`（3000）、`quietEnabled`、`quietStart`（`22:00`）、`quietEnd`（`08:00`）、
`quietMode`（`hold`/`skip`）、`compactOnFullscreen`、`historyEnabled`、`historyLimit`（200）、
`historyFile`（留空 = `~/.dsh/dsh-reminder-notify/history.json`）。

0.12 新增：`digestEnabled`（false）、`digestTime`（09:00）、`digestTitle`（今日提醒日报）、`digestIncludeBalance`（true）、`digestAlertCount`（0）、`pushEnabled`（false）、`pushUrl`、`pushFormat`（wecom）、`pushDecide`（true）、`pushDigest`（true）。

## 已知限制

- 仅 Windows（`os: ["win32"]`）：卡片宿主是 WinForms。
- 每次弹卡片要起一个 PowerShell 进程，`Add-Type` 编译约 0.6 s 才出现（有轻微延迟，播放与动画照旧）。
- 卡片随 DSH 宿主进程存活；DSH 关掉时正在显示的卡片也会一起消失。

## 给别的插件用（0.15 起）

插件把整套提醒能力挂在宿主的一个服务上，别的插件不用自己起 PowerShell、也不用重复写排队与免打扰逻辑：

```js
const reminder = ctx.get('reminder')          // 服务名固定为 reminder
await reminder.notify('decide', { message: '有个改动等你点头', seconds: 30 })
await reminder.digest({ force: true })        // 忽略「今天已发过」，立刻发一条日报
reminder.stats()                              // { total, today, byKind, byAction, last7 }
reminder.config()                             // 当前生效配置的只读副本
```

`notify()` 的 `kind` 与 `notify_user` 一致（`done` / `decide` / `raw`），其余参数同工具参数；调用同样受冷却、排队、合并、免打扰、历史记录约束。

## 出问题先自检（0.16 起）

面板「高级：历史、余额与宿主」里的「工程与可靠性：自检」有三个按钮：**运行自检**（逐项打勾）、**弹样卡**、**测 GitHub**。
其中「GitHub 连通性」一项会在 hosts 里发现「把 github.com 指到 127.0.0.1」的本机重定向时标红——那是 Steam++（Watt Toolkit）
加速 GitHub 的做法：加速器在跑时正常，它没接管（只开了进程没点「一键加速」/被强杀）时浏览器和 git 都会连不上。

推送时如果遇到这种情况，直接跑：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-push.ps1 -Token ghp_xxx
```

它会先测通不通；不通且发现本机重定向就临时注释 + 刷 DNS 再测，通了才 push，结束再按原样还原 hosts（`-KeepChanges` 保留改动、`-DryRun` 只探测不推送）。


设置面板最下面的「工程与可靠性：自检」里有两个按钮：

- **运行自检**：逐条检查系统 / PowerShell / 宿主脚本 / 提示音目录与文件 / 历史文件可写 / 面板路由 / `notify_user` / 配置可写 / 余额接口 / 宿主服务 API / 最近一次宿主退出码，✗ 会带上具体路径或原因。
- **弹样卡**：真的弹一张 12 秒的卡，能看到就说明宿主链路正常（比读日志快）。

宿主兜底：卡片该写结果文件却没写（被杀、被策略拦下、非零退出）时，会记一条 `host-failed` 到历史，并在 0.8 秒后**静音重试一次**（`retryHostOnce`，默认开）；最近 5 次失败原因显示在自检块里。

CI 在 `.github/workflows/ci.yml`：Ubuntu 与 Windows 各跑 node 20/22，做语法检查 + 两套无窗口自检（真弹卡的自检只在本机跑，CI 没有交互桌面）。
