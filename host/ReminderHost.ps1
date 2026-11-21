<#
  ReminderHost.ps1 —— 零二进制的桌面提醒宿主（Windows 自带 PowerShell 5.1 + WinForms）

  为什么存在：原来的 assets/Harness完成提醒.exe 是未签名的编译产物，公开分发会被
  SmartScreen / 杀软拦。本脚本用系统自带组件画同一个提醒窗口，仓库里不出现任何二进制，
  也不需要买代码签名证书、不需要编译环境。

  行为（对齐原 exe，并加了 0.11 的新东西）：
    · 右下角（可换角）悬浮卡片，圆角、无边框、置顶
    · 不抢焦点（ShowWithoutActivation + WS_EX_NOACTIVATE），不进 Alt+Tab
    · 按秒自动淡出关闭；点空白处立即关
    · 可选播放 wav / mp3（System.Media.SoundPlayer / WMP COM，异步）
    · 卡片上有两个按钮：「知道了」「N 分钟后再提醒」（-NoButtons 可关）
    · 关掉时把用户的选择写进 -ResultPath，插件据此决定要不要重排
    · -Speak：用系统语音把这句话念出来（System.Speech，异步）
    · -AutoCompact：检测到前台是全屏程序时自动缩成小条，不打扰
    · -QueueLeft：还有几条在排队，卡片底部显示「还有 N 条」

  参数：-Title -Msg -Seconds -Pos(br|tr|tl|bc|center) -Audio -Accent -Background -Icon
        -NoSound -Speak -ResultPath -SnoozeMinutes -NoButtons -Compact -AutoCompact
        -QueueLeft -Preview -Log
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
    [string]$Background = '',
    [string]$Icon = '',
    [switch]$NoSound,
    [string]$Speak = '',
    [string]$ResultPath = '',
    [int]$SnoozeMinutes = 10,
    [switch]$NoButtons,
    [string]$OpenUrl = '',
    [switch]$Reply,
    [string]$CustomButtons = '',
    [switch]$RespectFocus,
    [switch]$Compact,
    [switch]$AutoCompact,
    [int]$QueueLeft = 0,
    [switch]$Preview,
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

public struct DshRect { public int Left, Top, Right, Bottom; }

// Windows「专注助手 / 免打扰」状态：shell32!SHQueryUserNotificationState
// 1=NOT_PRESENT 2=BUSY 3=FULLSCREEN_D3D 4=PRESENTATION 5=ACCEPTS 6=QUIET_TIME 7=APP
public static class DshFocus
{
    [DllImport("shell32.dll")]
    public static extern int SHQueryUserNotificationState(out int state);

    public static int State()
    {
        try
        {
            int state;
            if (SHQueryUserNotificationState(out state) != 0) { return 0; }
            return state;
        }
        catch { return 0; }
    }

    // 专注助手开启、演示模式、全屏忙、勿扰时段：这些时候不出声
    public static bool SuppressAudio()
    {
        int state = State();
        return state == 2 || state == 3 || state == 4 || state == 6;
    }
}

public static class DshWin
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out DshRect rect);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}

public sealed class ReminderWindow : Form
{
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
        DshWin.SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0,
                            SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
}
'@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing

# ---- 全屏检测（-AutoCompact 时用来降级成小条） -------------------------------
function Test-ForegroundFullscreen {
    try {
        $hwnd = [DshWin]::GetForegroundWindow()
        if ($hwnd -eq [IntPtr]::Zero) { return $false }
        $r = New-Object DshRect
        if (-not [DshWin]::GetWindowRect($hwnd, [ref]$r)) { return $false }
        $screen = [System.Windows.Forms.Screen]::FromHandle($hwnd)
        $b = $screen.Bounds
        $winW = $r.Right - $r.Left
        $winH = $r.Bottom - $r.Top
        # 窗口盖住整块屏幕（允许 2px 误差）且没有可见边框留白，就当作全屏
        return (($winW -ge ($b.Width - 2)) -and ($winH -ge ($b.Height - 2)))
    } catch {
        return $false
    }
}

if ($AutoCompact -and (Test-ForegroundFullscreen)) {
    $Compact = $true
    Write-Log 'auto-compact (foreground is fullscreen)'
}

