# dsh-reminder-notify

给 DeepSeek Harness 加一个 **`notify_user`** 工具：模型在任务收尾（`kind=done`）或征求同意之前（`kind=decide`）调用它，屏幕上就弹一张右下角卡片 + 播放对应语音，不抢焦点、按秒自动关闭。

**仓库里没有任何 exe**：卡片由包内的 `host/ReminderHost.ps1` 用系统自带的 PowerShell 5.1 + WinForms 在运行期编译绘制（`Add-Type` + 内联 C#），所以下载后不会被 SmartScreen / 杀软当成未知程序拦下来，也不需要代码签名证书。

## 装

```bash
dsh plugin --profile desktop add link:<本目录绝对路径>
# 或在插件页用 install_bundle 指向本目录
```

装完新会话就有 `notify_user`。

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
