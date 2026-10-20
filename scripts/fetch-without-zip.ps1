# Fetches every file of this repository one by one over raw.githubusercontent.com,
# for machines where "Download ZIP" is blocked but single files open in the browser.
# Usage (PowerShell):  .\fetch-without-zip.ps1  [-Branch main] [-Dest .\ms-cs-ttia-office-hours]
param([string]$Branch = "main", [string]$Dest = ".\ms-cs-ttia-office-hours")
$base = "https://raw.githubusercontent.com/intelliorion/ms-cs-ttia-office-hours/$Branch/"
$list = (Invoke-WebRequest -UseBasicParsing "$base/MANIFEST.txt").Content -split "`n" | Where-Object { $_.Trim() -ne "" }
$i = 0
foreach ($path in $list) {
  $i++; $target = Join-Path $Dest $path
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  Write-Host ("[{0}/{1}] {2}" -f $i, $list.Count, $path)
  Invoke-WebRequest -UseBasicParsing ($base + ($path -split "/" | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/") -OutFile $target
}
Write-Host "Done: $($list.Count) files in $Dest. Next: cd $Dest\cafe-app; npm install; npm run cafe -- start --workspace ~\cafe-workspace"