# ---- 外观常量 ---------------------------------------------------------------
$radius = 12
$padX = 16
$accentWidth = 4
$bgColor = [System.Drawing.Color]::FromArgb(27, 31, 39)      # #1B1F27
$lineColor = [System.Drawing.Color]::FromArgb(48, 54, 66)    # 细边框
$titleColor = [System.Drawing.Color]::FromArgb(255, 255, 255)
$bodyColor = [System.Drawing.Color]::FromArgb(201, 209, 217)
$mutedColor = [System.Drawing.Color]::FromArgb(139, 148, 158)
$btnColor = [System.Drawing.Color]::FromArgb(45, 52, 63)
$btnHoverColor = [System.Drawing.Color]::FromArgb(62, 71, 85)
# 允许调用方传 "2ECC71"（不带 #）：从 node 里 spawn 时，# 开头的 token 会被
# PowerShell 当成注释，导致 -Accent 后面没有值。这里统一补上 #。
if ($Accent -and -not $Accent.StartsWith('#')) { $Accent = '#' + $Accent }
$accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)

$showButtons = -not $NoButtons
if ($Compact) {
    # 小条模式：正文和按钮都不画，只留一行标题 + 剩余条数
    $width = 300
    $showButtons = $false
} else {
    $width = 380
}

# ---- 自定义按钮（label|url;label|url，最多 3 个） ---------------------------
$customList = New-Object System.Collections.ArrayList
if ($showButtons -and -not [string]::IsNullOrWhiteSpace($CustomButtons)) {
    foreach ($chunk in ($CustomButtons -split ';')) {
        if ([string]::IsNullOrWhiteSpace($chunk)) { continue }
        $pair = $chunk -split '\|', 2
        $label = $pair[0].Trim()
        if ($label -eq '') { continue }
        $url = if ($pair.Count -gt 1) { $pair[1].Trim() } else { '' }
        if ($label.Length -gt 8) { $label = $label.Substring(0, 8) }
        [void]$customList.Add(@{ label = $label; url = $url })
        if ($customList.Count -ge 3) { break }
    }
}
$showReply = ($Reply -and $showButtons)

