#Requires -Version 5.1
<#
  TrayHost.ps1 — 托盘图标 + 全局热键（0.18.0）
  一个常驻的小进程：托盘图标点一下能开关静音 / 免打扰、立刻弹一张卡、打开提醒目录，
  并且注册一个全局热键（默认 Ctrl+Alt+R）随时手动弹卡。

  和插件之间不走网络：状态写在 -StateFile 这个 JSON 里，插件每次弹卡前读一遍
  （{ "muted": false, "quiet": false, "at": 1234567890 }）。

  参数：
    -HostScript  包内 host/ReminderHost.ps1（弹卡用）
    -AudioDir    提示音目录
    -StateFile   状态文件
    -Hotkey      全局热键，形如 Ctrl+Alt+R / Ctrl+Shift+F9
    -Log         日志文件
#>
param(
    [Parameter(Mandatory = $true)][string]$HostScript,
    [string]$AudioDir = '',
    [Parameter(Mandatory = $true)][string]$StateFile,
    [string]$Hotkey = 'Ctrl+Alt+R',
    [string]$Log = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ('DshTrayWin' -as [type])) {
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Windows.Forms;

public class DshTrayWin : NativeWindow
{
    public const int WM_HOTKEY = 0x0312;
    public event EventHandler HotkeyPressed;

    public void Register()
    {
        CreateHandle(new CreateParams());
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            var handler = HotkeyPressed;
            if (handler != null) handler(this, EventArgs.Empty);
        }
        base.WndProc(ref m);
    }
}

public static class DshTrayHotkey
{
    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);

    [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
"@
}

$script:hostPath = $HostScript
$script:audioDir = $AudioDir
$script:statePath = $StateFile
$script:logPath = $Log
$script:hotkeySpec = $Hotkey
$script:tray = $null
$script:win = $null
$script:state = @{ muted = $false; quiet = $false; at = 0 }

function Write-Log([string]$text) {
    if (-not $script:logPath) { return }
    try {
        $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text
        Add-Content -LiteralPath $script:logPath -Value $line -Encoding UTF8
    } catch { }
}

function Read-State {
    try {
        if (Test-Path -LiteralPath $script:statePath) {
            $raw = Get-Content -LiteralPath $script:statePath -Raw -Encoding UTF8
            if ($raw) {
                $obj = $raw | ConvertFrom-Json
                $script:state.muted = [bool]$obj.muted
                $script:state.quiet = [bool]$obj.quiet
                if ($obj.at) { $script:state.at = [int64]$obj.at }
            }
        }
    } catch {
        Write-Log ('state read failed: {0}' -f $_.Exception.Message)
    }
}

function Save-State {
    try {
        $dir = Split-Path -Parent $script:statePath
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $script:state.at = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
        $script:state | ConvertTo-Json -Compress | Set-Content -LiteralPath $script:statePath -Encoding UTF8
    } catch {
        Write-Log ('state write failed: {0}' -f $_.Exception.Message)
    }
}

function Show-Card([string]$title, [string]$msg) {
    try {
        $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $argv = @(
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', $script:hostPath,
            '-Title', $title, '-Msg', $msg, '-Seconds', '30', '-Pos', 'br'
        )
        if ($script:state.muted -or -not $script:audioDir) { $argv += '-NoSound' }
        else {
            $wav = Join-Path $script:audioDir '完成提醒语音.wav'
            if (Test-Path -LiteralPath $wav) { $argv += @('-Audio', $wav) } else { $argv += '-NoSound' }
        }
        Start-Process -FilePath $ps -ArgumentList $argv -WindowStyle Hidden | Out-Null
        Write-Log ('card shown: {0}' -f $title)
    } catch {
        Write-Log ('card failed: {0}' -f $_.Exception.Message)
    }
}

function Update-Menu {
    $script:menuMute.Text = if ($script:state.muted) { '取消静音' } else { '静音（不响铃）' }
    $script:menuQuiet.Text = if ($script:state.quiet) { '退出免打扰' } else { '进入免打扰' }
}

