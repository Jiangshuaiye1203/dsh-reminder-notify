# 把 dsh-reminder-notify 发布到 npm 官方源（registry.npmjs.org）。
#
# 用法：双击 scripts/publish-npm.cmd，或在本目录执行
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/publish-npm.ps1
#
# 第一次会要求登录 npm（用户名 / 密码 / 邮箱，开了 2FA 的再输一次验证码），
# 登录信息保存在 %USERPROFILE%\.npmrc，之后发布不用再登。密码不会显示、也不会被本脚本记录。

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# 找 node + pnpm：优先本机安装，其次 DSH 自带的运行时（桌面版用户通常只有后者）。
$node = $env:DSH_NODE
$pnpm = $env:DSH_PNPM

if (-not $node -or -not $pnpm) {
    $runtimes = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes') -Directory -ErrorAction SilentlyContinue
    foreach ($runtime in $runtimes) {
        $deps = Join-Path $runtime.FullName 'dependencies'
        $nodeCandidate = Join-Path $deps 'node\bin\node.exe'
        $pnpmCandidate = Join-Path $deps 'pnpm\bin\pnpm.cjs'
        if ((Test-Path $nodeCandidate) -and (Test-Path $pnpmCandidate)) {
            $node = $nodeCandidate
            $pnpm = $pnpmCandidate
            break
        }
    }
}
if (-not $node -or -not (Test-Path $node)) {
    $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($systemNode) { $node = $systemNode.Source }
}
if (-not $node -or -not (Test-Path $node)) {
    Write-Host '找不到 node.exe。请先在 DSH 里启动过一次（生成运行时），或设置 DSH_NODE 环境变量。' -ForegroundColor Red
    exit 1
}
if (-not $pnpm -or -not (Test-Path $pnpm)) {
    Write-Host '找不到 pnpm.cjs（DSH 自带运行时里应该有）。请设置 DSH_PNPM 环境变量指向 pnpm.cjs。' -ForegroundColor Red
    exit 1
}

Write-Host "node  : $node"
Write-Host "pnpm  : $pnpm"
Write-Host "包名  : dsh-reminder-notify"
Write-Host "仓库  : $repo"

# 未登录就先登录（交互输入，脚本不读取也不保存密码）。
& $node $pnpm whoami *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '还没有登录 npm，接下来按提示输入用户名 / 密码 / 邮箱（有 2FA 会再要一次验证码）。' -ForegroundColor Yellow
    Write-Host '没有账号的话先到 https://www.npmjs.com/signup 注册，邮箱验证通过再回来。' -ForegroundColor Yellow
    & $node $pnpm login
    if ($LASTEXITCODE -ne 0) {
        Write-Host '登录没有成功，退出。' -ForegroundColor Red
        exit 1
    }
}

Write-Host ''
Write-Host '开始发布……'
& $node $pnpm publish --access public --no-git-checks --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '发布失败。常见原因：' -ForegroundColor Red
    Write-Host '  - 这个版本号已经发布过（需要先在 package.json 里加一版，比如 0.2.1）'
    Write-Host '  - 没有邮箱验证 / 没登录'
    Write-Host '  - 网络连不上 registry.npmjs.org'
    exit $LASTEXITCODE
}

Write-Host ''
Write-Host '发布完成：https://www.npmjs.com/package/dsh-reminder-notify' -ForegroundColor Green
Write-Host '下一步：回到 DSH 告诉 AI「npm 发布好了」，它会更新插件索引并改成 npm 装源。' -ForegroundColor Green
