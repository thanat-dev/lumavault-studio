$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Assets = Join-Path $Root "assets"
$IconPath = Join-Path $Assets "private-media-downloader.ico"
$LaunchPath = Join-Path $Root "launch.ps1"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Private Media Downloader.lnk"

New-Item -ItemType Directory -Force -Path $Assets | Out-Null

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class NativeMethods {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
"@

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(22, 107, 85))

$cream = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(246, 250, 248))
$orange = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(195, 107, 45))
$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(21, 32, 29))

$graphics.FillEllipse($cream, 46, 34, 164, 164)
$graphics.FillRectangle($orange, 112, 62, 32, 80)

$points = @(
  [System.Drawing.Point]::new(84, 124),
  [System.Drawing.Point]::new(172, 124),
  [System.Drawing.Point]::new(128, 174)
)
$graphics.FillPolygon($orange, $points)
$graphics.FillRectangle($dark, 78, 190, 100, 18)

$font = New-Object System.Drawing.Font "Segoe UI", 26, ([System.Drawing.FontStyle]::Bold)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString("PM", $font, $cream, ([System.Drawing.RectangleF]::new(0, 205, 256, 38)), $format)

$handle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($handle)
$stream = [System.IO.File]::Create($IconPath)
$icon.Save($stream)
$stream.Close()

$icon.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
[NativeMethods]::DestroyIcon($handle) | Out-Null

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LaunchPath`""
$shortcut.WorkingDirectory = $Root
$shortcut.IconLocation = $IconPath
$shortcut.Description = "Open Private Media Downloader"
$shortcut.Save()

Write-Output $ShortcutPath
