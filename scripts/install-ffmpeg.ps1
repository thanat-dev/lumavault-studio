$ErrorActionPreference = "Stop"

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Output "FFmpeg is already installed."
  ffmpeg -version | Select-Object -First 1
  exit 0
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget was not found. Please install FFmpeg manually and restart the app."
}

winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements

Write-Output "FFmpeg installation finished. Restart Private Media Downloader before rendering."
