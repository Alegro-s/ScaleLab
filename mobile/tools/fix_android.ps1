$ErrorActionPreference = 'Continue'
$f = Join-Path $PSScriptRoot '..\android\app\build.gradle.kts'
if (Test-Path $f) {
  $t = Get-Content $f -Raw
  $n = [regex]::Replace($t, '(?m)^\s*ndkVersion\s*=.*\r?\n', '')
  if ($n -ne $t) {
    Set-Content -Path $f -Value $n -NoNewline -Encoding UTF8
    Write-Host ' ndkVersion removed from build.gradle.kts'
  }
}
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$root = Join-Path $sdk 'ndk'
$ver = '27.0.12077973'
$dir = Join-Path $root $ver
$tool = Join-Path $dir 'build\cmake\android.toolchain.cmake'
if (Test-Path $root) {
  Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not (Test-Path (Join-Path $_.FullName 'build\cmake\android.toolchain.cmake'))) {
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host (' Removed broken NDK folder: ' + $_.Name)
    }
  }
}
if (Test-Path $tool) { Write-Host ' NDK OK'; exit 0 }
New-Item -ItemType Directory -Force -Path $root | Out-Null
$zip = Join-Path $env:TEMP 'android-ndk-r27-windows.zip'
$urls = @(
  'https://dl.google.com/android/repository/android-ndk-r27-windows.zip',
  'https://dl-ssl.google.com/android/repository/android-ndk-r27-windows.zip',
  'https://mirrors.cloud.tencent.com/AndroidSDK/android-ndk-r27-windows.zip',
  'https://mirrors.aliyun.com/android.googlesource.com/android-ndk-r27-windows.zip'
)
function Test-Zip($p) {
  if (-not (Test-Path $p)) { return $false }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [System.IO.Compression.ZipFile]::OpenRead($p)
    $c = $z.Entries.Count
    $z.Dispose()
    return ($c -gt 1000)
  } catch { return $false }
}
$ok = Test-Zip $zip
if (-not $ok) {
  foreach ($u in $urls) {
    Write-Host (' Downloading NDK from ' + $u + ' (about 700 MB, may take a while)')
    & curl.exe -L --fail --retry 30 --retry-all-errors --retry-delay 3 -C - --connect-timeout 20 -o $zip $u
    if (Test-Zip $zip) { $ok = $true; break }
    Write-Host ' Download failed or file is not a valid zip, trying next source'
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
  }
}
if (-not $ok) {
  Write-Host ''
  Write-Host ' Could not download the NDK. Download android-ndk-r27-windows.zip manually'
  Write-Host (' (VPN or other network) and save it as: ' + $zip)
  Write-Host ' then run build.bat again.'
  exit 1
}
Write-Host ' Extracting NDK...'
$tmp = Join-Path $env:TEMP 'ndk_extract'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
& tar.exe -xf $zip -C $tmp
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (-not $inner) { Write-Host ' Extraction failed'; exit 1 }
Move-Item $inner.FullName $dir -Force
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
$sp = Join-Path $dir 'source.properties'
if (-not (Test-Path $sp)) { Set-Content -Path $sp -Value ("Pkg.Desc = Android NDK`r`nPkg.Revision = " + $ver) -Encoding ASCII }
if (Test-Path $tool) { Write-Host ' NDK installed'; Remove-Item $zip -Force -ErrorAction SilentlyContinue; exit 0 }
Write-Host ' NDK folder is incomplete'
exit 1
