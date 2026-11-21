# github-push.ps1 —— 推送前自动处理「Steam++ 加速表把 github.com 指到 127.0.0.1」的情况。
#
# 背景：Steam++（Watt Toolkit）加速 GitHub 的原理是改 hosts，把 github.com 指到
# 127.0.0.1，由它自己的本地代理接住。加速器在跑时一切正常；它没接管（进程开了但
# 没点「一键加速」、被强杀、崩了）时，浏览器和 git 都会连不上，报
# ERR_CONNECTION_REFUSED / Empty reply from server。
#
# 这个脚本做的事：
#   1. 先测 https://github.com 通不通；
#   2. 不通且 hosts 里有 127.0.0.1 的 github 行 → 临时注释它们（加 [dsh-temp] 标记）+ 刷 DNS，再测一次；
#   3. 通了就 git push（用 -Token，或环境变量 GITHUB_TOKEN，走 extraHeader，不落盘）；
#   4. 无论成功失败，默认结束后把临时注释还原（-KeepChanges 则保留改动，方便继续用裸连）。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-push.ps1 -DryRun
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-push.ps1 -Token ghp_xxx
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/github-push.ps1 -Token ghp_xxx -KeepChanges

param(
  [string]$Remote = 'origin',
  [string]$Branch = 'main',
  [string]$Token = $env:GITHUB_TOKEN,
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$DryRun,
  [switch]$KeepChanges
)

$ErrorActionPreference = 'Stop'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$Marker = '# [dsh-temp] '
$script:changed = $false
$script:restored = $false
$script:original = @()

function Test-GitHub {
  # 用独立进程的 curl.exe 探测：不受 PowerShell 进程内 DNS / 连接池缓存影响，
  # 注释 hosts 后重测能立刻反映真实结果。没有 curl 时退回 HttpWebRequest。
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  if (Test-Path $curl) {
    try {
      $raw = (& $curl -s -o NUL -w '%{http_code}' --max-time 8 --ssl-no-revoke -I https://github.com/ 2>$null | Out-String).Trim()
      $code = 0
      [void][int]::TryParse($raw, [ref]$code)
      if ($code -gt 0) { return @{ ok = ($code -ge 200 -and $code -lt 500); code = $code; error = '' } }
      return @{ ok = $false; code = 0; error = 'curl 无响应（连接超时）' }
    } catch {
      return @{ ok = $false; code = 0; error = $_.Exception.Message }
    }
  }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $req = [System.Net.HttpWebRequest]::Create('https://github.com/')
    $req.Method = 'HEAD'
    $req.Timeout = 8000
    $req.UserAgent = 'dsh-github-push'
    $res = $req.GetResponse()
    $code = [int]$res.StatusCode
    $res.Close()
    return @{ ok = ($code -ge 200 -and $code -lt 500); code = $code; error = '' }
  } catch {
    return @{ ok = $false; code = 0; error = $_.Exception.Message }
  }
}

function Clear-Dns {
  try { & "$env:SystemRoot\System32\ipconfig.exe" /flushdns 2>$null | Out-Null } catch { }
}

function Get-HostsBlockers {
  if (-not (Test-Path $HostsPath)) { return @() }
  $lines = [System.IO.File]::ReadAllLines($HostsPath)
  $hits = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $lines.Length; $i++) {
    $trim = $lines[$i].Trim()
    if ($trim -eq '' -or $trim.StartsWith('#')) { continue }
    if ($trim -match '^127\.0\.0\.1\s' -and $trim -match 'github') { [void]$hits.Add($i) }
  }
  return @($hits)
}

function Set-HostsLines([string[]]$Lines) {
  [System.IO.File]::WriteAllLines($HostsPath, $Lines, (New-Object System.Text.UTF8Encoding($false)))
}

function Restore-Hosts {
  if (-not $script:changed) { return }
  if ($KeepChanges) {
    Write-Host '      hosts 保持改动（Steam++ 的屏蔽行仍被注释，GitHub 走裸连）。'
  } else {
    try {
      Set-HostsLines $script:original
      Clear-Dns
      Write-Host '      hosts 已还原成原样。'
      $script:restored = $true
    } catch {
      Write-Host ("      hosts 还原失败，请手动检查：{0}" -f $_.Exception.Message)
    }
  }
  $script:changed = $false
}

try {
  Write-Host '[1/4] 测试 https://github.com ...'
  $probe = Test-GitHub
  if ($probe.ok) {
    Write-Host ("      OK（HTTP {0}）" -f $probe.code)
  } else {
    Write-Host ("      连不上：{0}" -f $probe.error)
    $blockers = Get-HostsBlockers
    if ($blockers.Count -eq 0) {
      Write-Host '      hosts 里没有 127.0.0.1 的 github 行，问题不在 hosts（可能是代理 / 网络）。'
      Write-Host '      建议：打开 Steam++ → 网络加速 → 勾 GitHub → 一键加速，并保持它运行。'
      if (-not $DryRun) { exit 2 }
    } else {
      Write-Host ("      发现 {0} 行本机重定向（Steam++ 加速表），临时注释后重试 ..." -f $blockers.Count)
      $script:original = @([System.IO.File]::ReadAllLines($HostsPath))
      $lines = @($script:original)
      foreach ($i in $blockers) { $lines[$i] = $Marker + $lines[$i] }
      Set-HostsLines $lines
      $script:changed = $true
      Clear-Dns
      $probe = Test-GitHub
      if ($probe.ok) {
        Write-Host ("      OK（HTTP {0}）" -f $probe.code)
      } else {
        Write-Host ("      仍然连不上：{0}" -f $probe.error)
        Write-Host '      建议：打开 Steam++ → 网络加速 → 勾 GitHub → 一键加速，保持运行后重试。'
        Restore-Hosts
        if (-not $DryRun) { exit 2 }
      }
    }
  }

  Write-Host '[2/4] 检查仓库状态 ...'
  Push-Location $RepoRoot
  try {
    $status = git status --porcelain
    if ($status) {
      Write-Host '      工作树有未提交的改动（脚本不会替你提交）：'
      $status | ForEach-Object { Write-Host "        $_" }
    }
    $ahead = (git rev-list --count "origin/$Branch..HEAD" 2>$null | Out-String).Trim()
    Write-Host ("      待推送提交：{0} 个" -f $ahead)

    Write-Host '[3/4] 推送 ...'
    if ($DryRun) {
      Write-Host '      -DryRun：跳过实际推送。'
    } elseif ($ahead -eq '0') {
      Write-Host '      没有需要推送的提交。'
    } elseif (-not $Token) {
      Write-Host '      没给令牌：请加 -Token ghp_xxx，或先设置环境变量 GITHUB_TOKEN。'
      Write-Host '      令牌在 https://github.com/settings/tokens/new 生成（勾 repo；要改 .github/workflows 还要勾 workflow）。'
    } else {
      $basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x-access-token:$Token"))
      & git -c credential.helper= -c "http.https://github.com/.extraHeader=Authorization: Basic $basic" push $Remote $Branch
      if ($LASTEXITCODE -ne 0) { throw "git push 失败（退出码 $LASTEXITCODE）" }
      Write-Host '      推送完成。记得去 https://github.com/settings/tokens 删掉这个临时令牌。'
    }
  } finally {
    Pop-Location
  }
} catch {
  Write-Host ("出错：{0}" -f $_.Exception.Message)
  exit 1
} finally {
  Write-Host '[4/4] 收尾 ...'
  $wasChanged = $script:changed
  Restore-Hosts
  if (-not $wasChanged) { Write-Host '      hosts 未改动。' }
}
