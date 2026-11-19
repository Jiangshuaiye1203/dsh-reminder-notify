$ErrorActionPreference = 'Continue'
$repo    = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-reminder-notify'
$nodeDir = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node'
$node    = Join-Path $nodeDir 'bin\node.exe'
$pnpm    = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
$log     = Join-Path $env:TEMP 'npm-login-output.txt'
$reg     = 'https://registry.npmjs.org/'

Remove-Item $log -ErrorAction SilentlyContinue
$env:PATH = (Join-Path $nodeDir 'bin') + ';' + $env:PATH
Set-Location $repo

Write-Host ''
Write-Host '=== STEP 1: npm login (web authorize) ===' -ForegroundColor Cyan
& $node $pnpm dlx npm@latest login --auth-type=web --registry $reg 2>&1 | Tee-Object -FilePath $log -Append

if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '=== STEP 1b: fallback password login ===' -ForegroundColor Yellow
  & $node $pnpm dlx npm@latest login --auth-type=legacy --registry $reg 2>&1 | Tee-Object -FilePath $log -Append
}

Write-Host ''
Write-Host '=== STEP 2: npm publish ===' -ForegroundColor Cyan
& $node $pnpm dlx npm@latest publish --access public --no-git-checks --ignore-scripts --registry $reg 2>&1 | Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

Write-Host ''
if ($code -eq 0) {
  Write-Host '=== PUBLISH DONE - OK ===' -ForegroundColor Green
} else {
  Write-Host ('=== PUBLISH FAILED - exit ' + $code + ' ===') -ForegroundColor Red
}
Write-Host '(this window can stay open; the agent will read the log file)'
Write-Host ''