$titleSize = 11.5
$bodySize = 9.5
$titleFont = New-Object System.Drawing.Font('Microsoft YaHei UI', $titleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Point)
$bodyFont = New-Object System.Drawing.Font('Microsoft YaHei UI', $bodySize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$hintFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 8, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$btnFont = New-Object System.Drawing.Font('Microsoft YaHei UI', 8.5, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)

# ---- 先量文字，再定窗口高度（正文自动折行） --------------------------------
$measureBmp = New-Object System.Drawing.Bitmap 8, 8
$measureGfx = [System.Drawing.Graphics]::FromImage($measureBmp)
$measureGfx.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$textWidth = $width - (2 * $padX) - $accentWidth - 6

# ---- 自定义外观：背景图与标题左侧图标（都可缺省） ---------------------------
$iconSize = 22
$iconGap = 8
$bgBitmap = $null
$iconBitmap = $null
if (-not [string]::IsNullOrEmpty($Background) -and (Test-Path -LiteralPath $Background)) {
    try {
        # 先读进内存，避免 GDI+ 锁住用户文件
        $bgBitmap = New-Object System.Drawing.Bitmap((New-Object System.IO.MemoryStream(,[System.IO.File]::ReadAllBytes($Background))))
        Write-Log ('background ' + $Background)
    } catch {
        $bgBitmap = $null
        Write-Log ('background-failed ' + $_.Exception.Message)
    }
}
if (-not [string]::IsNullOrEmpty($Icon) -and (Test-Path -LiteralPath $Icon)) {
    try {
        $iconBitmap = New-Object System.Drawing.Bitmap((New-Object System.IO.MemoryStream(,[System.IO.File]::ReadAllBytes($Icon))))
        Write-Log ('icon ' + $Icon)
    } catch {
        $iconBitmap = $null
        Write-Log ('icon-failed ' + $_.Exception.Message)
    }
}
$hasIcon = $iconBitmap -ne $null
if ($hasIcon) { $textWidth = $textWidth - $iconSize - $iconGap }
$titleSizeF = $measureGfx.MeasureString($Title, $titleFont, $textWidth)
$bodyText = if ($Compact -or [string]::IsNullOrWhiteSpace($Msg)) { '' } else { $Msg }
$bodySizeF = if ($bodyText -eq '') { New-Object System.Drawing.SizeF 0, 0 } else { $measureGfx.MeasureString($bodyText, $bodyFont, $textWidth) }

# ---- 按钮尺寸（先量出来，才知道窗口要多高） ---------------------------------
$buttonHeight = 26
$buttonGap = 8
$okText = '知道了'
$snoozeText = ('{0} 分钟后再提醒' -f [Math]::Max(1, $SnoozeMinutes))
$okSize = $measureGfx.MeasureString($okText, $btnFont)
$snoozeSize = $measureGfx.MeasureString($snoozeText, $btnFont)
$okWidth = [int][Math]::Ceiling($okSize.Width) + 20
$snoozeWidth = [int][Math]::Ceiling($snoozeSize.Width) + 20
$customWidths = @()
foreach ($item in $customList) {
    $sz = $measureGfx.MeasureString($item.label, $btnFont)
    $customWidths += ([int][Math]::Ceiling($sz.Width) + 20)
}
$measureGfx.Dispose()
$measureBmp.Dispose()

$headerHeight = [int][Math]::Ceiling($titleSizeF.Height)
$bodyHeight = [int][Math]::Ceiling($bodySizeF.Height)
$hintHeight = 16
$customRowHeight = if ($showButtons -and $customList.Count -gt 0) { $buttonHeight + 6 } else { 0 }
$replyHeight = if ($showReply) { 30 + 6 } else { 0 }
$buttonsHeight = if ($showButtons) { $buttonHeight + 10 } else { 0 }
$height = $padX + $headerHeight + $(if ($bodyHeight -gt 0) { 4 + $bodyHeight } else { 0 }) + 6 + $hintHeight + $replyHeight + $customRowHeight + $buttonsHeight + $padX
if ($height -lt 96) { $height = 96 }
if ($height -gt 380) { $height = 380 }

# 按钮矩形（相对窗口，右下角排列）
$script:btnRects = @{}
$script:hover = ''
if ($showButtons) {
    $btnRight = $width - $padX
    $btnTop = $height - $padX - $buttonHeight
    $snoozeRect = New-Object System.Drawing.Rectangle ($btnRight - $snoozeWidth), $btnTop, $snoozeWidth, $buttonHeight
    $okRect = New-Object System.Drawing.Rectangle ($snoozeRect.Left - $buttonGap - $okWidth), $btnTop, $okWidth, $buttonHeight
    $script:btnRects['snooze'] = $snoozeRect
    $script:btnRects['ok'] = $okRect
    if ($OpenUrl -ne '') {
        $openWidth = 78
        $openRect = New-Object System.Drawing.Rectangle ($okRect.Left - $buttonGap - $openWidth), $btnTop, $openWidth, $buttonHeight
        $script:btnRects['open'] = $openRect
    }
    $script:customRects = @()
    if ($customList.Count -gt 0) {
        $cx = $accentWidth + $padX
        $cy = $btnTop - $buttonHeight - 6
        for ($i = 0; $i -lt $customList.Count; $i++) {
            $w = $customWidths[$i]
            if (($cx + $w) -gt ($width - $padX)) { break }
            $r = New-Object System.Drawing.Rectangle $cx, $cy, $w, $buttonHeight
            $script:customRects += ,@($r, $i)
            $cx = $cx + $w + 6
        }
    }
}

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

# ---- 回复输入框（-Reply）：卡片上直接打字，Enter 发回给插件 -------------------
$script:replyBox = $null
$script:replyRect = $null
$script:replyText = ''
if ($showReply) {
    $boxTop = $height - $padX - $buttonsHeight - 6 - $customRowHeight - 26
    $boxWidth = $width - $accentWidth - $padX - $padX
    $box = New-Object System.Windows.Forms.TextBox
    $box.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
    $box.BackColor = [System.Drawing.Color]::FromArgb(37, 43, 54)
    $box.ForeColor = [System.Drawing.Color]::FromArgb(230, 237, 243)
    $box.Font = $bodyFont
    $box.Bounds = New-Object System.Drawing.Rectangle ($accentWidth + $padX), $boxTop, $boxWidth, 24
    $box.MaxLength = 300
    $box.Add_KeyDown({
        param($bsender, $be)
        if ($be.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
            $script:replyText = $bsender.Text.Trim()
            Close-With $(if ($script:replyText -eq '') { 'ok' } else { 'replied' })
            $be.SuppressKeyPress = $true
        } elseif ($be.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
            Close-With 'dismiss'
            $be.SuppressKeyPress = $true
        }
    })
    $form.Controls.Add($box)
    $script:replyBox = $box
    $script:replyRect = $box.Bounds
}

$form.Add_Paint({
    param($sender, $e)
    $g = $e.Graphics
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # 左侧强调色条（用圆角裁剪，跟着卡片形状走）
    $barRect = New-Object System.Drawing.Rectangle 0, 0, ($accentWidth + 8), $height
    $oldClip = $g.Clip
    $g.SetClip($path)
    # 背景图：等比裁切鋪满，再压一层暗色保证白字可读
    if ($bgBitmap -ne $null) {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $scale = [Math]::Max($width / $bgBitmap.Width, $height / $bgBitmap.Height)
        $drawW = [int][Math]::Ceiling($bgBitmap.Width * $scale)
        $drawH = [int][Math]::Ceiling($bgBitmap.Height * $scale)
        $dx = [int](($width - $drawW) / 2)
        $dy = [int](($height - $drawH) / 2)
        $g.DrawImage($bgBitmap, (New-Object System.Drawing.Rectangle $dx, $dy, $drawW, $drawH))
        $shade = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 12, 15, 20))
        $g.FillRectangle($shade, 0, 0, $width, $height)
        $shade.Dispose()
    }
    $barBrush = New-Object System.Drawing.SolidBrush $accentColor
    $g.FillRectangle($barBrush, $barRect)
    $barBrush.Dispose()
    $g.Clip = $oldClip

    # 边框
    $pen = New-Object System.Drawing.Pen $lineColor, 1
    $g.DrawPath($pen, $path)
    $pen.Dispose()

    $textLeft = $accentWidth + $padX
    if ($hasIcon -and -not $Compact) {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $iconRect = New-Object System.Drawing.Rectangle $textLeft, ($padX - 1), $iconSize, $iconSize
        $g.DrawImage($iconBitmap, $iconRect)
        $textLeft = $textLeft + $iconSize + $iconGap
    }
    $titleBrush = New-Object System.Drawing.SolidBrush $titleColor
    $g.DrawString($Title, $titleFont, $titleBrush, $textLeft, $padX - 2)
    $titleBrush.Dispose()

    if ($bodyText -ne '') {
        $bodyBrush = New-Object System.Drawing.SolidBrush $bodyColor
        $bodyRect = New-Object System.Drawing.RectangleF $textLeft, ($padX + $headerHeight + 4), $textWidth, ($bodyHeight + 4)
        $g.DrawString($bodyText, $bodyFont, $bodyBrush, $bodyRect)
        $bodyBrush.Dispose()
    }

    $hint = ('{0} 秒后自动关闭' -f $Seconds)
    if ($QueueLeft -gt 0) { $hint = $hint + (' · 还有 {0} 条' -f $QueueLeft) }
    if (-not $showButtons) { $hint = $hint + ' · 点一下关掉' }
    if ($showReply) { $hint = $hint + ' · 输入后按 Enter 回话' }
    if ($script:focusAssist) { $hint = $hint + ' · 专注中已静音' }
    $hintBrush = New-Object System.Drawing.SolidBrush $mutedColor
    $hintTop = $height - $padX - 12 - $buttonsHeight - $customRowHeight - $replyHeight
    $g.DrawString($hint, $hintFont, $hintBrush, $textLeft, $hintTop)
    $hintBrush.Dispose()

    # 按钮
    if ($showButtons) {
        foreach ($key in @('open', 'ok', 'snooze')) {
            $rect = $script:btnRects[$key]
            if ($rect -eq $null) { continue }
            $fill = if ($script:hover -eq $key) { $btnHoverColor } else { $btnColor }
            $btnPath = New-Object System.Drawing.Drawing2D.GraphicsPath
            $r2 = 8
            $btnPath.AddArc($rect.X, $rect.Y, $r2 * 2, $r2 * 2, 180, 90)
            $btnPath.AddArc($rect.Right - $r2 * 2, $rect.Y, $r2 * 2, $r2 * 2, 270, 90)
            $btnPath.AddArc($rect.Right - $r2 * 2, $rect.Bottom - $r2 * 2, $r2 * 2, $r2 * 2, 0, 90)
            $btnPath.AddArc($rect.X, $rect.Bottom - $r2 * 2, $r2 * 2, $r2 * 2, 90, 90)
            $btnPath.CloseFigure()
            $btnBrush = New-Object System.Drawing.SolidBrush $fill
            $g.FillPath($btnBrush, $btnPath)
            $btnBrush.Dispose()
            $btnPath.Dispose()
            $label = if ($key -eq 'ok') { $okText } elseif ($key -eq 'open') { '打开链接' } else { $snoozeText }
            $fmt = New-Object System.Drawing.StringFormat
            $fmt.Alignment = [System.Drawing.StringAlignment]::Center
            $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
            $labelBrush = New-Object System.Drawing.SolidBrush $bodyColor
            $g.DrawString($label, $btnFont, $labelBrush, (New-Object System.Drawing.RectangleF $rect.X, $rect.Y, $rect.Width, $rect.Height), $fmt)
            $labelBrush.Dispose()
            $fmt.Dispose()
        }
    }

    # 自定义按钮（多出来的那一行）
    foreach ($pair in $script:customRects) {
        $rect = $pair[0]
        $idx = $pair[1]
        $fill = if ($script:hover -eq ('c' + $idx)) { $btnHoverColor } else { $btnColor }
        $btnPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $r2 = 8
        $btnPath.AddArc($rect.X, $rect.Y, $r2 * 2, $r2 * 2, 180, 90)
        $btnPath.AddArc($rect.Right - $r2 * 2, $rect.Y, $r2 * 2, $r2 * 2, 270, 90)
        $btnPath.AddArc($rect.Right - $r2 * 2, $rect.Bottom - $r2 * 2, $r2 * 2, $r2 * 2, 0, 90)
        $btnPath.AddArc($rect.X, $rect.Bottom - $r2 * 2, $r2 * 2, $r2 * 2, 90, 90)
        $btnPath.CloseFigure()
        $btnBrush = New-Object System.Drawing.SolidBrush $fill
        $g.FillPath($btnBrush, $btnPath)
        $btnBrush.Dispose()
        $btnPath.Dispose()
        $fmt = New-Object System.Drawing.StringFormat
        $fmt.Alignment = [System.Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
        $labelBrush = New-Object System.Drawing.SolidBrush $bodyColor
        $g.DrawString($customList[$idx].label, $btnFont, $labelBrush, (New-Object System.Drawing.RectangleF $rect.X, $rect.Y, $rect.Width, $rect.Height), $fmt)
        $labelBrush.Dispose()
        $fmt.Dispose()
    }
})

