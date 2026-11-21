param(
  [string]$PfxPath = "$env:USERPROFILE\.dsh\dsh-reminder-notify\mobile.pfx",
  [string]$Password = 'dsh-reminder'
)
$ErrorActionPreference = 'Stop'

# 生成手机页用的自签证书：把本机所有内网 IPv4 与 localhost 都写进 SAN，
# 导成 pfx（插件用 node:https 直接读这个文件）。
$ips = @()
try {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
    Select-Object -ExpandProperty IPAddress
} catch {
  $ips = @()
}
if ($ips.Count -eq 0) { $ips = @('192.168.1.36') }

$san = '2.5.29.17={text}' + (($ips | ForEach-Object { "IPAddress=$_" }) -join '&') + '&DNS=localhost'
$cert = New-SelfSignedCertificate `
  -Subject "CN=dsh-reminder-notify (mobile)" `
  -TextExtension @($san) `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -NotAfter (Get-Date).AddYears(3) `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA -KeyLength 2048

$dir = Split-Path -Parent $PfxPath
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $secure | Out-Null
Remove-Item ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue

Write-Output ("cert ok: " + $PfxPath + " | ips: " + ($ips -join ','))
