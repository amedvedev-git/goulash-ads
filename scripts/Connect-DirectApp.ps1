# Saves only the application's configuration. Does not connect a user's cabinet or call any API.
#Requires -Version 7.0
param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]{1,100}$')][string]$ClientId,
      [string]$Directory = (Join-Path $env:LOCALAPPDATA 'Goulash-tech-2\credentials'))
$ErrorActionPreference = 'Stop'
$secret = Read-Host 'Client secret приложения Директа (скрытый ввод)' -AsSecureString
try {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    $secret | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $Directory 'DirectApp.dpapi') -Encoding utf8 -NoNewline
    Set-Content -LiteralPath (Join-Path $Directory 'DirectApp.client-id') -Value $ClientId -Encoding utf8
    Write-Output 'Конфигурация приложения сохранена через DPAPI текущего пользователя. Кабинет подключается через интерфейс.'
} finally { $secret.Dispose() }
