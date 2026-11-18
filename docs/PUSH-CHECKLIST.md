# 上架清单：建仓库 → 推送 → 提交索引 → 开 Pages

> 目标：让别人在 DSH 的「插件市场 → 发现」里看到「桌面提醒」，一键装上。
> 全程只需要 GitHub 网页 + 本地这几条命令，不需要 `gh` CLI，也不需要代码签名。

---

## 0. 前置检查（1 分钟）

在 PowerShell 里：

```powershell
cd "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-reminder-notify"
git log --oneline          # 应该只有一条：桌面提醒插件 0.2.0：…
git status --short         # 应该是空的
```

`node` 用哪个？本机系统 `node` 可能没装，DSH 自带的这个一定在：

```powershell
$env:NODE = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $env:NODE --version
```

（下面命令里的 `node` 都换成 `& $env:NODE` 即可。）

---

## 1. 在 GitHub 网页上建仓库

1. 打开 <https://github.com/new>；
2. Repository name 填 **`dsh-reminder-notify`**（要和本地目录同名，后面命令就不用改）；
3. 选 **Public**（私有仓库别人 clone 不了，插件装不上）；
4. **不要**勾 "Add a README file"、不要选 .gitignore、不要选 license（本地已经有了，勾了会冲突）；
5. 点 **Create repository**。

---

## 2. 绑定 remote 并推第一次

把 `<你的账号>` 换成你的 GitHub 用户名：

```powershell
cd "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-reminder-notify"

git remote add origin https://github.com/<你的账号>/dsh-reminder-notify.git
git push -u origin main
```

- 第一次 push 会弹 GitHub 登录窗（浏览器授权），或者要求填 Personal Access Token。
- 如果 remote 已存在：`git remote set-url origin https://github.com/<你的账号>/dsh-reminder-notify.git`。
- 成功标志：仓库页面能看到 `host/`、`assets/`、`cordis.patch.yml`，**没有任何 .exe**。

---

## 3. 生成索引并提交（一条命令）

索引里写死了「仓库地址 + 提交号」，所以必须在 remote 配好之后再生成。

```powershell
cd "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-reminder-notify"
node scripts/build-index.mjs --publish
git push
```

`--publish` 会：

1. 写出 `publish/index.json`；
2. 只把这一个文件 `git add` + `commit`（不会顺手带走你别的改动）；
3. 打印「下一步：git push」。

输出长这样：

```
已写入 …\publish\index.json
  插件   dsh-reminder-notify@0.2.0
  仓库   https://github.com/<你的账号>/dsh-reminder-notify
  提交   <40 位 sha>
[main xxxxxxx] 索引：dsh-reminder-notify@0.2.0（xxxxxxx）
已提交：publish/index.json
下一步：git push
```

> 想先看索引内容不提交：去掉 `--publish`，文件照样生成。

---

## 4. 开 GitHub Pages（索引的公开地址）

1. 仓库页 → **Settings** → 左侧 **Pages**；
2. Source 选 **Deploy from a branch**；
3. Branch 选 **`main`**，目录选 **`/ (root)`**，点 **Save**；
4. 等 30–60 秒，页面顶部会出现地址：

```
https://<你的账号>.github.io/dsh-reminder-notify/
```

---

## 5. 自检（必须做，10 秒）

浏览器打开：

```
https://<你的账号>.github.io/dsh-reminder-notify/publish/index.json
```

- 能看到一段 JSON、开头是 `"format": 1` → 成功；
- 404 → 等一会儿再刷；还 404 就回第 4 步确认分支是 `main`、目录是 `/ (root)`、文件在仓库的 `publish/` 下（不是根目录）。

---

## 6. 别人怎么装（发给对方的就是这一段）

**图形界面**：DSH → 插件页 →「插件源 / 添加索引 URL」→ 粘贴：

```
https://<你的账号>.github.io/dsh-reminder-notify/publish/index.json
```

然后在「发现」页找到「桌面提醒」→ 安装。

**命令行等价**：

```powershell
dsh plugin --profile desktop add "git+https://github.com/<你的账号>/dsh-reminder-notify.git#<40 位 sha>"
```

装完重启一次 `dsh web`，新会话里就有 `notify_user` 工具。

---

## 7. 以后发新版本（三步）

```powershell
# 1) 改 package.json 的 version，例如 0.2.1；改代码
git add -A
git commit -m "0.2.1：说明这次改了什么"
git push

# 2) 重新生成索引并提交（会记录新的提交号）
node scripts/build-index.mjs --publish
git push
```

忘了第 2 步，市场里就还是旧提交，别人装到的也是旧代码。

---

## 8. 常见岔子

| 症状 | 原因 / 处理 |
| --- | --- |
| `remote origin already exists` | 用 `git remote set-url origin <url>` 覆盖 |
| push 被拒 `non-fast-forward` | 建仓库时勾了 README，先 `git pull --rebase origin main` 再 push |
| 别人装的时候卡在 clone | 仓库是 Private，或地址写成了 SSH（必须是 `https://`） |
| Pages 打开是 404 | 分支/目录选错，或索引还没提交（第 3 步） |
| 装上但市场里显示旧版本 | 索引没重新生成/没 push（第 7 步） |
| 装完没有 `notify_user` | 没重启 `dsh web`；或 profile 不是 `desktop` |

---

## 附：这份索引已经验过

生成出来的 `publish/index.json` 用 DSH 自带的插件市场解析器（`@deepseek-ai/dsh-plugin-market-index`）跑过：

```
VALID: Private plugin source | plugins: dsh-reminder-notify (0.2.0)
```

只要第 3 步的仓库地址是真的，装的时候就不会因为格式问题失败。
