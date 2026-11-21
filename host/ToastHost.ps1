#Requires -Version 5.1
<#
  ToastHost.ps1 — 原生系统通知（0.18.0）
  Win10/11 上走托盘气泡：不弹 Harness 卡片，而是进右下角通知中心，鼠标移开就收进操作中心。
  调用方（插件）用隐藏窗口 + 无输出启动它，它显示 1.5 秒就自己退出。

  为什么不用 WinRT ToastNotificationManager：在本机 PowerShell 5.1 里
  `[ToastNotificationManager]::CreateToastNotifier(..).Show(..)` 会永久阻塞（实测 45s 超时），
  而 NotifyIcon.ShowBalloonTip 在同样环境下 1.5 秒内正常返回，所以选后者。

  参数：
    -Title    标题
    -Msg      正文
    -Seconds  气泡停留秒数（默认 8，仅影响气泡存在时间）
    -Icon     Information / Warning / Error / None
    -Log      可选，写一行日志方便排查
#>
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Msg,
    [int]$Seconds = 8,
    [string]$Icon = 'Information',
    [string]$Log = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Write-Log([string]$text) {
    if (-not $Log) { return }
    try {
        $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
        Add-Content -LiteralPath $Log -Value $line -Encoding UTF8
    } catch { }
}

$tray = $null
try {
    $tipIcon = switch ($Icon) {
        'Warning' { [System.Windows.Forms.ToolTipIcon]::Warning }
        'Error' { [System.Windows.Forms.ToolTipIcon]::Error }
        'None' { [System.Windows.Forms.ToolTipIcon]::None }
        default { [System.Windows.Forms.ToolTipIcon]::Info }
    }
    $tray = New-Object System.Windows.Forms.NotifyIcon
    $tray.Icon = [System.Drawing.SystemIcons]::Information
    $tray.Text = 'DeepSeek Harness'
    $tray.Visible = $true
    $tray.ShowBalloonTip([Math]::Max(3, [Math]::Min($Seconds, 60)) * 1000, $Title, $Msg, $tipIcon)
    Write-Log ('balloon shown: {0}' -f $Title)
    # 气泡由系统托管，进程只需要活过一瞬间；留 1.5 秒让通知中心接住。
    $until = (Get-Date).AddMilliseconds(1500)
    while ((Get-Date) -lt $until) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 100
    }
    exit 0
} catch {
    Write-Log ('balloon failed: {0}' -f $_.Exception.Message)
    exit 1
} finally {
    if ($tray) {
        try { $tray.Visible = $false; $tray.Dispose() } catch { }
    }
}
