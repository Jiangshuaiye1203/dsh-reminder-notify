# 分发说明（不经过插件市场，直接发文件）

适用场景：暂时没有可用的插件索引（GitHub 打不开 / 还没上架），直接把插件发给别人装。
包内**没有任何 exe**，卡片由系统自带的 PowerShell 5.1 + WinForms 绘制，不需要签名、不会被 SmartScreen 拦。

## 对方要做的事（3 步）

1. 把 `dsh-reminder-notify-0.2.0.zip` 解压到任意目录，例如
   `C:\Users\<用户名>\Downloads\dsh-reminder-notify`
2. 打开 DeepSeek Harness → **插件** 页 → 安装 → 粘贴**解压后那个文件夹的绝对路径**：
   ```
   C:\Users\<用户名>\Downloads\dsh-reminder-notify
   ```
   （或者命令行：`dsh plugin --profile desktop add "C:\Users\<用户名>\Downloads\dsh-reminder-notify"`）
3. 重启 `dsh web`，新会话里就会多出一个 `notify_user` 工具。

## 装好之后怎么用

对 Harness 说：

- 「做完的时候提醒我」→ 它会在收尾时调用 `notify_user(kind="done")`，右下角弹卡片 + 播一句语音；
- 「有结果需要我拍板就提醒我」→ `notify_user(kind="decide")`，换另一种音效和标题。

也可以在 AGENTS.md 里写一条长期规则，让它每轮收尾自动调用。

## 要求

- Windows 10/11，系统自带 PowerShell 5.1（不用另装）；
- 只在第一次弹窗时慢约 0.6 秒（Add-Type 现场编译 C# 绘制代码），之后每次调用都很快；
- 想改停留秒数、位置、配色，改插件行的配置（`seconds` / `position` / `accentDone` 等），不用改代码。