# ---- 淡入 / 停留 / 淡出 ------------------------------------------------------
$script:phase = 'in'
$script:ticks = 0
$script:action = 'timeout'
$script:btnLabel = ''
$script:btnUrl = ''
$fadeTicks = 12      # ~180ms
$script:deadline = (Get-Date).AddSeconds([Math]::Max(1, $Seconds))
$script:holdStart = Get-Date

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10

$timer.Add_Tick({
    $script:ticks++
    switch ($script:phase) {
        'in' {
            $form.Opacity = [Math]::Min(1.0, $script:ticks / $fadeTicks)
            if ($script:ticks -ge $fadeTicks) { $script:phase = 'hold'; $script:ticks = 0; $script:holdStart = Get-Date }
        }
        'hold' {
            # 用真实时钟而不是 tick 数：WinForms 计时器最细约 15ms，数 tick 会明显偏长
            if ((Get-Date) -ge $script:deadline) {
                $script:phase = 'out'
                $script:ticks = 0
                if ($script:action -eq 'timeout') { $script:action = 'timeout' }
            }
        }
        'out' {
            $form.Opacity = [Math]::Max(0.0, 1.0 - ($script:ticks / $fadeTicks))
            if ($script:ticks -ge $fadeTicks) {
                $timer.Stop()
                Write-Log ('closed action=' + $script:action)
                $form.Close()
                [System.Windows.Forms.Application]::Exit()
            }
        }
    }
})

