# 桌面提醒 dsh-reminder-notify

给 DeepSeek Harness 加一个 `notify_user` 工具：模型在任务收尾（`kind=done`）或征求同意之前（`kind=decide`）调用它，屏幕右下角弹出提醒卡片并播放对应语音，不抢焦点、按秒自动关闭。

卡片宿主是包内的 `host/ReminderHost.ps1`——用系统自带的 PowerShell 5.1 + WinForms 在运行期绘制，仓库里没有任何 exe，下载安装不会被 SmartScreen / 杀软拦。

## 设置

在「插件」页打开「桌面提醒」，描述下方就是设置面板，分四组：

- **基本**：停留秒数、弹窗位置、是否播放提示音
- **提示音**：提示音目录（可点「浏览…」选目录）、三档提示音文件名（wav / mp3），选了目录后下拉框会列出目录里的音频
- **外观**：背景图、标题图标、强调色、标题/正文模板（`{title}` `{message}` `{kind}` `{time}`），以及每档位单独覆盖的背景 / 图标 / 模板
- **宿主**：脚本模式或 exe 模式、脚本路径、PowerShell 路径

改完点「保存」，立刻生效，不用重启。

## 已知限制

- 仅 Windows（`os: ["win32"]`）：卡片宿主是 WinForms。
- 每次弹卡片要起一个 PowerShell 进程，`Add-Type` 编译约 0.6 s 才出现。
- 卡片随 DSH 宿主进程存活；DSH 关掉时正在显示的卡片也会一起消失。
