param([string]$OutputName = 'Kunming349Desktop.exe')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw '找不到 .NET Framework C# 编译器。请安装 .NET Framework 4.8 Developer Pack。' }
$references = @(
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    "/r:$PSScriptRoot\Microsoft.Web.WebView2.Core.dll",
    "/r:$PSScriptRoot\Microsoft.Web.WebView2.WinForms.dll"
)
$source = Join-Path $PSScriptRoot 'Kunming349Desktop.cs'
$manifest = Join-Path $PSScriptRoot 'Kunming349Desktop.manifest'
$icon = Join-Path $PSScriptRoot 'kmmu349.ico'
$output = Join-Path $PSScriptRoot $OutputName
Push-Location $projectRoot
try {
    & $compiler /nologo /target:winexe /platform:x64 "/out:$output" "/win32manifest:$manifest" "/win32icon:$icon" @references $source
    if ($LASTEXITCODE -ne 0) { throw "C# 编译失败，退出码 $LASTEXITCODE。" }
} finally {
    Pop-Location
}
Write-Host "桌面程序已生成：$output"
