# 在可见的控制台窗口里完成：npm 网页授权登录 → 发布 dsh-reminder-notify。
# 由 publish-npm-window.cmd 启动；也可以自己右键「使用 PowerShell 运行」。

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$Host.UI.RawUI.WindowTitle = 'npm 发布：dsh-reminder-notify'

function Find-Tool {
    param([string]$Name)
    $candidates = @()
    $runtimes = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes') -Directory -ErrorAction SilentlyContinue
    foreach ($runtime in $runtimes) {
        $deps = Join-Path $runtime.FullName 'dependencies'
        if ($Name -eq 'node') { $candidates += Join-Path $deps 'node\bin\node.exe' }
        if ($Name -eq 'pnpm') { $candidates += Join-Path $deps 'pnpm\bin\pnpm.cjs' }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    if ($Name -eq 'node') {
        $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($cmd) { return $cmd.Source }
    }
    return $null
}

$node = $env:DSH_NODE
if (-not $node) { $node = Find-Tool 'node' }
$pnpm = $env:DSH_PNPM
if (-not $pnpm) { $pnpm = Find-Tool 'pnpm' }

if (-not $node -or -not (Test-Path $node)) {
    Write-Host '找不到 node.exe，退出。' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}
if (-not $pnpm -or -not (Test-Path $pnpm)) {
    Write-Host '找不到 pnpm.cjs，退出。' -ForegroundColor Red
    Read-Host '按回车关闭'
    exit 1
}

# dlx 出来的 npm 需要一个叫 node 的命令，把 node 所在目录放到 PATH 最前面。
$env:PATH = (Split-Path $node) + ';' + $env:PATH

Write-Host '=============================================='
Write-Host ' 第 1 步：登录 npm（用浏览器点一下授权就行）'
Write-Host '=============================================='
Write-Host '接下来浏览器会打开 npm 的授权页；'
Write-Host '在页面上点「Authorize / Grant Access」这类确认按钮，'
Write-Host '然后等这个窗口出现登录成功的信息。'
Write-Host ''

& $node $pnpm dlx npm@latest login --auth-type=web --registry https://registry.npmjs.org/
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '网页授权没有完成。可以改用密码登录：' -ForegroundColor Yellow
    Write-Host '  在下面输入用户名 / 密码 / 邮箱（2FA 还会要一次验证码）。' -ForegroundColor Yellow
    & $node $pnpm dlx npm@latest login --auth-type=legacy --registry https://registry.npmjs.org/
    if ($LASTEXITCODE -ne 0) {
        Write-Host '登录失败，退出。' -ForegroundColor Red
        Read-Host '按回车关闭'
        exit 1
    }
}

Write-Host ''
Write-Host '=============================================='
Write-Host ' 第 2 步：发布 dsh-reminder-notify@0.2.0'
Write-Host '=============================================='
& $node $pnpm publish --access public --no-git-checks --ignore-scripts
$code = $LASTEXITCODE
Write-Host ''
if ($code -eq 0) {
    Write-Host '发布完成！https://www.npmjs.com/package/dsh-reminder-notify' -ForegroundColor Green
    Write-Host '回 DSH 告诉 AI 一声，剩下的索引更新它会做。' -ForegroundColor Green
} else {
    Write-Host '发布没有成功（退出码 ' + $code + '）。' -ForegroundColor Red
    Write-Host '把上面的红字发回 DSH 即可；常见原因是版本号已存在或 2FA 需要验证码。' -ForegroundColor Red
}
Read-Host '按回车关闭这个窗口'
