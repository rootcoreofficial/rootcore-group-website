$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$dir = Join-Path $env:RUNNER_TEMP 'perry145-acceptance'
$null = New-Item $dir -ItemType Directory -Force
$previous = Join-Path $dir '1.1.44.exe'
$install = Join-Path $dir 'Installed PERRY'
$profile = Join-Path $dir 'profile'
$null = New-Item $profile -ItemType Directory -Force
$update = Join-Path $PSScriptRoot 'PERRY-Update-1.1.45.exe'
function Hash-Is($file,$value) {
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $value) { throw "Hash diverso per $(Split-Path $file -Leaf)" }
}
function Run-Installer($file, [string]$arguments) {
  $p = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  if (!$p.WaitForExit(120000)) { $p.Kill(); throw 'Timeout installazione' }
  if ($p.ExitCode -ne 0) { throw "Installazione terminata con codice $($p.ExitCode)" }
}
function Await-Log($pattern, $log) {
  $until=(Get-Date).AddSeconds(90)
  while((Get-Date) -lt $until) {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern $pattern -Quiet)) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Evento updater mancante: $pattern"
}
Invoke-WebRequest 'https://github.com/rootcoreofficial/rootcore-group-website/releases/download/v1.1.44/PERRY-Setup-1.1.44.exe' -OutFile $previous
Hash-Is $previous '0d1e1e095604ab29a946849efd9e82a6a1cc5ffe0143e4755590f1ee68e0b91f'
Hash-Is $update '76c8fbfbf2b46efb7ef14f136f3a28f64590eae46ede77bd4e5369e07c6fd949'
Run-Installer $previous "/S /D=$install"
$deadline = (Get-Date).AddSeconds(120)
do {
  $paths = @($install)
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($key in @('Software/797b3738-c027-55e0-801e-efcde42fbb67', 'Software/WOW6432Node/797b3738-c027-55e0-801e-efcde42fbb67')) {
      $reg = Get-ItemProperty -LiteralPath "$hive/$key" -Name InstallLocation -ErrorAction SilentlyContinue
      if ($reg -and $reg.InstallLocation) { $paths += $reg.InstallLocation }
    }
  }
  $paths += "$env:LOCALAPPDATA/Programs/perry"
  $found = $paths | Where-Object { Test-Path (Join-Path $_ 'resources/server/perry-server.exe') } | Select-Object -First 1
  if ($found) { $install = $found; break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
if (!$found) { throw 'Installazione della base 1.1.44 non individuata' }
$app = Join-Path $install 'PERRY.exe'
$asar = Join-Path $install 'resources/app.asar'
$backend = Join-Path $install 'resources/server/perry-server.exe'
$initialBackend = (Get-FileHash $backend).Hash
Hash-Is $app '31c94797467dc05a2b7db2fdcc4ae8152624f9f5d00aa1366e9e6166e8061522'
$feed = Start-Process python -ArgumentList "-m http.server 28371 --bind 127.0.0.1 --directory `"$PSScriptRoot`"" -PassThru
try {
  $env:PERRY_UPDATE_URL='http://127.0.0.1:28371'
  $log = Join-Path $profile 'perry-startup.log'
  $old = Start-Process $app -ArgumentList "--user-data-dir=`"$profile`"" -PassThru
  Await-Log 'updater: pronto 1\.1\.45' $log
  # Simula una chiusura forzata dopo il download e prova il file scelto dall'updater.
  $cache = (Get-ChildItem "$env:LOCALAPPDATA/perry-updater*/pending/*.exe" -File | Where-Object { (Get-FileHash $_.FullName).Hash -ieq '76c8fbfbf2b46efb7ef14f136f3a28f64590eae46ede77bd4e5369e07c6fd949' } | Select-Object -First 1)
  if (!$cache) { throw 'Installer assente dalla cache dopo il download' }
  & taskkill /PID $old.Id /T /F | Out-Null
  $old.WaitForExit(10000) | Out-Null
  $restartLog = Join-Path $env:APPDATA 'perry/perry-startup.log'
  Remove-Item $restartLog -ErrorAction SilentlyContinue
  Run-Installer $cache.FullName '--updated /S --force-run'
  Hash-Is $app '6c69b89a5f7e53a9448613d9297eea86d98d5fa0be18a07735bb93ad1b84008b'
  Hash-Is $asar '8d6b02e5e2874661827e3e9589bc26a3b86224f8fa0c4a3f941612c7b3933363'
  Hash-Is (Join-Path $install 'resources/dist/index.html') 'a2c9fc768169e71f1b3b9967da55cf6fb98cd0ad14f1cd2ac286ad76af610073'
  Hash-Is (Join-Path $install 'resources/dist/assets/app.riprendi.69353fad67207567.js') '69353fad672075674fe76fa76ec7bb3fb9ee93c1b1dc0818ef3e4caf09ee0d93'
  Hash-Is $backend $initialBackend
  try {
    Await-Log 'Update for version 1\.1\.45 is not available' $restartLog
  } finally {
    Get-Process PERRY -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app } | Stop-Process -Force
  }
  Run-Installer $update '--updated /S'
  Write-Host '1.1.44 downloads the candidate. 1.1.45 starts, reports current, applies idempotently and preserves the installed backend.'
} finally {
  if (!$feed.HasExited) { Stop-Process -Id $feed.Id -Force }
}
