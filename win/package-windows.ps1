param(
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",
  [switch]$NoArchive
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "win\BeachCourt\BeachCourt.csproj"
$dist = Join-Path $root "dist"
$publish = Join-Path $dist "BeachCourt-Windows-x64"
$zip = Join-Path $dist "BeachCourt-Windows-x64.zip"
$cache = Join-Path $root "build\cache"
$runtimePackage = Join-Path $cache "WebView2.Runtime.X64.155.0.4283.62.nupkg"
$runtimeUrl = "https://api.nuget.org/v3-flatcontainer/webview2.runtime.x64/155.0.4283.62/webview2.runtime.x64.155.0.4283.62.nupkg"
$runtimeCorePackage = Join-Path $cache "WebView2.Runtime.X64.Core.155.0.4283.62.nupkg"
$runtimeCoreUrl = "https://api.nuget.org/v3-flatcontainer/webview2.runtime.x64.core/155.0.4283.62/webview2.runtime.x64.core.155.0.4283.62.nupkg"

function Remove-VerifiedDirectory([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $resolved = (Resolve-Path -LiteralPath $path).Path
  $rootPath = (Resolve-Path -LiteralPath $root).Path
  if (-not $resolved.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝删除项目外目录: $resolved"
  }
  [System.IO.Directory]::Delete($resolved, $true)
}

New-Item -ItemType Directory -Path $dist, $cache -Force | Out-Null
Remove-VerifiedDirectory $publish
New-Item -ItemType Directory -Path $publish -Force | Out-Null

Write-Host "==> 发布自包含 Windows x64 程序"
dotnet publish $project -c $Configuration -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishReadyToRun=true -p:PublishTrimmed=false -p:DebugType=None -o $publish
if ($LASTEXITCODE -ne 0) { throw "dotnet publish 失败" }

Write-Host "==> 复制网页资源"
Copy-Item -LiteralPath (Join-Path $root "web") -Destination $publish -Recurse

foreach ($download in @(
  @{ Path = $runtimePackage; Url = $runtimeUrl },
  @{ Path = $runtimeCorePackage; Url = $runtimeCoreUrl }
)) {
  if (-not (Test-Path -LiteralPath $download.Path)) {
    Write-Host "==> 下载内置 WebView2 固定版运行时"
    Invoke-WebRequest -Uri $download.Url -OutFile $download.Path
  }
}

Write-Host "==> 解包 WebView2 运行时"
$runtimeTemp = Join-Path $cache "WebView2.Runtime.X64"
Remove-VerifiedDirectory $runtimeTemp
$runtimeZip = Join-Path $cache "WebView2.Runtime.X64.zip"
Copy-Item -LiteralPath $runtimePackage -Destination $runtimeZip -Force
Expand-Archive -LiteralPath $runtimeZip -DestinationPath $runtimeTemp -Force
$runtimeCoreZip = Join-Path $cache "WebView2.Runtime.X64.Core.zip"
Copy-Item -LiteralPath $runtimeCorePackage -Destination $runtimeCoreZip -Force
$runtimeCoreTemp = Join-Path $cache "WebView2.Runtime.X64.Core"
Remove-VerifiedDirectory $runtimeCoreTemp
Expand-Archive -LiteralPath $runtimeCoreZip -DestinationPath $runtimeCoreTemp -Force
$runtimeSource = Join-Path $runtimeTemp "contentFiles\any\any\WebView2"
$runtimeCoreSource = Join-Path $runtimeCoreTemp "contentFiles\any\any\WebView2"
if (-not (Test-Path -LiteralPath (Join-Path $runtimeSource "msedgewebview2.exe"))) {
  throw "WebView2 运行时包中找不到 msedgewebview2.exe"
}
if (-not (Test-Path -LiteralPath (Join-Path $runtimeCoreSource "msedge.dll"))) {
  throw "WebView2 核心运行时包中找不到 msedge.dll"
}
Copy-Item -LiteralPath $runtimeSource -Destination (Join-Path $publish "WebView2") -Recurse
Copy-Item -Path (Join-Path $runtimeCoreSource "*") -Destination (Join-Path $publish "WebView2") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $runtimeTemp "LICENSE.txt") -Destination (Join-Path $publish "WebView2\LICENSE.txt") -Force

$guide = @(
  "海边球场 Windows 绿色版",
  "========================",
  "",
  "使用方法",
  "--------",
  "1. 解压整个压缩包到任意文件夹。",
  "2. 双击 BeachCourt.exe。",
  "3. 不需要安装 .NET、WebView2 或其他运行时。",
  "",
  "基本操作",
  "--------",
  "Ctrl+Alt+X：把桌面上选中的文件揉成纸团",
  "Ctrl+Alt+Z：撤销/拆开最近一个纸团",
  "Ctrl+Alt+T：切换正午、早晨、黄昏、夜晚、跟随系统",
  "Ctrl+Alt+Q：安全退出",
  "空格：按住蓄力，松开投篮",
  "左右方向键：微调投篮方向",
  "Esc：取消蓄力或放下纸团",
  "",
  "文件安全",
  "--------",
  "程序不会删除文件。揉纸团期间文件暂存在桌面的隐藏目录 .beach-court；",
  "拆开、退出或异常恢复时，文件会自动放回桌面。"
)
Set-Content -LiteralPath (Join-Path $publish "使用说明.txt") -Value $guide -Encoding utf8

foreach ($required in @("BeachCourt.exe", "web\index.html", "WebView2\msedgewebview2.exe", "WebView2\msedge.dll")) {
  if (-not (Test-Path -LiteralPath (Join-Path $publish $required))) {
    throw "发布包缺少文件: $required"
  }
}

if (-not $NoArchive) {
  Write-Host "==> 生成 ZIP"
  if (Test-Path -LiteralPath $zip) { [System.IO.File]::Delete((Resolve-Path -LiteralPath $zip).Path) }
  Compress-Archive -Path (Join-Path $publish "*") -DestinationPath $zip -CompressionLevel Optimal
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  "$($hash.Hash)  $(Split-Path -Leaf $zip)" | Set-Content -LiteralPath "$zip.sha256" -Encoding ascii
  Get-Item -LiteralPath $zip | Select-Object FullName, Length
  Get-Content -LiteralPath "$zip.sha256"
}

Write-Host "==> 完成: $publish"
