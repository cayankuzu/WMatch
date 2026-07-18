param(
  [string]$PackageName = $null,
  [switch]$Raw,
  [switch]$AllDeviceLogs
)

$ErrorActionPreference = 'Stop'

$adbCommand = Get-Command adb -ErrorAction SilentlyContinue

if ($adbCommand) {
  $adb = $adbCommand.Source
} else {
  $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
}

if (-not (Test-Path $adb)) {
  throw "adb bulunamadi. Android SDK platform-tools kurulu olmali."
}

$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
$serial = $null

foreach ($line in $devices) {
  $candidate = ($line -split '\s+')[0].Trim()
  if ($candidate) {
    $serial = $candidate
    break
  }
}

if (-not $serial) {
  throw 'Bagli cihaz bulunamadi.'
}

$startTimestamp = & $adb -s $serial shell "date '+%m-%d %H:%M:%S.000'"
$startTimestamp = ($startTimestamp -join ' ').Trim()

function Get-ForegroundPackageName {
  $activityOutput = & $adb -s $serial shell dumpsys activity activities 2>$null
  $activityLine = ($activityOutput | Select-String -Pattern 'mResumedActivity:|topResumedActivity:|ResumedActivity:' | Select-Object -First 1).Line

  if ($activityLine -and $activityLine -match 'u0\s+([A-Za-z0-9_.]+)\/') {
    return $Matches[1]
  }

  $windowOutput = & $adb -s $serial shell dumpsys window 2>$null
  $windowLine = ($windowOutput | Select-String -Pattern 'mCurrentFocus=|mFocusedApp=' | Select-Object -First 1).Line

  if ($windowLine -and $windowLine -match 'u0\s+([A-Za-z0-9_.]+)\/') {
    return $Matches[1]
  }

  return $null
}

function Get-TargetPackageName {
  if ($PackageName) {
    return $PackageName
  }

  return Get-ForegroundPackageName
}

Write-Host "Logcat dinleniyor: $serial" -ForegroundColor Green
Write-Host "Saatli format: MM-DD HH:MM:SS.milisaniye" -ForegroundColor DarkGray
Write-Host "Baslangic zamani: $startTimestamp" -ForegroundColor DarkGray

if ($AllDeviceLogs) {
  Write-Host 'Tum cihaz loglari akitiliyor. Cikmak icin Ctrl+C.' -ForegroundColor Yellow
  & $adb -s $serial logcat -v threadtime '*:V'
  exit
}

function Get-AppPid([string]$TargetPackageName) {
  if (-not $TargetPackageName) {
    return $null
  }

  $pidOutput = & $adb -s $serial shell pidof $TargetPackageName 2>$null
  $pidText = ($pidOutput -join ' ').Trim()

  if (-not $pidText) {
    return $null
  }

  return ($pidText -split '\s+')[0]
}

if ($PackageName) {
  Write-Host "Uygulama loglari bekleniyor: $PackageName" -ForegroundColor Cyan
} else {
  Write-Host 'Uygulama loglari bekleniyor: aktif ekran uygulamasi otomatik algilanacak.' -ForegroundColor Cyan
}
Write-Host 'APK telefonda acilinca loglar burada akacak. Cikmak icin Ctrl+C.' -ForegroundColor DarkGray

$filteredTags = @(
  'ReactNativeJS:V',
  'ReactNative:W',
  'ExpoModulesCore:I',
  'DevLauncher:W',
  'DevMenu:W',
  'com.wmatch.app:W',
  '*:S'
)

while ($true) {
  $targetPackageName = Get-TargetPackageName

  if (-not $targetPackageName) {
    Start-Sleep -Seconds 1
    continue
  }

  $appPid = Get-AppPid $targetPackageName

  while (-not $appPid) {
    Start-Sleep -Seconds 1
    $targetPackageName = Get-TargetPackageName

    if (-not $targetPackageName) {
      continue
    }

    $appPid = Get-AppPid $targetPackageName
  }

  Write-Host "Baglandi: $targetPackageName pid=$appPid" -ForegroundColor Green
  # `threadtime` her satira tarih + saat:dakika:saniye + milisaniye ekler.
  if ($Raw) {
    & $adb -s $serial logcat -v threadtime -T "$startTimestamp" --pid $appPid '*:V'
  } else {
    & $adb -s $serial logcat -v threadtime -T "$startTimestamp" --pid $appPid $filteredTags
  }
  Write-Host 'Uygulama prosesi kapandi veya yeniden basladi. Tekrar bekleniyor...' -ForegroundColor Yellow
}
