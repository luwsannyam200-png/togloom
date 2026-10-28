param(
  [string]$Src = (Join-Path $PSScriptRoot 'tsainy-tsag.html'),
  [string]$Out = (Split-Path $PSScriptRoot -Parent)
)
# Builds the GitHub Pages site (the folder above src\) from the artifact master src\tsainy-tsag.html
# (single file, no <head>). Prints which files changed = which files to re-upload on GitHub.
# Paths are relative to this script, so the repo works from any folder (e.g. a downloaded ZIP).
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$t = [IO.File]::ReadAllText($Src, [Text.Encoding]::UTF8)

$links = ([regex]::Matches($t, '<link [^>]+>') | ForEach-Object { $_.Value }) -join "`n"
$css = [regex]::Match($t, '<style>([\s\S]*?)</style>').Groups[1].Value.Trim()
$js = [regex]::Match($t, '<script>([\s\S]*)</script>').Groups[1].Value.Trim()
$from = $t.IndexOf('</style>') + 8; $to = $t.IndexOf('<script>')
if (-not $css -or -not $js -or $to -le $from) { throw 'master layout not recognised (<style> … markup … <script>)' }
$markup = $t.Substring($from, $to - $from).Trim()

$icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23E8780A'/%3E%3Ctext x='32' y='45' font-size='36' text-anchor='middle' font-family='Arial' font-weight='700' fill='%2317202B'%3E%D0%A6%3C/text%3E%3C/svg%3E"
$desc = 'Завсарлагын богино тоглоомууд: Болжмор, Карьерын зам, Таавар 3×3, Мэдлэгийн сорил, Шатар.'

# file -> start game (data-start), page title
$pages = [ordered]@{
  'index.html'    = @('',       'Цайны цаг')
  'bolzhmor.html' = @('flappy', 'Болжмор · Цайны цаг')
  'karier.html'   = @('race',   'Карьерын зам · Цайны цаг')
  'taavar.html'   = @('puzzle', 'Таавар 3×3 · Цайны цаг')
  'soril.html'    = @('quiz',   'Мэдлэгийн сорил · Цайны цаг')
  'shatar.html'   = @('chess',  'Шатар · Цайны цаг')
}

$files = [ordered]@{ 'app.css' = $css + "`n"; 'app.js' = $js + "`n" }
foreach ($name in $pages.Keys) {
  $start, $title = $pages[$name]
  $bodyAttr = if ($start) { " data-start=""$start""" } else { '' }
  $files[$name] = @"
<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>$title</title>
<meta name="description" content="$desc">
<link rel="icon" href="$icon">
$links
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<link rel="stylesheet" href="app.css">
</head>
<body$bodyAttr>
$markup
<script src="firebase-config.js"></script>
<script src="app.js"></script>
</body>
</html>
"@
}

New-Item -ItemType Directory -Force $Out | Out-Null
$changed = @()
# stand-alone pages copied as they are (the 3D shooter loads three.js and Firebase itself)
foreach ($page in @('buudlaga.html')) {
  $files[$page] = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $page), [Text.Encoding]::UTF8)
}
# Firebase web config is hand-edited (pasted from the Firebase console); only create the empty stub
$cfg = Join-Path $Out 'firebase-config.js'
if (-not (Test-Path -LiteralPath $cfg)) {
  [IO.File]::WriteAllText($cfg, "// Firebase web config (Project settings -> Your apps -> Web). null = no server: solo play only.`nwindow.FIREBASE_CONFIG = null;`n", $utf8)
  $changed += 'firebase-config.js'
}
foreach ($name in $files.Keys) {
  $path = Join-Path $Out $name
  $new = $files[$name] -replace "`r`n", "`n"
  $old = if (Test-Path -LiteralPath $path) { [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) } else { $null }
  if ($old -ne $new) { [IO.File]::WriteAllText($path, $new, $utf8); $changed += $name }
}
"Хавтас: $Out"
Get-ChildItem -LiteralPath $Out -File | Sort-Object Name | ForEach-Object { "  {0,-14} {1,7:N1} KB" -f $_.Name, ($_.Length / 1KB) }
if ($changed) { "GitHub руу дахин upload хийх: " + ($changed -join ', ') } else { 'Өөрчлөлт алга — upload хийх шаардлагагүй.' }
