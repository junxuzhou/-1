<#
Download required vendor JS/CSS files into vendor/ for offline use.

运行 (PowerShell):
  powershell -ExecutionPolicy Bypass -File g:\era5_web_viz\download_vendors.ps1

如果你的网络环境允许，这个脚本会从官方 CDN 下载必要文件并保存到 `g:\era5_web_viz\vendor\`。
#>
Set-StrictMode -Version Latest
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$vendor = Join-Path $scriptDir 'vendor'
If (-not (Test-Path $vendor)) { New-Item -ItemType Directory -Path $vendor | Out-Null }

# Candidate URLs for netcdfjs — try them in order until one succeeds
$netcdfCandidates = @(
  'https://unpkg.com/netcdfjs/dist/netcdfjs.min.js',
  'https://cdn.jsdelivr.net/npm/netcdfjs/dist/netcdfjs.min.js',
  'https://raw.githubusercontent.com/cheminfo/netcdfjs/master/dist/netcdfjs.min.js'
)

$files = @(
  @{id='netcdfjs'; url=$null; out='netcdfjs.min.js'},
  @{id='d3'; url='https://d3js.org/d3.v7.min.js'; out='d3.v7.min.js'},
  @{id='d3contour'; url='https://d3js.org/d3-contour.v2.min.js'; out='d3-contour.v2.min.js'},
  @{id='leafletjs'; url='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; out='leaflet.js'},
  @{id='leafletcss'; url='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; out='leaflet.css'},
  @{id='proj4'; url='https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.8.1/proj4.js'; out='proj4.js'},
  @{id='proj4leaflet'; url='https://unpkg.com/proj4leaflet@1.0.2/src/proj4leaflet.js'; out='proj4leaflet.js'}
)

function Download-FileWithCheck {
  param(
    [string]$Url,
    [string]$OutPath
  )
  Write-Host "Downloading $Url -> $OutPath"
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutPath -UseBasicParsing -ErrorAction Stop
    if (Test-Path $OutPath) {
      Write-Host "Saved: $OutPath"
      return $true
    }
  } catch {
    Write-Warning "Failed to download $Url : $_"
  }
  return $false
}

foreach ($f in $files) {
  $out = Join-Path $vendor $f.out
  if ($f.id -eq 'netcdfjs') {
    $ok = $false
    foreach ($cand in $netcdfCandidates) {
      if (Download-FileWithCheck -Url $cand -OutPath $out) { $ok = $true; break }
    }
    if (-not $ok) {
      Write-Warning "All netcdfjs candidates failed. Please download manually and save as: $out"
      Write-Host "Manual fallback URLs to try in a browser or via Invoke-WebRequest:"
      foreach ($u in $netcdfCandidates) { Write-Host " - $u" }
    }
  } else {
    if (-not (Download-FileWithCheck -Url $f.url -OutPath $out)) {
      Write-Warning "Failed to download $($f.url). You can try manually: Invoke-WebRequest -Uri <url> -OutFile <path>"
    }
  }
}

Write-Host "Done. If downloads succeeded, open g:\era5_web_viz\index.html in browser and it will load local vendor files." 