function Close-With([string]$action) {
    if ($script:phase -eq 'out') { return }
    $script:action = $action
    $script:phase = 'out'
    $script:ticks = 0
    Write-Log ('action ' + $action)
}

$form.KeyPreview = $true
$form.Add_KeyDown({
    param($sender, $e)
    if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) {
        if ($showReply -and $script:replyBox -ne $null) {
            $typed = $script:replyBox.Text.Trim()
            if ($typed -ne '') { $script:replyText = $typed; Close-With 'replied'; return }
        }
        Close-With 'ok'
    }
    elseif ($e.KeyCode -eq [System.Windows.Forms.Keys]::S) { Close-With 'snooze' }
    elseif ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { Close-With 'dismiss' }
})

$form.Add_MouseDown({
    param($sender, $e)
    if ($script:phase -eq 'out') { return }

    # 点输入框：先激活窗口再聚焦（WS_EX_NOACTIVATE 下点一下也能打字）
    if ($script:replyRect -ne $null -and $script:replyRect.Contains($e.X, $e.Y)) {
        try { $form.Activate(); $script:replyBox.Focus() } catch { }
        return
    }

    # 自定义按钮
    foreach ($pair in $script:customRects) {
        $rect = $pair[0]
        if ($rect.Contains($e.X, $e.Y)) {
            $idx = $pair[1]
            $item = $customList[$idx]
            $script:btnLabel = $item.label
            $script:btnUrl = $item.url
            if ($item.url -ne '') {
                try { Start-Process $item.url | Out-Null } catch { }
                Close-With 'ok'
            } else {
                Close-With 'custom'
            }
            return
        }
    }

    foreach ($key in @('open', 'ok', 'snooze')) {
        $rect = $script:btnRects[$key]
        if ($rect -ne $null -and $rect.Contains($e.X, $e.Y)) {
            if ($key -eq 'open' -and $OpenUrl -ne '') {
                try { Start-Process $OpenUrl | Out-Null } catch { }
                Close-With 'ok'
                return
            }
            if ($key -eq 'ok' -and $showReply -and $script:replyBox -ne $null) {
                $typed = $script:replyBox.Text.Trim()
                if ($typed -ne '') { $script:replyText = $typed; Close-With 'replied'; return }
            }
            Close-With $key
            return
        }
    }
    Close-With 'dismiss'
})

