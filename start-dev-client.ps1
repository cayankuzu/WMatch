$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$metroPort = 18082
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue

if ($adbCommand) {
  $adb = $adbCommand.Source
} else {
  $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
}

if (-not (Test-Path $adb)) {
  throw "adb bulunamadi. Android SDK platform-tools kurulu olmali."
}

$env:NODE_ENV = 'development'
$env:EXPO_NO_DOTENV = '1'

# Metro only needs variables that are intentionally public. Loading the full
# server-side .env would expose deployment credentials to Expo's dev logs.
$envFile = Join-Path $projectRoot '.env'
$publicEnvironment = @{}
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -notmatch '^\s*([A-Z][A-Z0-9_]+)\s*=\s*(.*)\s*$') {
      continue
    }

    $name = $Matches[1]
    if ($name -notin @(
      'EXPO_PUBLIC_SUPABASE_PROJECT_ID',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_PROJECT_REF',
      'SUPABASE_ANON_KEY'
    )) {
      continue
    }

    $value = $Matches[2].Trim()
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $publicEnvironment[$name] = $value
  }
}

if (-not $publicEnvironment['EXPO_PUBLIC_SUPABASE_PROJECT_ID']) {
  $publicEnvironment['EXPO_PUBLIC_SUPABASE_PROJECT_ID'] = $publicEnvironment['SUPABASE_PROJECT_REF']
}

if (-not $publicEnvironment['EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  $publicEnvironment['EXPO_PUBLIC_SUPABASE_ANON_KEY'] = $publicEnvironment['SUPABASE_ANON_KEY']
}

foreach ($requiredName in @('EXPO_PUBLIC_SUPABASE_PROJECT_ID', 'EXPO_PUBLIC_SUPABASE_ANON_KEY')) {
  $requiredValue = $publicEnvironment[$requiredName]
  if (-not $requiredValue) {
    throw "$requiredName bulunamadi. .env dosyasindaki public Supabase ayarlarini kontrol edin."
  }

  Set-Item -LiteralPath "Env:$requiredName" -Value $requiredValue
}

$devices = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
$serials = @()

foreach ($line in $devices) {
  $serial = ($line -split '\s+')[0].Trim()
  if ($serial) {
    $serials += $serial
  }
}

if ($serials.Count -eq 0) {
  Write-Host 'Bagli cihaz bulunamadi. APK kurulduktan sonra cihazi/emulatoru baglayip scripti tekrar calistir.' -ForegroundColor Yellow
} else {
  foreach ($serial in $serials) {
    & $adb -s $serial reverse "tcp:$metroPort" "tcp:$metroPort" | Out-Null
    Write-Host "adb reverse hazir: $serial -> tcp:$metroPort" -ForegroundColor Green
  }
}

Set-Location $projectRoot
Write-Host "Expo dev server USB icin localhost:$metroPort uzerinde baslatiliyor. Android Bundled gorulunce logcat bu terminale baglanacak." -ForegroundColor Cyan

$expoLogPath = Join-Path $env:TEMP ("wmatch-expo-" + [System.Guid]::NewGuid().ToString('N') + ".log")
New-Item -ItemType File -Path $expoLogPath -Force | Out-Null

$expoArguments = @(
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  "Set-Location -LiteralPath '$projectRoot'; `$env:NODE_ENV='development'; `$env:EXPO_NO_DOTENV='1'; npx expo start --dev-client --clear --host localhost --port $metroPort *> '$expoLogPath'"
)

$expoProcess = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $expoArguments

function Read-ExpoOutput {
  param(
    [string]$Path,
    [ref]$Position
  )

  if (-not (Test-Path $Path)) {
    return @()
  }

  $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $stream.Seek($Position.Value, [System.IO.SeekOrigin]::Begin) | Out-Null
    $reader = New-Object System.IO.StreamReader($stream)
    try {
      $lines = New-Object System.Collections.Generic.List[string]
      while (-not $reader.EndOfStream) {
        $lines.Add($reader.ReadLine())
      }
      $Position.Value = $stream.Position
      return $lines
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$expoPosition = [ref]0L
$androidBundledSeen = $false
$metroReady = $false
$clientOpened = $false
$devClientUrl = "wmatch://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$metroPort"

while (-not $expoProcess.HasExited) {
  foreach ($line in Read-ExpoOutput -Path $expoLogPath -Position $expoPosition) {
    if ($line) {
      Write-Host $line
      if ($line -match '^Waiting on http://') {
        $metroReady = $true
      }
      if ($line -match '^Android Bundled\b') {
        $androidBundledSeen = $true
      }
    }
  }

  if ($metroReady -and -not $clientOpened -and $serials.Count -gt 0) {
    foreach ($serial in $serials) {
      & $adb -s $serial shell am start -a android.intent.action.VIEW -d $devClientUrl com.wmatch.app | Out-Null
      Write-Host "Dev Client USB Metro ile acildi: $serial" -ForegroundColor Green
    }
    $clientOpened = $true
  }

  if ($androidBundledSeen) {
    break
  }

  Start-Sleep -Milliseconds 500
}

if (-not $androidBundledSeen) {
  foreach ($line in Read-ExpoOutput -Path $expoLogPath -Position $expoPosition) {
    if ($line) {
      Write-Host $line
      if ($line -match '^Android Bundled\b') {
        $androidBundledSeen = $true
      }
    }
  }
}

if ($androidBundledSeen) {
  Write-Host 'Android Bundled tamamlandi. Uygulama loglari bu terminalde akacak.' -ForegroundColor Green
} else {
  Write-Host 'Android Bundled gorulmedi ama logcat yine baslatiliyor.' -ForegroundColor Yellow
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$projectRoot\watch-android-logs.ps1" -PackageName 'com.wmatch.app'
