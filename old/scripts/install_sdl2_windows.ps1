[CmdletBinding()]
param(
  [string]$Version = '2.30.9',
  [string]$Architecture = 'win32-x64',
  [string]$InstallRoot = 'vendor/sdl2/windows-x64'
)

$ErrorActionPreference = 'Stop'

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [System.Runtime.InteropServices.OSPlatform]::Windows
)) {
  throw 'install_sdl2_windows.ps1 currently supports Windows only.'
}

if ($Architecture -ne 'win32-x64') {
  throw "Unsupported SDL2 Windows architecture '$Architecture'. Expected 'win32-x64'."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$installPath = Join-Path $repoRoot $InstallRoot
$downloadPath = Join-Path $installPath 'downloads'
$archiveName = "SDL2-$Version-$Architecture.zip"
$archivePath = Join-Path $downloadPath $archiveName
$extractPath = Join-Path $installPath "SDL2-$Version"
$dllTargetPath = Join-Path $installPath 'SDL2.dll'
$url = "https://libsdl.org/release/$archiveName"

New-Item -ItemType Directory -Force -Path $installPath | Out-Null
New-Item -ItemType Directory -Force -Path $downloadPath | Out-Null

if (-not (Test-Path $archivePath)) {
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $archivePath
} else {
  Write-Host "Using cached archive $archivePath"
}

if ((Test-Path $dllTargetPath) -and -not (Test-Path $extractPath)) {
  Write-Host "Using existing SDL2 runtime at $dllTargetPath"
} elseif (-not (Test-Path $extractPath)) {
  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null
  Write-Host "Extracting $archiveName"
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
} else {
  Write-Host "Using extracted directory $extractPath"
}

if (Test-Path $extractPath) {
  Write-Host "Using extracted directory $extractPath"
} else {
  Write-Host "Using extracted contents in $installPath"
}

$dllCandidate = Get-ChildItem -LiteralPath $installPath -Recurse -Filter 'SDL2.dll' -File |
  Where-Object { $_.FullName -ne $dllTargetPath } |
  Select-Object -First 1

if (-not $dllCandidate -and (Test-Path $dllTargetPath)) {
  $dllCandidate = Get-Item -LiteralPath $dllTargetPath
}

if (-not $dllCandidate) {
  throw "SDL2 runtime DLL was not found under $installPath"
}

if ($dllCandidate.FullName -ne $dllTargetPath) {
  Copy-Item -LiteralPath $dllCandidate.FullName -Destination $dllTargetPath -Force
}

$envFilePath = Join-Path $installPath 'env.ps1'
@(
  "`$env:DENO_SDL2_PATH = '$installPath'"
  "Write-Host 'DENO_SDL2_PATH set to $installPath'"
) | Set-Content -LiteralPath $envFilePath -Encoding ascii

Write-Host ''
Write-Host "Installed SDL2 $Version to $installPath"
Write-Host "DLL path: $dllTargetPath"
Write-Host "To use it in the current shell:"
Write-Host "  `$env:DENO_SDL2_PATH = '$installPath'"
Write-Host "Or source:"
Write-Host "  . '$envFilePath'"
