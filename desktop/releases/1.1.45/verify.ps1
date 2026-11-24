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
Hash-Is $update '61f439f51982090c5aeca6085ca94b7e97e2ab5c358297ce9ce3c93f72b39a44'
Run-Installer $previous "/S /D=$install"
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
  $cache = (Get-ChildItem "$env:LOCALAPPDATA/perry-updater*/pending/*.exe" -File | Where-Object { (Get-FileHash $_.FullName).Hash -ieq '61f439f51982090c5aeca6085ca94b7e97e2ab5c358297ce9ce3c93f72b39a44' } | Select-Object -First 1)
  if (!$cache) { throw 'Installer assente dalla cache dopo il download' }
  & taskkill /PID $old.Id /T /F | Out-Null
  $old.WaitForExit(10000) | Out-Null
  Run-Installer $cache.FullName '--updated /S'
  Hash-Is $app '6c69b89a5f7e53a9448613d9297eea86d98d5fa0be18a07735bb93ad1b84008b'
  Hash-Is $asar '8d6b02e5e2874661827e3e9589bc26a3b86224f8fa0c4a3f941612c7b3933363'
  Hash-Is (Join-Path $install 'resources/dist/index.html') 'a2c9fc768169e71f1b3b9967da55cf6fb98cd0ad14f1cd2ac286ad76af610073'
  Hash-Is (Join-Path $install 'resources/dist/assets/app.riprendi.69353fad67207567.js') '69353fad672075674fe76fa76ec7bb3fb9ee93c1b1dc0818ef3e4caf09ee0d93'
  Hash-Is $backend $initialBackend
  Run-Installer $update '--updated /S'
  Remove-Item $log -ErrorAction SilentlyContinue
  $new = Start-Process $app -ArgumentList "--user-data-dir=`"$profile`"" -PassThru
  try { Await-Log 'updater: (nessun aggiornamento|nessun update|gia aggiornato)|Update for version 1\.1\.45 is not available' $log }
  finally { if (!$new.HasExited) { & taskkill /PID $new.Id /T /F | Out-Null } }
  Write-Host '1.1.44 downloads the candidate. 1.1.45 starts, reports current, applies idempotently and preserves the installed backend.'
} finally {
  if (!$feed.HasExited) { Stop-Process -Id $feed.Id -Force }
}
