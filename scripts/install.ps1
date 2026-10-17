param(
    [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$Workspace,
    [string]$Python,
    [switch]$ReplaceExisting
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimePath = Join-Path $projectRoot 'runtime'
$configPath = Join-Path $runtimePath 'config.json'
$manifestPath = Join-Path $runtimePath 'com.chatchatchats.local.json'
$previousConfig = $null
if (Test-Path -LiteralPath $configPath) {
    $previousConfig = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
foreach ($vendor in @('Google\Chrome','Microsoft\Edge')) {
    $keyPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.chatchatchats.local"
    if (Test-Path -LiteralPath $keyPath) {
        $registeredManifest = (Get-Item -LiteralPath $keyPath).GetValue('')
        if ($registeredManifest -ne $manifestPath -and -not $ReplaceExisting) {
            throw "已存在其他目录的 Chatx 安装：$registeredManifest。先卸载旧注册，或明确指定 -ReplaceExisting。"
        }
    }
}
if (-not $ExtensionId) {
    $extensionManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $extensionManifest.key) { throw '扩展 manifest 缺少固定公钥，无法推导 ID。' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = $sha.ComputeHash([Convert]::FromBase64String($extensionManifest.key)) }
    finally { $sha.Dispose() }
    $ExtensionId = -join (0..15 | ForEach-Object { [string][char](97 + ($digest[$_] -shr 4)); [string][char](97 + ($digest[$_] -band 15)) })
}
if ($ExtensionId -cnotmatch '^[a-p]{32}$') { throw '扩展 ID 必须是 32 位 a–p 小写字母。' }
if (-not $Workspace -and $previousConfig.workspace) { $Workspace = $previousConfig.workspace }
if (-not $Workspace) { $Workspace = Join-Path $projectRoot 'local-workspace' }
if (-not $Python -and $previousConfig.python) { $Python = $previousConfig.python }
if (-not $Python) { $Python = (Get-Command python.exe -ErrorAction Stop).Source }
$pythonPath = (Resolve-Path -LiteralPath $Python).Path
if ($pythonPath -like '*WindowsApps*') { throw '请选择实际 Python 3.10+ 的 python.exe，而不是 WindowsApps 占位程序。' }
& $pythonPath -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"'
if ($LASTEXITCODE -ne 0) { throw 'Python 版本检查失败' }
$workspacePath = [IO.Path]::GetFullPath($Workspace)
if ($workspacePath.TrimEnd('\') -eq $projectRoot.TrimEnd('\') -or $workspacePath.StartsWith($runtimePath, [StringComparison]::OrdinalIgnoreCase)) {
    throw '工作目录须与项目源码和 runtime 分开，例如 C:\ChatxWorkspace。'
}
foreach ($taskPath in @($pythonPath,$projectRoot)) {
    if ($taskPath.Contains('%') -or $taskPath.Contains('!')) { throw '安装路径或 Python 路径暂不支持 % 或 ! 字符。' }
}
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
New-Item -ItemType Directory -Path $workspacePath -Force | Out-Null
foreach ($folder in @('inbox','outputs','tasks')) { New-Item -ItemType Directory -Path (Join-Path $workspacePath $folder) -Force | Out-Null }
if (Test-Path -LiteralPath $configPath) { Copy-Item -LiteralPath $configPath -Destination "$configPath.backup" -Force }
@{ workspace=$workspacePath; python=$pythonPath } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$launcherPath = Join-Path $runtimePath 'native-host.cmd'
$hostScript = Join-Path $projectRoot 'host\native_host.py'
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($launcherPath, "@echo off`r`nchcp 65001 >nul`r`n`"$pythonPath`" `"$hostScript`" %*`r`n", $utf8NoBom)
@{
    name='com.chatchatchats.local'
    description='Chatx local executor'
    path=$launcherPath
    type='stdio'
    allowed_origins=@("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4 | ForEach-Object { [IO.File]::WriteAllText($manifestPath, $_, $utf8NoBom) }
foreach ($vendor in @('Google\Chrome','Microsoft\Edge')) {
    $registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.chatchatchats.local"
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $manifestPath
}
Write-Host "已注册当前用户的 Chrome / Edge 本地宿主。"
Write-Host "工作目录：$workspacePath"
Write-Host "扩展 ID：$ExtensionId"
Write-Host '回到 ChatGPT 页面并刷新，点击右下角 Chatx 小框的启用开关。'
