# Arranque rapido del backend en desarrollo (SWC + node --watch).
# Uso:  .\dev.ps1          (usa el puerto de .env, por defecto 3000)
#       .\dev.ps1 -Port 3005
param(
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if ($Port -eq 0) {
    $envFile = if (Test-Path (Join-Path $PSScriptRoot '.env.development')) {
        Join-Path $PSScriptRoot '.env.development'
    } else {
        Join-Path $PSScriptRoot '.env'
    }
    if (Test-Path $envFile) {
        $match = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' |
            Select-Object -Last 1
        if ($match) { $Port = [int]$match.Matches[0].Groups[1].Value }
    }
    if ($Port -eq 0) { $Port = 3000 }
}

# 1. Liberar el puerto si quedo un proceso huerfano (solo mata procesos node).
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $listeners) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -eq 'node') {
        Write-Host "Liberando puerto ${Port}: matando proceso node huerfano PID $($proc.Id)" -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force
    } else {
        Write-Host "Puerto ${Port} ocupado por '$($proc.ProcessName)' (PID $($proc.Id)): no es node, no se mata." -ForegroundColor Red
        exit 1
    }
}

$swcCli   = Join-Path $PSScriptRoot 'node_modules\@swc\cli\bin\swc.js'
$srcDir   = Join-Path $PSScriptRoot 'src'
$distDir  = Join-Path $PSScriptRoot 'dist'
# El CLI de swc preserva el nombre del directorio de entrada => el bundle queda en dist/src/.
$entry    = Join-Path $distDir 'src\main.js'

# 2. Compilacion inicial (~0.3s con SWC): se limpia dist para evitar archivos obsoletos mezclados.
Write-Host "Compilando con SWC..." -ForegroundColor Cyan
if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
& node $swcCli $srcDir -d $distDir
if ($LASTEXITCODE -ne 0) { Write-Host 'Error compilando con SWC.' -ForegroundColor Red; exit 1 }

# 3. Watcher de SWC en segundo plano, compartiendo esta consola (logs en vivo).
$swcArgs = @($swcCli, $srcDir, '-d', $distDir, '-w')
$swcProc = Start-Process node -ArgumentList $swcArgs -NoNewWindow -PassThru

$wifiIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "*Wi-Fi*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress -First 1)
if (-not $wifiIp) {
    $wifiIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.InterfaceAlias -notlike "*vEthernet*" } | Select-Object -ExpandProperty IPAddress -First 1)
}

Write-Host ""
Write-Host "Backend en modo watch:" -ForegroundColor Green
Write-Host "  - Local:   http://localhost:${Port}" -ForegroundColor Cyan
if ($wifiIp) {
    Write-Host "  - Network: http://${wifiIp}:${Port}" -ForegroundColor Cyan
}
Write-Host "Logs en vivo abajo. Deten todo con Ctrl+C." -ForegroundColor Green
Write-Host ""

# 4. Servidor en primer plano con recarga automatica cuando SWC reescribe dist/src/.
try {
    $env:NODE_ENV = 'development'
    & node --enable-source-maps --watch $entry
}
finally {
    if ($swcProc -and -not $swcProc.HasExited) {
        Stop-Process -Id $swcProc.Id -Force -ErrorAction SilentlyContinue
    }
}