$form.Add_MouseMove({
    param($sender, $e)
    if (-not $showButtons) { return }
    $next = ''
    foreach ($key in @('open', 'ok', 'snooze')) {
        $rect = $script:btnRects[$key]
        if ($rect -ne $null -and $rect.Contains($e.X, $e.Y)) { $next = $key }
    }
    foreach ($pair in $script:customRects) {
        if ($pair[0].Contains($e.X, $e.Y)) { $next = ('c' + $pair[1]) }
    }
    if ($script:replyRect -ne $null -and $script:replyRect.Contains($e.X, $e.Y)) {
        $form.Cursor = [System.Windows.Forms.Cursors]::IBeam
        return
    }
    if ($next -ne $script:hover) {
        $script:hover = $next
        if ($next -eq '') { $form.Cursor = [System.Windows.Forms.Cursors]::Default }
        else { $form.Cursor = [System.Windows.Forms.Cursors]::Hand }
        $form.Invalidate()
    }
})

# ---- 声音（异步，窗口先出） -------------------------------------------------
# wav 用 SoundPlayer（零依赖、异步）；其余格式（mp3/wma…）走 Windows Media Player COM。
# ogg 是否可播取决于系统是否装了对应解码器，播不了只记日志、不影响弹卡。
$script:player = $null
$script:wmp = $null
# 专注助手 / 演示 / 全屏忙：按开关直接静音（配置 focusAssistMute）
$script:focusAssist = $false
if ($RespectFocus -and -not $NoSound) {
    try {
        $script:focusAssist = [DshFocus]::SuppressAudio()
        Write-Log ('focus state=' + [DshFocus]::State() + ' suppress=' + $script:focusAssist)
    } catch {
        $script:focusAssist = $false
        Write-Log ('focus-failed ' + $_.Exception.Message)
    }
}
if (-not $NoSound -and -not $script:focusAssist -and -not [string]::IsNullOrEmpty($Audio) -and (Test-Path -LiteralPath $Audio)) {
    $ext = [System.IO.Path]::GetExtension($Audio).ToLowerInvariant()
    try {
        if ($ext -eq '.wav') {
            $script:player = New-Object System.Media.SoundPlayer $Audio
            $script:player.Play()
            Write-Log ('audio wav ' + $Audio)
        } else {
            $script:wmp = New-Object -ComObject WMPlayer.OCX
            $script:wmp.settings.volume = 100
            $script:wmp.URL = $Audio
            $script:wmp.controls.play()
            Write-Log ('audio media ' + $ext + ' ' + $Audio)
        }
    } catch {
        Write-Log ('audio-failed ' + $ext + ' ' + $_.Exception.Message)
    }
}

