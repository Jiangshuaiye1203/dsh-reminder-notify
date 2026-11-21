# 发版一条命令：自检 → 发布 npm → 等 registry 可见 → 重建索引并提交 →（可选）推送 →（可选）打包给本机安装
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1 -Note "release 0.33.0 push ab12c"
#   powershell ... -File scripts/release.ps1 -DryRun                # 只跑到索引重建，不发布
#   powershell ... -File scripts/release.ps1 -Token $env:GITHUB_TOKEN  # 顺手推到 GitHub
# 说明：令牌只通过参数/环境变量传入，脚本不落盘、不打印。
param(
  [string]$Note = '',
  [string]$Token = '',
  [string]$Repo = 'https://github.com/Jiangshuaiye1203/dsh-reminder-notify',
  [switch]$SkipTests,
  [switch]$DryRun,
  [int]$WaitSeconds = 360
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (-not (Test-Path $node)) { $node = 'node' }
if (-not (Test-Path $pnpm)) { $pnpm = 'pnpm' }

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

$version = (& $node -e "process.stdout.write(require('./package.json').version)").Trim()
Step "版本 $version | 仓库 $Repo"

if (-not $SkipTests) {
  Step '语法检查'
  & $node --check index.js
  & $node --check client.js
  Step '单元测试'
  & $node tests/selftest-logic.mjs | Select-Object -Last 2
  & $node tests/selftest-client.mjs | Select-Object -Last 2
}

if ($DryRun) {
  Step 'DryRun：只做自检，不发布、不重建索引、不打包'
  Write-Host ''
  Write-Host "计划：pnpm publish $version -> 等 registry -> build-index --npm --publish -> push -> pack" -ForegroundColor Green
  exit 0
}

if ($true) {
  Step '发布到 npm'
  & $node $pnpm publish --access public --no-git-checks --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'pnpm publish 失败' }

  Step '等 registry 可见（最多 ' + $WaitSeconds + ' 秒）'
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $visible = $false
  while ((Get-Date) -lt $deadline) {
    $code = (& curl.exe -s -o NUL -w '%{http_code}' --ssl-no-revoke "https://registry.npmjs.org/dsh-reminder-notify/$version").Trim()
    if ($code -eq '200') { $visible = $true; break }
    Start-Sleep -Seconds 15
  }
  if (-not $visible) { throw "registry 里还看不到 $version（继续等一会儿再手动重跑；不要重复发布同一版本号）" }
}

Step '重建市场索引并提交'
& $node scripts/build-index.mjs --npm --repo $Repo --publish
if ($LASTEXITCODE -ne 0) { throw 'build-index 失败' }

if ($Token -ne '') {
  Step '推送到 GitHub（临时令牌只在内存里）'
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-push.ps1 -Token $Token
  if ($LASTEXITCODE -ne 0) { throw '推送失败' }
  if ($Note -ne '') { Write-Host "记得去 https://github.com/settings/tokens 删掉令牌：$Note" -ForegroundColor Yellow }
} else {
  Write-Host '没传 -Token，跳过推送。手动推送：' -ForegroundColor Yellow
  Write-Host '  git push origin main' -ForegroundColor Yellow
}

Step '打包，供本机安装'
$tgzDir = 'C:\Users\Administrator\.dsh\profiles\desktop\.plugin-manager\tgz'
if (-not (Test-Path $tgzDir)) { New-Item -ItemType Directory -Path $tgzDir | Out-Null }
& $node $pnpm pack --pack-destination $tgzDir | Select-Object -Last 1
$tgz = Join-Path $tgzDir ("dsh-reminder-notify-" + $version + ".tgz")
if (Test-Path $tgz) {
  Write-Host ''
  Write-Host "下一步（在 DSH 里让模型执行）：" -ForegroundColor Green
  Write-Host "  plugin_manager remove_bundle dsh-reminder-notify"
  Write-Host "  plugin_manager install_bundle $tgz"
  Write-Host '  然后用备份或 cfg 快照恢复配置（POST /dsh-reminder-notify/config）'
} else {
  Write-Host "打包没找到 $tgz" -ForegroundColor Yellow
}

Step "完成：$version"
