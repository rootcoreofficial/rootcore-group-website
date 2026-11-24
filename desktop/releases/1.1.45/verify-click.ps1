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
$feed = Start-Process python -ArgumentList "-m http.server 28371 --bind 127.0.0.1 --directory `"$PSScriptRoot`"" -PassThru
$env:PERRY_UPDATE_URL = 'http://127.0.0.1:28371'
$log = Join-Path $env:APPDATA 'perry/perry-startup.log'
$old = Start-Process $app -ArgumentList '--remote-debugging-port=28372' -PassThru
try {
  $deadline = (Get-Date).AddSeconds(70)
  $target = $null
  do {
    try {
      $target = Invoke-RestMethod 'http://127.0.0.1:28372/json/list' -TimeoutSec 2 |
        Where-Object { $_.url -like '*updater-window.html' } | Select-Object -First 1
    } catch { }
    if (!$target) { Start-Sleep -Seconds 1 }
  } until ($target -or (Get-Date) -gt $deadline)
  if (!$target) { throw 'Pagina del pulsante assente dal browser di prova' }
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  try {
    $token = [Threading.CancellationToken]::None
    $socket.ConnectAsync([uri]$target.webSocketDebuggerUrl,$token).GetAwaiter().GetResult()
    $command = [Text.Encoding]::UTF8.GetBytes('{"id":1,"method":"Runtime.evaluate","params":{"expression":"new Promise(resolve => { const timer = setInterval(() => { const button = document.querySelector(\\"#primary\\"); if (button && button.textContent.includes(\\"Riavvia\\") && !button.hidden && !button.disabled && button.getBoundingClientRect().width > 0) { clearInterval(timer); button.click(); resolve(true); } }, 150); })","awaitPromise":true}}'.Replace('\\"','\"'))
    $socket.SendAsync([ArraySegment[byte]]::new($command),[Net.WebSockets.WebSocketMessageType]::Text,$true,$token).GetAwaiter().GetResult()
    Write-Host 'Richiesto il clic sul pulsante effettivo del renderer.'
    Start-Sleep -Seconds 2
  } finally {
    $socket.Dispose()
  }
  if (!$old.WaitForExit(30000)) { throw 'Il pulsante non ha chiuso PERRY' }
  $deadline = (Get-Date).AddSeconds(75)
  do {
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'Update for version 1\.1\.45 is not available' -Quiet)) {
      if ((Get-FileHash $app).Hash -ine '6c69b89a5f7e53a9448613d9297eea86d98d5fa0be18a07735bb93ad1b84008b') { throw 'Eseguibile invariato' }
      Write-Host 'Il pulsante ha installato la 1.1.45 e riaperto PERRY.'
      exit 0
    }
    Start-Sleep -Seconds 1
  } until ((Get-Date) -gt $deadline)
  throw 'Nessun riavvio con la 1.1.45'
} finally {
  if (Test-Path $log) {
    Select-String -Path $log -Pattern 'updater:' | ForEach-Object {
      if ($_.Line -match 'updater:.*(available|disponibile|pronto|Install|error|errore|fallito|download)' -and $_.Line -notmatch 'Executing') { $_.Line }
    }
  }
  if (!$feed.HasExited) { Stop-Process -Id $feed.Id -Force }
  Get-Process PERRY -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app } | Stop-Process -Force
}
