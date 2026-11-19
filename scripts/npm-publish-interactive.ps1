$ErrorActionPreference = 'Continue'
$repo    = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-reminder-notify'
$nodeDir = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node'
$node    = Join-Path $nodeDir 'bin\node.exe'
$pnpm    = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
$env:PATH = (Join-Path $nodeDir 'bin') + ';' + $env:PATH
Set-Location $repo

Write-Host ''
Write-Host '=== npm publish (will ask for a one-time password) ===' -ForegroundColor Cyan
Write-Host ''
& $node $pnpm dlx npm@latest publish --access public --ignore-scripts --registry https://registry.npmjs.org/
$code = $LASTEXITCODE
Write-Host ''
if ($code -eq 0) {
  Write-Host '=== PUBLISH DONE - OK ===' -ForegroundColor Green
} else {
  Write-Host ('=== PUBLISH FAILED - exit ' + $code + ' ===') -ForegroundColor Red
}
Write-Host ''
