param([ValidateSet('1.1.44','1.1.45')][string]$Base='1.1.44')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$work = Join-Path $env:RUNNER_TEMP 'perry145-click'
$null = New-Item $work -ItemType Directory -Force
$previous = Join-Path $work 'stock.exe'
Invoke-WebRequest 'https://github.com/rootcoreofficial/rootcore-group-website/releases/download/v1.1.44/PERRY-Setup-1.1.44.exe' -OutFile $previous
if ((Get-FileHash $previous).Hash -ine '0d1e1e095604ab29a946849efd9e82a6a1cc5ffe0143e4755590f1ee68e0b91f') { throw 'Base 1.1.44 inattesa' }
$p = Start-Process $previous -ArgumentList '/S' -PassThru
if (!$p.WaitForExit(120000) -or $p.ExitCode -ne 0) { throw 'Installazione della base fallita' }
$deadline = (Get-Date).AddSeconds(90)
do {
  $reg = Get-ItemProperty 'HKCU:/Software/797b3738-c027-55e0-801e-efcde42fbb67' -Name InstallLocation -ErrorAction SilentlyContinue
  if ($reg -and (Test-Path (Join-Path $reg.InstallLocation 'resources/server/perry-server.exe'))) { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
if (!$reg) { throw 'Registrazione installazione mancante' }
$app = Join-Path $reg.InstallLocation 'PERRY.exe'
if ($Base -eq '1.1.45') {
  $priorUpdate = Join-Path $work 'update145.exe'
  Invoke-WebRequest 'https://github.com/rootcoreofficial/rootcore-group-website/releases/download/v1.1.45/PERRY-Update-1.1.45.exe' -OutFile $priorUpdate
  if ((Get-FileHash $priorUpdate).Hash -ine '76c8fbfbf2b46efb7ef14f136f3a28f64590eae46ede77bd4e5369e07c6fd949') { throw 'Pacchetto 1.1.45 inatteso' }
  $p=Start-Process $priorUpdate -ArgumentList '--updated /S' -PassThru
  if (!$p.WaitForExit(60000) -or $p.ExitCode -ne 0) { throw 'Preparazione 1.1.45 fallita' }
}
$backend = Join-Path $reg.InstallLocation 'resources/server/perry-server.exe'
$backendHash = (Get-FileHash $backend).Hash
$feed = Start-Process python -ArgumentList "-m http.server 28371 --bind 127.0.0.1 --directory `"$PSScriptRoot`"" -PassThru
$env:PERRY_UPDATE_URL = 'http://127.0.0.1:28371'
$log = Join-Path $env:APPDATA 'perry/perry-startup.log'
$old = Start-Process $app -ArgumentList '--disable-gpu' -PassThru
try {
  $deadline = (Get-Date).AddSeconds(90)
  do {
    $ready = (Test-Path $log) -and (Select-String -Path $log -Pattern 'updater: pronto 1\.1\.46' -Quiet)
    if (!$ready) { Start-Sleep -Seconds 1 }
  } until ($ready -or (Get-Date) -gt $deadline)
  if (!$ready) { throw 'Download della 1.1.46 assente' }
  $candidate = Join-Path $PSScriptRoot 'PERRY-Update-1.1.46.exe'
  $cache = Get-ChildItem "$env:LOCALAPPDATA/perry-updater/pending/*.exe" -File |
    Where-Object { (Get-FileHash $_.FullName).Hash -eq (Get-FileHash $candidate).Hash } | Select-Object -First 1
  if (!$cache) { throw 'Pacchetto scaricato assente o diverso dal candidato' }
  if (!$old.HasExited) { & taskkill /PID $old.Id /T /F | Out-Null }
  $old.WaitForExit(10000) | Out-Null
  $installer = Start-Process $cache.FullName -ArgumentList '--updated /S --force-run' -PassThru
  if (!$installer.WaitForExit(120000) -or $installer.ExitCode -ne 0) {
    $status = Join-Path $env:LOCALAPPDATA 'perry-updater/install-status.log'
    if (Test-Path $status) { Write-Host ((Get-Content $status -Raw) -replace '(?i)[a-z]:.*\\(?=[^\\]*:)', '') }
    throw 'Installazione della correzione fallita'
  }
  $deadline = (Get-Date).AddSeconds(75)
  do {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'Update for version 1\.1\.46 is not available' -Quiet)) {
      if ((Get-FileHash $app).Hash -ine '5d8bb9249672eb11958e30ad86cae1acda9cae2d9765f645ea66c4da1036e984') { throw 'Eseguibile invariato' }
      if ((Get-FileHash $backend).Hash -ine $backendHash) { throw 'Server locale modificato' }
      $index = Get-Content (Join-Path $reg.InstallLocation 'resources/dist/index.html') -Raw
      if (!$index.Contains('app.riprendi.6a3f175fb23a771d.js')) { throw 'Il renderer non e stato aggiornato' }
      Write-Host 'Il pacchetto scaricato ha installato la 1.1.46 e riaperto PERRY.'
      exit 0
    }
    Start-Sleep -Seconds 1
  } until ((Get-Date) -gt $deadline)
  $status = Join-Path $env:LOCALAPPDATA 'perry-updater/install-status.log'
  if (Test-Path $status) { (Get-Content $status -Raw) -replace '(?i)[a-z]:[^:]+\\(?=[^\\]*:)', '<path>\' | Write-Host }
  throw 'Nessun riavvio con la 1.1.46'
} finally {
  if (Test-Path $log) {
    Select-String -Path $log -Pattern 'updater:' | ForEach-Object {
      if ($_.Line -match 'updater:.*(available|disponibile|pronto|Install|error|errore|fallito|download)' -and $_.Line -notmatch 'Executing') { $_.Line }
    }
  }
  if (!$feed.HasExited) { Stop-Process -Id $feed.Id -Force }
  Get-Process PERRY -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app } | Stop-Process -Force
}
