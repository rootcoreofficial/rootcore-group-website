$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$stage = Join-Path $env:RUNNER_TEMP 'perry-legacy'
$null = New-Item $stage -ItemType Directory -Force
$old = Join-Path $stage 'setup-old.exe'
Invoke-WebRequest 'https://github.com/rootcoreofficial/rootcore-group-website/releases/download/v1.1.43/PERRY-Setup-1.1.43.exe' -OutFile $old
if ((Get-FileHash $old).Hash -ine 'f92e4f232541c1c293c1e0a52bcb8a14b2f7df843ff6ce37c1fa66b3648e7252') { throw 'Base 1.1.43 inattesa' }
$installer = Start-Process $old -ArgumentList '/S' -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw 'Installazione di prova della 1.1.43 fallita' }
$deadline = (Get-Date).AddSeconds(120)
$regPath = 'HKCU:/Software/797b3738-c027-55e0-801e-efcde42fbb67'
$unPath = 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Uninstall/797b3738-c027-55e0-801e-efcde42fbb67'
do {
  $reg = Get-ItemProperty $regPath -Name InstallLocation -ErrorAction SilentlyContinue
  $un = Get-ItemProperty $unPath -Name DisplayVersion -ErrorAction SilentlyContinue
  if ($reg -and $un -and $un.DisplayVersion -eq '1.1.43' -and (Test-Path (Join-Path $reg.InstallLocation 'PERRY.exe'))) { break }
  Start-Sleep 1
} while ((Get-Date) -lt $deadline)
if (!$reg -or !$un -or $un.DisplayVersion -ne '1.1.43') { throw 'Registrazione ufficiale 1.1.43 assente' }
$exe = Join-Path $reg.InstallLocation 'PERRY.exe'
$before = (Get-FileHash $exe).Hash
$log = Join-Path $env:APPDATA 'perry/perry-startup.log'
Remove-Item $log -ErrorAction SilentlyContinue
# L'updater storico sceglie la sua base. Il test si arresta prima di installarla.
$bridge = Start-Process (Join-Path $PSScriptRoot 'PERRY-Update-1.1.45.exe') -ArgumentList '--updated /S' -PassThru
if (!$bridge.WaitForExit(60000) -or $bridge.ExitCode -ne 0) { throw 'Passaggio al canale 1.1.44 fallito' }
$deadline = (Get-Date).AddSeconds(90)
try {
  do {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'updater: disponibile 1\.1\.44|Found version 1\.1\.44' -Quiet)) {
      if ((Get-FileHash $exe).Hash -ine $before) { throw 'Modifica imprevista della vecchia shell' }
      Write-Host 'La 1.1.43 ha selezionato il passaggio intermedio alla 1.1.44.'
      return
    }
    Start-Sleep 1
  } while ((Get-Date) -lt $deadline)
  throw 'Il client storico non ha segnalato la base 1.1.44'
} finally {
  Get-Process PERRY -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
}
