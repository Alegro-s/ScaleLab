$roots = @(
  "$env:USERPROFILE\.jdks", "$env:USERPROFILE\.gradle\jdks", "$env:USERPROFILE\.sdkman\candidates\java",
  "$env:ProgramFiles\Android\Android Studio", "$env:ProgramFiles\Android\Android Studio Preview",
  "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft",
  "$env:ProgramFiles\Zulu", "$env:ProgramFiles\BellSoft", "$env:ProgramFiles\Amazon Corretto",
  "$env:ProgramFiles\JetBrains", "$env:LOCALAPPDATA\Programs\Eclipse Adoptium", "$env:LOCALAPPDATA\Android\Sdk\jbr",
  "C:\Java", "C:\jdk", "D:\Java", "D:\jdk"
)
$found = @()
foreach ($r in $roots) {
  if (-not (Test-Path $r)) { continue }
  $cands = @(Get-Item $r) + @(Get-ChildItem $r -Directory -ErrorAction SilentlyContinue) + @(Get-ChildItem $r -Directory -ErrorAction SilentlyContinue | ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue })
  foreach ($c in $cands) {
    $java = Join-Path $c.FullName 'bin\java.exe'
    $rel = Join-Path $c.FullName 'release'
    if (-not (Test-Path $java)) { continue }
    $major = 0
    if (Test-Path $rel) {
      $line = Select-String -Path $rel -Pattern 'JAVA_VERSION="?([0-9]+)' | Select-Object -First 1
      if ($line) { $major = [int]$line.Matches[0].Groups[1].Value }
    }
    if ($major -ge 17 -and $major -le 24) { $found += [pscustomobject]@{ Path = $c.FullName; Major = $major; Pref = if ($major -eq 21) { 0 } elseif ($major -eq 17) { 1 } else { 2 } } }
  }
}
if ($found.Count -gt 0) { ($found | Sort-Object Pref, @{Expression='Major';Descending=$true} | Select-Object -First 1).Path }
