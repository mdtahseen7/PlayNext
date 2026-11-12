# Builds the Chrome Web Store upload package.
# Only runtime files are included. The manifest must sit at the root of the zip.
#
#   .\tools\package.ps1
#
# Output: dist\PlayNext-<version>.zip
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$manifest = Get-Content manifest.json -Raw | ConvertFrom-Json
$version = $manifest.version
$stage = Join-Path $root "dist\stage-$version"
$zip = Join-Path $root "dist\PlayNext-$version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Runtime files only. Keep this list in sync with the layout in README.md.
$files = @(
  'manifest.json',
  'background.js',
  'block-popups.js',
  'content.js',
  'content.css',
  'downloader.html',
  'downloader.js',
  'player.html',
  'player.js',
  'stream-link.js',
  'sub-settings-bridge.js',
  'subs-panel.js',
  'subtitle-fallback.js',
  'LICENSE',
  'PRIVACY.md'
)
$dirs = @('popup', 'icons')

foreach ($f in $files) {
  if (Test-Path $f) { Copy-Item $f -Destination $stage } else { Write-Warning "missing: $f" }
}
foreach ($d in $dirs) {
  if (Test-Path $d) { Copy-Item $d -Destination $stage -Recurse } else { Write-Warning "missing: $d" }
}

# The icon set is referenced by the manifest, the store listing and the popup.
foreach ($icon in @('icon16.png', 'icon48.png', 'icon128.png', 'logo.png')) {
  $src = Join-Path $root "icons\$icon"
  if (-not (Test-Path (Join-Path $stage "icons\$icon"))) { Copy-Item $src -Destination (Join-Path $stage 'icons') }
}

if (Test-Path $zip) { Remove-Item $zip -Force }

# Build the archive by hand so every entry uses forward slashes. Compress-Archive
# writes Windows separators, which the Chrome Web Store parser does not like.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $fs = [System.IO.File]::OpenRead($_.FullName)
    $fs.CopyTo($es)
    $fs.Dispose()
    $es.Dispose()
  }
} finally {
  $archive.Dispose()
}

Write-Output ""
Write-Output "Packaged PlayNext $version"
Write-Output "  $zip"
Write-Output "  $((Get-Item $zip).Length) bytes"
Write-Output ""
Write-Output "Upload this zip at https://chrome.google.com/webstore/devconsole"
Remove-Item $stage -Recurse -Force
