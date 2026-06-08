$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 4173
$Url = "http://localhost:$Port"

function Test-LocalPort {
  param([int]$PortNumber)

  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $PortNumber, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(250)) {
      return $false
    }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-LocalPort -PortNumber $Port)) {
  Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $Root -WindowStyle Hidden

  $ready = $false
  for ($i = 0; $i -lt 40; $i += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-LocalPort -PortNumber $Port) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Private Media Downloader could not start. Please check that Node.js is available.", "Private Media Downloader")
    exit 1
  }
}

Start-Process $Url
