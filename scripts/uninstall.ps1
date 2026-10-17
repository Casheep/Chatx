$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedManifest = Join-Path $projectRoot 'runtime\com.chatchatchats.local.json'
foreach ($vendor in @('Google\Chrome','Microsoft\Edge')) {
    $key = "HKCU:\Software\$vendor\NativeMessagingHosts\com.chatchatchats.local"
    if (Test-Path -LiteralPath $key) {
        $current = (Get-Item -LiteralPath $key).GetValue('')
        if ($current -eq $expectedManifest) { Remove-Item -LiteralPath $key }
        else { Write-Host "跳过其他安装所用的注册项：$key" }
    }
}
Write-Host '本安装的宿主注册已移除。请在浏览器扩展页移除扩展。'
Write-Host '文件、任务记录和模型保留在本地，未删除。正在运行的任务请先在扩展中取消。'
