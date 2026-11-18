<#
  ReminderHost.ps1 —— 零二进制的桌面提醒宿主（Windows 自带 PowerShell 5.1 + WinForms）

  为什么存在：原来的 assets/Harness完成提醒.exe 是未签名的编译产物，公开分发会被
  SmartScreen / 杀软拦。本脚本用系统自带组件画同一个提醒窗口，仓库里不出现任何二进制，
  也不需要买代码签名证书、不需要编译环境。

  行为（对齐原 exe）：
    · 右下角（可换角）悬浮卡片，圆角、无边框、置顶
    · 不抢焦点（ShowWithoutActivation + WS_EX_NOACTIVATE），不进 Alt+Tab
    · 按秒自动淡出关闭；点一下立即关
    · 可选播放 wav（System.Media.SoundPlayer，异步，不阻塞）

  参数：-Title -Msg -Seconds -Pos(br|tr|tl|bc|center) -Audio -Accent -NoSound -Log
#>
[CmdletBinding()]
param(
    [string]$Title = 'Harness 提醒',
    [string]$Msg = '',
    [int]$Seconds = 60,
    [ValidateSet('br', 'tr', 'tl', 'bc', 'center')]
    [string]$Pos = 'br',
    [string]$Audio = '',
    [string]$Accent = '#2ECC71',
    [switch]$NoSound,
    [string]$Log = ''
)

$ErrorActionPreference = 'Stop'

# ---- 日志（可选，仅用于自测排障） -------------------------------------------
function Write-Log([string]$text) {
    if ([string]::IsNullOrEmpty($Log)) { return }
    try {
        ('{0} {1}' -f (Get-Date -Format 'HH:mm:ss.fff'), $text) | Add-Content -LiteralPath $Log -Encoding UTF8
    } catch { }
}

# ---- 组装窗口类（C# 源码内联，运行时由系统自带的 csc 编译，不落地任何 exe） --
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$source = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public sealed class ReminderWindow : Form
{
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    public ReminderWindow()
    {
        SetStyle(ControlStyles.OptimizedDoubleBuffer
               | ControlStyles.AllPaintingInWmPaint
               | ControlStyles.UserPaint, true);
        UpdateStyles();
    }

    // 关键：显示时不激活，抢占焦点会让正在打字的人跳光标
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW：不进 Alt+Tab、不出任务栏按钮
            return cp;
        }
    }

    public void RaiseWithoutActivating()
    {
        SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0,
                     SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing

# ---- 外观常量 ---------------------------------------------------------------
$width = 380
$radius = 12
$padX = 16
$accentWidth = 4
$bgColor = [System.Drawing.Color]::FromArgb(27, 31, 39)      # #1B1F27
$lineColor = [System.Drawing.Color]::FromArgb(48, 54, 66)    # 细边框
$titleColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$bodyColor = [System.Drawing.Color]::FromArgb(201, 209, 217)
$mutedColor = [System.Drawing.Color]::FromArgb(139, 148, 158)
# 允许调用方传 "2ECC71"（不带 #）：从 node 里 spawn 时，# 开头的 token 会被
# PowerShell 当成注释，导致 -Accent 后面没有值。这里统一补上 #。
if ($Accent -and -not $Accent.StartsWith('#')) { $Accent = '#' + $Accent }
$accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)

$titleFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 11.5, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Point)
$bodyFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 9.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$hintFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 8, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)

# ---- 先量文字，再定窗口高度（正文自动折行） --------------------------------
$measureBmp = New-Object System.Drawing.Bitmap 8, 8
$measureGfx = [System.Drawing.Graphics]::FromImage($measureBmp)
$measureGfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$textWidth = $width - (2 * $padX) - $accentWidth - 6
$titleSize = $measureGfx.MeasureString($Title, $titleFont, $textWidth)
$bodyText = if ([string]::IsNullOrWhiteSpace($Msg)) { '' } else { $Msg }
$bodySize = if ($bodyText -eq '') { New-Object System.Drawing.SizeF 0, 0 } else { $measureGfx.MeasureString($bodyText, $bodyFont, $textWidth) }
$measureGfx.Dispose()
$measureBmp.Dispose()

$headerHeight = [int][Math]::Ceiling($titleSize.Height)
$bodyHeight = [int][Math]::Ceiling($bodySize.Height)
$hintHeight = 16
$height = $padX + $headerHeight + $(if ($bodyHeight -gt 0) { 4 + $bodyHeight } else { 0 }) + 6 + $hintHeight + $padX
if ($height -lt 96) { $height = 96 }
if ($height -gt 260) { $height = 260 }

# ---- 定位：光标所在屏幕的工作区 ---------------------------------------------
$screen = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
$area = $screen.WorkingArea
$margin = 24
$x = switch ($Pos) {
    'br' { $area.Right - $width - $margin }
    'tr' { $area.Right - $width - $margin }
    'tl' { $area.Left + $margin }
    'bc' { $area.Left + [int](($area.Width - $width) / 2) }
    'center' { $area.Left + [int](($area.Width - $width) / 2) }
    default { $area.Right - $width - $margin }
}
$y = switch ($Pos) {
    'tr' { $area.Top + $margin }
    'tl' { $area.Top + $margin }
    'bc' { $area.Bottom - $height - $margin }
    'center' { $area.Top + [int](($area.Height - $height) / 2) }
    default { $area.Bottom - $height - $margin }
}

