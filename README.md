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

返回值是 JSON（`pid`、`host`、`audio`、`hostMode`），失败也不抛异常。

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

## 已知限制

- 仅 Windows（`os: ["win32"]`）：卡片宿主是 WinForms。
- 每次弹卡片要起一个 PowerShell 进程，`Add-Type` 编译约 0.6 s 才出现（有轻微延迟，播放与动画照旧）。
- 卡片随 DSH 宿主进程存活；DSH 关掉时正在显示的卡片也会一起消失。
