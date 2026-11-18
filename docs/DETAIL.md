# dsh-reminder-notify 细节说明

## 1. 一个提醒的生命周期

```
模型调用 notify_user(kind='done', message='…')
        │
        ├─ 读 row config（hostMode / seconds / position / sound / *Audio / cooldownMs）
        ├─ 同档位冷却检查（cooldownMs，默认 1500ms）
        ├─ hostMode = 'script'（默认）
        │    spawn(powershell.exe, ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
        │          '-WindowStyle','Hidden','-File', host/ReminderHost.ps1,
        │          '-Title', t, '-Msg', m, '-Seconds', s, '-Pos', p, '-Accent', '2ECC71',
        │          '-Audio', <绝对路径 wav> | '-NoSound'],
        │          { cwd: <包根>, stdio: 'ignore', windowsHide: true })
        ├─ hostMode = 'exe'（兼容老客户端）
        │    spawn(<clientDir>/Harness完成提醒.exe, ['--title', …], { cwd: clientDir, … })
        ├─ 等 spawn 事件 → unref()（弹窗不拖住本轮对话）
        ├─ 最多再等 900ms 看进程是否暴毙（earlyExit，仅用于自检）
        └─ 返回 JSON 字符串（工具文本输出）
```

卡片由 `host/ReminderHost.ps1` 负责：内联 C# 的 `ReminderWindow : Form`，
`WS_EX_NOACTIVATE` + `ShowWithoutActivation` 保证不抢焦点，`SetWindowPos(... NOACTIVATE)`
让它显示在顶层；圆角深色卡片、左侧强调色条、标题 11.5pt 粗体、正文 9.5pt 自动折行、
底部「N 秒后自动关闭 · 点一下关掉」、Opacity 淡入淡出、`SoundPlayer` 异步放音。

## 2. 为什么不走 shell，为什么不是 detached

原来的 `发送提醒.ps1` 里有一个 `Q()` 函数专门给参数加引号 —— 那是在和 shell 的引号规则打架。
插件的 `spawn(file, argv)` 是 Node 的**参数数组**形式，每个元素独立转义，
中文、空格、`&`、括号都不需要调用方操心。

两个实测踩到的坑，都写进了代码注释：

| 坑 | 现象 | 结论 |
| --- | --- | --- |
| `detached: true` | PowerShell 404ms 就以 0 退出，什么都不画，连日志都不写 | 脚本宿主**不能** detached；靠 `windowsHide + stdio:'ignore' + unref()` 达到同样效果 |
| `-Accent "#2ECC71"` | 无引号时 `#` 被 PowerShell 当注释，`-Accent` 没值 → 进程秒退 | 传 `2ECC71`，由脚本自己补 `#` |
| `"` 出现在正文里 | PowerShell 重新解析命令行时可能吞掉后面参数 | `psSafe()` 把 `"` 换成 `'`、换行折成空格 |

## 3. 失败策略：永远不把收尾动作变成阻塞

| 情况 | 返回 | 影响 |
| --- | --- | --- |
| 找不到脚本宿主 | `{ ok: false, error: 'host-script-not-found' }` | 工具正常返回，本轮继续 |
| 找不到 exe（hostMode=exe） | `{ ok: false, error: 'client-not-found' }` | 同上 |
| 音频文件缺失 | 静音弹窗，返回里带 `audioMissing` | 提醒照常出现 |
| spawn 抛错 | `{ ok: false, error: 'spawn-failed', detail }` | 同上 |
| 非 Windows | `{ ok: false, error: 'only-windows' }` | 同上 |
| 同档位冷却中 | `{ ok: true, skipped: 'cooldown' }` | 不重复弹窗 |
| 宿主秒退 | `{ ok: true, earlyExit: <code> }` | 提醒可能没显示，但工具不报错 |

`notify_user` 永远是「发出去就完事」的语义：它不会因为提醒失败而让任务收尾失败。

## 4. Config 口径

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `hostMode` | `script` | `script` = 包内 PowerShell 宿主；`exe` = 老 exe 客户端 |
| `scriptPath` | `''` | 空 = 包内 `host/ReminderHost.ps1` |
| `powershellPath` | `powershell.exe` | 一般不用改 |
| `clientDir` | `''` | 仅 exe 模式：空 = 包内 `assets/`；填绝对路径用外部客户端目录 |
| `audioDir` | `''` | 空 = 包内 `assets/提示音导入/` |
| `seconds` | `60` | 卡片停留秒数，夹在 2–600 |
| `position` | `br` | `br` 右下 / `center` 居中 / `tr` 右上 |
| `sound` | `true` | 全局开关；工具调用时 `sound:false` 可单次静音 |
| `doneAudio` | `完成提醒语音.wav` | done 档音频文件名 |
| `decideAudio` | `需要你来决定.wav` | decide 档音频文件名 |
| `rawAudio` | `''` | raw 档音频；空 = 静音 |
| `accentDone` / `accentDecide` / `accentRaw` | `#2ECC71` / `#F5A623` / `#4C8DFF` | 卡片左侧强调色 |
| `cooldownMs` | `1500` | 同档位最小间隔，0 = 关闭冷却 |

工具参数（`seconds` / `sound`）优先于 Config；Config 优先于代码内默认值。

## 5. 与旧客户端共存

- 旧客户端目录**原样不动**：`发送提醒.ps1`、`配置.ini`、`需要你来决定.exe` 都还在，双击照样用。
- 插件自带两个 wav（约 830 KB），卡片宿主是纯脚本，所以整包可搬走，不依赖 `D:\a豆包制作工作`。
- 想共用同一份音频/换音色：`audioDir` 指到旧目录的 `提示音导入\` 即可。
- 老机器上仍想用 exe：`hostMode: 'exe'` + `clientDir` 指向客户端目录。

## 6. 卸载

插件页停用/删除 `dsh-reminder-notify` 即可；如果要连同旧脚本一起退休，
再把 AGENTS.md 里那两条「运行 发送提醒.ps1」改成「调用 `notify_user`」。
