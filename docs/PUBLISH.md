# 上架 / 分享：自建插件索引

DSH 的「插件市场 → 发现」页读的是**索引 URL**：一份 JSON（市场索引格式 1），列出插件与可安装版本。
索引本身不托管代码，只给出版本从哪儿装（`git` 仓库 + 固定提交，或 npm 包名）。
本目录的 `index.json` 由 `scripts/build-index.mjs` 生成，**不要手改**。

## 已发布状态（2026-11-21 更新）

| 项目 | 值 |
| --- | --- |
| 公开仓库 | https://github.com/Jiangshuaiye1203/dsh-reminder-notify |
| 索引地址（他人添加这个） | `https://jiangshuaiye1203.github.io/dsh-reminder-notify/publish/index.json` |
| 站点首页 | https://jiangshuaiye1203.github.io/dsh-reminder-notify/ |
| npm 包 | https://www.npmjs.com/package/dsh-reminder-notify |
| 当前版本 | **0.16.1**，装源为 **npm**（`dsh-reminder-notify@0.16.1`），不再是 git 固定提交 |
| Pages | Deploy from a branch，`main` / `(root)` |

发新版（npm 源）：改代码 → 升 `package.json` 版本 → `scripts\publish-npm.cmd` 发布到 npm →
`node scripts/build-index.mjs --npm --publish` → `git push`。
索引必须指向**已经发到 npm 的版本**，否则别人装下来的还是旧包（详见第 6 节）。

## 0. 结构

```
/index.js  package.json  cordis.patch.yml  host/  assets/  locale/  docs/
scripts/build-index.mjs      # 生成索引
publish/index.json           # 生成的索引（提交进仓库后，Pages 就能访问到它）
```

## 1. 先把仓库公开（这一步别人才能装）

索引的 git 来源必须是**匿名可读**的 https 仓库，且提交要能 `git fetch` 到。

```bash
cd "C:/Users/Administrator/Documents/deepseek-harness/default-workspace/dsh-reminder-notify"
git remote add origin https://github.com/<你的账号>/dsh-reminder-notify.git
git push -u origin main
```

- 仓库里要包含 `host/` 与 `assets/提示音导入/`（两个 wav，约 830 KB），否则装上也弹不出东西；仓库里**没有 exe**。
- 私有仓库不行：装插件的一方是 pnpm 直接 clone，不走你的登录态。

## 2. 生成索引

```bash
node scripts/build-index.mjs                # 自动读 remote.origin.url 与 HEAD
node scripts/build-index.mjs --repo https://github.com/me/dsh-reminder-notify --commit <sha>
```

产物 `publish/index.json` 里，每个版本是 `{ version, publishTimestamp, source: { type: 'git', url, commit }, engines }`，
插件市场据此拼出安装串 `git+<url>.git#<commit>`。`icon` 内联成 `data:` URL（≤32 KiB），不依赖外部图片。

## 3. 托管索引

最省事：GitHub Pages。

1. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`。
2. 等一会儿，索引地址就是：
   `https://<你的账号>.github.io/dsh-reminder-notify/publish/index.json`
3. 浏览器打开这个地址，能看到 JSON 就对了（`content-type` 是 `application/json` 或 `text/plain` 都行）。

不想用 Pages 也行：gist 的 raw 链接、任意静态 https 空间都可以，只要**直链 + 无鉴权**。

## 4. 对方怎么装

在 DSH 里：插件页 →「插件源 / 添加索引 URL」→ 粘贴上面的索引地址 → 「发现」页会出现「桌面提醒」→ 安装。
等价命令行：

```bash
dsh plugin --profile desktop add "git+https://github.com/<你的账号>/dsh-reminder-notify.git#<40位sha>"
```

## 5. 发新版本

1. 改 `package.json` 的 `version`（如 `0.1.1`）；
2. `git commit` + `git push`；
3. 重跑 `node scripts/build-index.mjs`，把 `publish/index.json` 也提交推送。

忘了第 3 步，索引里就还是旧提交，别人装到的也是旧代码。

## 6. 改走 npm 源（国内可装）

git 源要求安装方能直连 github.com，国内无代理基本装不上。索引格式 1 的版本节点还支持 `source: { "type": "npm" }`，
此时市场用 `pnpm add <包名>@<版本>` 安装，走 npm 源，国内镜像可用。

一次性的准备（只需要做一次）：

1. 在 https://www.npmjs.com/signup 注册账号并验证邮箱；
2. 双击 `scripts/publish-npm.cmd`（内部会自动找 DSH 自带的 node + pnpm），按提示登录并发布
   `dsh-reminder-notify@0.2.0`。密码由 npm 自己处理，脚本只负责串起登录和发布两步；
3. 确认 https://www.npmjs.com/package/dsh-reminder-notify 能打开。

发布成功后，把索引的装源改成 npm：

```bash
# 没有 node 在 PATH 时，用 DSH 自带的 node：%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
node scripts/build-index.mjs --npm --publish
git push
```

产物的版本节点变成：

```json
{ "version": "0.2.0", "publishTimestamp": 1795011057, "source": { "type": "npm" }, "engines": {} }
```

以后发新版：改版本号 → `publish-npm.cmd` 发布新版本 → `build-index.mjs --npm --publish` → push。
版本号一旦发布就不能覆盖，改代码要顺带抬版本。

> 想指定镜像（如 `https://registry.npmmirror.com`）可加 `--registry`；
> 不指定就由安装方用自己的 npm 源。发布本身必须发到 registry.npmjs.org。

## 7. 上架前值得知道的三件事

- **只有 Windows 能用**：插件 `os: ["win32"]`，卡片宿主是 PowerShell 5.1 + WinForms（系统自带）。
- **没有 exe，所以不触发 SmartScreen**：仓库里唯一的二进制是两个 wav，宿主 `host/ReminderHost.ps1` 是可直接审计的文本。代价是每次弹卡片要起一个 PowerShell 进程（`Add-Type` 编译约 0.6 s），以及这台机器必须允许 PowerShell 执行本地脚本——脚本用 `-ExecutionPolicy Bypass` 调起，不改系统策略。
- **音频版权**：两个 wav 是 TTS 合成，自己用没问题；公开分发前确认合成服务的商用条款。