# ---- 窗口 -------------------------------------------------------------------
$form = New-Object ReminderWindow
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = New-Object System.Drawing.Rectangle $x, $y, $width, $height
$form.BackColor = $bgColor
$form.Opacity = 0

# 圆角
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(0, 0, $radius * 2, $radius * 2, 180, 90)
$path.AddArc($width - $radius * 2 - 1, 0, $radius * 2, $radius * 2, 270, 90)
$path.AddArc($width - $radius * 2 - 1, $height - $radius * 2 - 1, $radius * 2, $radius * 2, 0, 90)
$path.AddArc(0, $height - $radius * 2 - 1, $radius * 2, $radius * 2, 90, 90)
$path.CloseFigure()
$form.Region = New-Object System.Drawing.Region $path

$form.Add_Paint({
    param($sender, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # 左侧强调色条（用圆角裁剪，跟着卡片形状走）
    $barRect = New-Object System.Drawing.Rectangle 0, 0, ($accentWidth + 8), $height
    $oldClip = $g.Clip
    $g.SetClip($path)
    $barBrush = New-Object System.Drawing.SolidBrush $accentColor
    $g.FillRectangle($barBrush, $barRect)
    $barBrush.Dispose()
    $g.Clip = $oldClip

    # 边框
    $pen = New-Object System.Drawing.Pen $lineColor, 1
    $g.DrawPath($pen, $path)
    $pen.Dispose()

    $textLeft = $accentWidth + $padX
    $titleBrush = New-Object System.Drawing.SolidBrush $titleColor
    $g.DrawString($Title, $titleFont, $titleBrush, $textLeft, $padX - 2)
    $titleBrush.Dispose()

    if ($bodyText -ne '') {
        $bodyBrush = New-Object System.Drawing.SolidBrush $bodyColor
        $bodyRect = New-Object System.Drawing.RectangleF $textLeft, ($padX + $headerHeight + 4), $textWidth, ($bodyHeight + 4)
        $g.DrawString($bodyText, $bodyFont, $bodyBrush, $bodyRect)
        $bodyBrush.Dispose()
    }

    $hint = ('{0} 秒后自动关闭 · 点一下关掉' -f $Seconds)
    $hintBrush = New-Object System.Drawing.SolidBrush $mutedColor
    $g.DrawString($hint, $hintFont, $hintBrush, $textLeft, ($height - $padX - 12))
    $hintBrush.Dispose()
})

# ---- 淡入 / 停留 / 淡出 ------------------------------------------------------
$script:phase = 'in'
$script:ticks = 0
$fadeTicks = 12      # ~180ms
$script:deadline = (Get-Date).AddSeconds([Math]::Max(1, $Seconds))

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10

$timer.Add_Tick({
    $script:ticks++
    switch ($script:phase) {
        'in' {
            $form.Opacity = [Math]::Min(1.0, $script:ticks / $fadeTicks)
            if ($script:ticks -ge $fadeTicks) { $script:phase = 'hold'; $script:ticks = 0 }
        }
        'hold' {
            # 用真实时钟而不是 tick 数：WinForms 计时器最细约 15ms，数 tick 会明显偏长
            if ((Get-Date) -ge $script:deadline) { $script:phase = 'out'; $script:ticks = 0 }
        }
        'out' {
            $form.Opacity = [Math]::Max(0.0, 1.0 - ($script:ticks / $fadeTicks))
            if ($script:ticks -ge $fadeTicks) {
                $timer.Stop()
                Write-Log 'closed'
                $form.Close()
                [System.Windows.Forms.Application]::Exit()
            }
        }
    }
})

$form.Add_Click({
    if ($script:phase -ne 'out') {
        $script:phase = 'out'
        $script:ticks = 0
        Write-Log 'clicked'
    }
})

# ---- 声音（异步，窗口先出） -------------------------------------------------
$script:player = $null
if (-not $NoSound -and -not [string]::IsNullOrEmpty($Audio) -and (Test-Path -LiteralPath $Audio)) {
    try {
        $script:player = New-Object System.Media.SoundPlayer $Audio
        $script:player.Play()
        Write-Log ('audio ' + $Audio)
    } catch {
        Write-Log ('audio-failed ' + $_.Exception.Message)
    }
}

# ---- 显示并进入消息循环 -----------------------------------------------------
$form.Show()
$form.RaiseWithoutActivating()
Write-Log ('shown hwnd=' + $form.Handle + ' bounds=' + $form.Bounds)
$timer.Start()
[System.Windows.Forms.Application]::Run()

if ($script:player -ne $null) { $script:player.Dispose() }
$titleFont.Dispose()
$bodyFont.Dispose()
$hintFont.Dispose()
$path.Dispose()
Write-Log 'exit'