function Start-Hotkey {
    $parts = @($script:hotkeySpec -split '\+')
    if ($parts.Count -lt 2) { Write-Log ('hotkey ignored: {0}' -f $script:hotkeySpec); return }
    $mods = 0
    foreach ($p in $parts[0..($parts.Count - 2)]) {
        switch ($p.Trim().ToLower()) {
            'ctrl' { $mods = $mods -bor 0x0002 }
            'control' { $mods = $mods -bor 0x0002 }
            'alt' { $mods = $mods -bor 0x0001 }
            'shift' { $mods = $mods -bor 0x0004 }
            'win' { $mods = $mods -bor 0x0008 }
        }
    }
    $keyName = $parts[$parts.Count - 1].Trim().ToUpper()
    $code = 0
    if ($keyName -match '^[A-Z]$' -or $keyName -match '^[0-9]$') { $code = [int][char]$keyName }
    elseif ($keyName -match '^F([1-9]|1[0-9]|2[0-4])$') { $code = 0x70 + ([int]$keyName.Substring(1) - 1) }
    else {
        $vk = 0
        if ([Enum]::TryParse([System.Windows.Forms.Keys], $keyName, $true, [ref]$vk)) { $code = [int]$vk }
    }
    if ($code -le 0) { Write-Log ('hotkey key not understood: {0}' -f $keyName); return }
    $script:win = New-Object DshTrayWin
    $script:win.Register()
    $script:win.add_HotkeyPressed({
        Write-Log 'hotkey pressed'
        Show-Card '手动提醒' '这是你按热键弹出的提醒卡。'
    })
    $ok = [DshTrayHotkey]::RegisterHotKey($script:win.Handle, 1, $mods, $code)
    Write-Log ('hotkey register {0}: {1} (mods={2} vk={3})' -f $script:hotkeySpec, $ok, $mods, $code)
}

function Stop-All {
    try {
        if ($script:win) { [void][DshTrayHotkey]::UnregisterHotKey($script:win.Handle, 1) }
    } catch { }
    if ($script:tray) {
        $script:tray.Visible = $false
        $script:tray.Dispose()
    }
    [System.Windows.Forms.Application]::Exit()
}

Read-State

$script:tray = New-Object System.Windows.Forms.NotifyIcon
$script:tray.Icon = [System.Drawing.SystemIcons]::Application
$script:tray.Text = '桌面提醒（DeepSeek Harness）'
$script:tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menuShow = $menu.Items.Add('立即弹一张提醒')
$script:menuMute = $menu.Items.Add('静音（不响铃）')
$script:menuQuiet = $menu.Items.Add('进入免打扰')
$menuSep = $menu.Items.Add('-')
$menuOpen = $menu.Items.Add('打开提醒目录')
$menuExit = $menu.Items.Add('退出托盘')
$script:tray.ContextMenuStrip = $menu
Update-Menu

$menuShow.add_Click({ Show-Card '手动提醒' '这是你从托盘弹出的提醒卡。' })
$script:menuMute.add_Click({
    $script:state.muted = -not $script:state.muted
    Save-State
    Update-Menu
    Write-Log ('muted -> {0}' -f $script:state.muted)
})
$script:menuQuiet.add_Click({
    $script:state.quiet = -not $script:state.quiet
    Save-State
    Update-Menu
    Write-Log ('quiet -> {0}' -f $script:state.quiet)
})
$menuOpen.add_Click({
    try {
        $dir = Split-Path -Parent $script:statePath
        Start-Process explorer.exe $dir | Out-Null
    } catch { }
})
$menuExit.add_Click({ Stop-All })

$script:tray.add_DoubleClick({ Show-Card '手动提醒' '这是你双击托盘图标弹出的提醒卡。' })

Start-Hotkey
Write-Log ('tray started hotkey={0}' -f $script:hotkeySpec)

[System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
Stop-All
Write-Log 'tray stopped'