# ---- 语音朗读（System.Speech，异步，缺语音包就跳过） -------------------------
$script:synth = $null
if (-not [string]::IsNullOrWhiteSpace($Speak)) {
    try {
        Add-Type -AssemblyName System.Speech
        $script:synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $script:synth.SpeakAsync($Speak)
        Write-Log ('speak ' + $Speak)
    } catch {
        $script:synth = $null
        Write-Log ('speak-failed ' + $_.Exception.Message)
    }
}

# ---- 试听：只放声音，不弹卡 ----------------------------------------------------
# 面板里的「试听」按钮走这条分支：播完（或最多 8 秒）就退出，不留窗口。
if ($Preview) {
    if ($script:player -ne $null) {
        $deadline = (Get-Date).AddSeconds(8)
        while ((Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
        try { $script:player.Stop() } catch { }
        $script:player.Dispose()
    }
    if ($script:wmp -ne $null) {
        $deadline = (Get-Date).AddSeconds(8)
        while ((Get-Date) -lt $deadline -and $script:wmp.playState -ne 1) { Start-Sleep -Milliseconds 200 }
        try { $script:wmp.controls.stop(); $script:wmp.close() } catch { }
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($script:wmp) } catch { }
    }
    Write-Log 'preview exit'
    exit 0
}

# ---- 显示并进入消息循环 -----------------------------------------------------
$form.Show()
$form.RaiseWithoutActivating()
Write-Log ('shown hwnd=' + $form.Handle + ' bounds=' + $form.Bounds + ' compact=' + $Compact + ' buttons=' + $showButtons)
$timer.Start()
[System.Windows.Forms.Application]::Run()

$elapsedMs = [int]((Get-Date) - $script:holdStart).TotalMilliseconds

# ---- 把用户的选择写回去（插件据此决定要不要重排） ---------------------------
if (-not [string]::IsNullOrEmpty($ResultPath)) {
    try {
        $payload = [ordered]@{
            action    = $script:action
            at        = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            elapsedMs = $elapsedMs
            snooze    = $(if ($script:action -eq 'snooze') { [Math]::Max(1, $SnoozeMinutes) } else { 0 })
            reply     = $(if ($script:action -eq 'replied') { $script:replyText } else { '' })
            button    = $(if ($script:action -eq 'custom') { $script:btnLabel } else { '' })
            focusAssist = $script:focusAssist
        }
        $json = ($payload | ConvertTo-Json -Compress)
        [System.IO.File]::WriteAllText($ResultPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Log ('result ' + $json)
    } catch {
        Write-Log ('result-failed ' + $_.Exception.Message)
    }
}

if ($script:player -ne $null) { $script:player.Dispose() }
if ($script:wmp -ne $null) {
    try { $script:wmp.controls.stop(); $script:wmp.close() } catch { }
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($script:wmp) } catch { }
}
if ($script:synth -ne $null) {
    try { $script:synth.Dispose() } catch { }
}
$titleFont.Dispose()
$bodyFont.Dispose()
$hintFont.Dispose()
$btnFont.Dispose()
if ($bgBitmap -ne $null) { $bgBitmap.Dispose() }
if ($iconBitmap -ne $null) { $iconBitmap.Dispose() }
$path.Dispose()
Write-Log 'exit'
