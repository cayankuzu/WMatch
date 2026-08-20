param(
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..'),
    [string]$TargetRoot = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'WMatch_secrests')
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
    param([string]$Path)

    return [System.IO.Path]::GetFullPath((Resolve-Path $Path).Path)
}

function New-ParentDirectory {
    param([string]$Path)

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Copy-RequiredFile {
    param(
        [string]$SourceRoot,
        [string]$RelativeSource,
        [string]$DestinationRoot,
        [string]$RelativeDestination,
        [bool]$Optional = $false
    )

    $sourcePath = Join-Path $SourceRoot $RelativeSource
    $destinationPath = Join-Path $DestinationRoot $RelativeDestination

    if (-not (Test-Path -LiteralPath $sourcePath)) {
        if ($Optional) {
            return $false
        }

        throw "Missing required file: $sourcePath"
    }

    New-ParentDirectory -Path $destinationPath
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    return $true
}

function Read-SimpleProperties {
    param([string]$Path)

    $result = @{}

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()

        if (-not $line -or $line.StartsWith('#')) {
            return
        }

        $parts = $line -split '=', 2
        if ($parts.Count -eq 2) {
            $result[$parts[0].Trim()] = $parts[1]
        }
    }

    return $result
}

$projectRoot = Resolve-FullPath -Path $ProjectRoot
$targetRoot = [System.IO.Path]::GetFullPath($TargetRoot)

New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null

$filesToCopy = @(
    @{ Source = '.env'; Destination = '.env'; Optional = $false },
    @{ Source = 'credentials.json'; Destination = 'credentials.json'; Optional = $false },
    @{ Source = 'credentials\ios\dist-cert.p12'; Destination = 'credentials\ios\dist-cert.p12'; Optional = $true },
    @{ Source = 'credentials\ios\profile.mobileprovision'; Destination = 'credentials\ios\profile.mobileprovision'; Optional = $true },
    @{ Source = 'credentials\ios\profile-associated-domains.mobileprovision'; Destination = 'credentials\ios\profile-associated-domains.mobileprovision'; Optional = $true },
    @{ Source = 'android\keystore.properties'; Destination = 'android\keystore.properties'; Optional = $false },
    @{ Source = 'android\app\debug.keystore'; Destination = 'android\app\debug.keystore'; Optional = $false },
    @{ Source = 'android\app\google-services.json'; Destination = 'android\app\google-services.json'; Optional = $true },
    @{ Source = 'firebase\google-services.json'; Destination = 'firebase\google-services.json'; Optional = $true },
    @{ Source = 'firebase\GoogleService-Info.plist'; Destination = 'firebase\GoogleService-Info.plist'; Optional = $true },
    @{ Source = 'scripts\deploy-supabase.ps1'; Destination = 'scripts\deploy-supabase.ps1'; Optional = $false },
    @{ Source = 'app.json'; Destination = 'app.json'; Optional = $false },
    @{ Source = 'eas.json'; Destination = 'eas.json'; Optional = $false },
    @{ Source = 'PRIVATE_REPO_BOOTSTRAP.md'; Destination = 'PRIVATE_REPO_BOOTSTRAP.md'; Optional = $false }
)

foreach ($entry in $filesToCopy) {
    Copy-RequiredFile `
        -SourceRoot $projectRoot `
        -RelativeSource $entry.Source `
        -DestinationRoot $targetRoot `
        -RelativeDestination $entry.Destination `
        -Optional $entry.Optional | Out-Null
}

$keystoreSourceDir = Join-Path $projectRoot 'android\keystores'
$keystoreTargetDir = Join-Path $targetRoot 'android\keystores'

if (-not (Test-Path -LiteralPath $keystoreSourceDir)) {
    throw "Missing required directory: $keystoreSourceDir"
}

New-Item -ItemType Directory -Path $keystoreTargetDir -Force | Out-Null
Get-ChildItem -LiteralPath $keystoreSourceDir -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $keystoreTargetDir -Recurse -Force
}

$supabaseTempDir = Join-Path $projectRoot 'supabase\.temp'
$supabaseBackupDir = Join-Path $targetRoot 'supabase'
New-Item -ItemType Directory -Path $supabaseBackupDir -Force | Out-Null

$repoSecretsDir = Join-Path $projectRoot '.secrets'
$backupSecretsDir = Join-Path $targetRoot '.secrets'
if (Test-Path -LiteralPath $repoSecretsDir) {
    New-Item -ItemType Directory -Path $backupSecretsDir -Force | Out-Null
    Get-ChildItem -LiteralPath $repoSecretsDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $backupSecretsDir -Recurse -Force
    }
}

if (Test-Path -LiteralPath (Join-Path $supabaseTempDir 'linked-project.json')) {
    Copy-Item -LiteralPath (Join-Path $supabaseTempDir 'linked-project.json') -Destination (Join-Path $supabaseBackupDir 'linked-project.json') -Force
}

if (Test-Path -LiteralPath (Join-Path $supabaseTempDir 'project-ref')) {
    Copy-Item -LiteralPath (Join-Path $supabaseTempDir 'project-ref') -Destination (Join-Path $supabaseBackupDir 'project-ref.txt') -Force
}

$keystoreProperties = Read-SimpleProperties -Path (Join-Path $projectRoot 'android\keystore.properties')
$releaseStoreRelativePath = $keystoreProperties['storeFile']
$releaseStorePassword = $keystoreProperties['storePassword']
$releaseKeyAlias = $keystoreProperties['keyAlias']
$releaseKeyPassword = $keystoreProperties['keyPassword']
$releaseStoreFullPath = if ($releaseStoreRelativePath) { Join-Path (Join-Path $projectRoot 'android') $releaseStoreRelativePath } else { $null }

$sha1 = $null
$sha256 = $null
$validUntil = $null
$keystoreName = if ($releaseStoreFullPath) { Split-Path -Leaf $releaseStoreFullPath } else { $null }
$keystoreBaseName = if ($keystoreName) { [System.IO.Path]::GetFileNameWithoutExtension($keystoreName) } else { 'release-keystore' }
$keytool = Get-Command keytool -ErrorAction SilentlyContinue

if ($keytool -and $releaseStoreFullPath -and (Test-Path -LiteralPath $releaseStoreFullPath) -and $releaseStorePassword -and $releaseKeyAlias -and $releaseKeyPassword) {
    $previousNativePreference = $PSNativeCommandUseErrorActionPreference
    $previousErrorActionPreference = $ErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
    $ErrorActionPreference = 'Continue'

    try {
        $keytoolOutput = & $keytool.Source -list -v -keystore $releaseStoreFullPath -storepass $releaseStorePassword -alias $releaseKeyAlias -keypass $releaseKeyPassword 2>&1

        if ($LASTEXITCODE -eq 0) {
            foreach ($line in $keytoolOutput) {
                if (-not $sha1 -and $line -match 'SHA1:\s+(.+)$') {
                    $sha1 = $Matches[1].Trim()
                }
                elseif (-not $sha256 -and $line -match 'SHA256:\s+(.+)$') {
                    $sha256 = $Matches[1].Trim()
                }
                elseif (-not $validUntil -and $line -match '^Valid from: .+ until: (.+)$') {
                    $validUntil = $Matches[1].Trim()
                }
            }

            $certPath = Join-Path $keystoreTargetDir "$keystoreBaseName-cert.pem"
            $null = & $keytool.Source -exportcert -rfc -keystore $releaseStoreFullPath -storepass $releaseStorePassword -alias $releaseKeyAlias -file $certPath 2>&1
        }
    }
    finally {
        $PSNativeCommandUseErrorActionPreference = $previousNativePreference
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

$infoLines = @(
    "Backup generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    "Project root: $projectRoot",
    "Desktop backup target: $targetRoot",
    "Release keystore file: $keystoreName",
    "Release key alias: $releaseKeyAlias",
    "Release SHA1: $sha1",
    "Release SHA256: $sha256",
    "Release certificate valid until: $validUntil"
)

Set-Content -LiteralPath (Join-Path $keystoreTargetDir "$keystoreBaseName-info.txt") -Value $infoLines -Encoding ASCII

$restoreScript = @'
param(
    [string]$ProjectRoot = (Get-Location)
)

$ErrorActionPreference = 'Stop'

function New-ParentDirectory {
    param([string]$Path)

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

$backupRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Resolve-Path $ProjectRoot).Path)

$filesToRestore = @(
    @{ Source = '.env'; Destination = '.env'; Optional = $false },
    @{ Source = 'credentials.json'; Destination = 'credentials.json'; Optional = $false },
    @{ Source = 'credentials\ios\dist-cert.p12'; Destination = 'credentials\ios\dist-cert.p12'; Optional = $true },
    @{ Source = 'credentials\ios\profile.mobileprovision'; Destination = 'credentials\ios\profile.mobileprovision'; Optional = $true },
    @{ Source = 'credentials\ios\profile-associated-domains.mobileprovision'; Destination = 'credentials\ios\profile-associated-domains.mobileprovision'; Optional = $true },
    @{ Source = 'android\keystore.properties'; Destination = 'android\keystore.properties'; Optional = $false },
    @{ Source = 'android\app\debug.keystore'; Destination = 'android\app\debug.keystore'; Optional = $false },
    @{ Source = 'android\app\google-services.json'; Destination = 'android\app\google-services.json'; Optional = $true },
    @{ Source = 'firebase\google-services.json'; Destination = 'firebase\google-services.json'; Optional = $true },
    @{ Source = 'firebase\GoogleService-Info.plist'; Destination = 'firebase\GoogleService-Info.plist'; Optional = $true }
)

foreach ($entry in $filesToRestore) {
    $sourcePath = Join-Path $backupRoot $entry.Source
    $destinationPath = Join-Path $projectRoot $entry.Destination

    if (-not (Test-Path -LiteralPath $sourcePath)) {
        if ($entry.Optional) {
            continue
        }

        throw "Missing backup file: $sourcePath"
    }

    New-ParentDirectory -Path $destinationPath
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}

$keystoreBackupDir = Join-Path $backupRoot 'android\keystores'
if (Test-Path -LiteralPath $keystoreBackupDir) {
    $keystoreProjectDir = Join-Path $projectRoot 'android\keystores'
    New-Item -ItemType Directory -Path $keystoreProjectDir -Force | Out-Null
    Get-ChildItem -LiteralPath $keystoreBackupDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $keystoreProjectDir -Recurse -Force
    }
}

$repoSecretsBackupDir = Join-Path $backupRoot '.secrets'
if (Test-Path -LiteralPath $repoSecretsBackupDir) {
    $repoSecretsProjectDir = Join-Path $projectRoot '.secrets'
    New-Item -ItemType Directory -Path $repoSecretsProjectDir -Force | Out-Null
    Get-ChildItem -LiteralPath $repoSecretsBackupDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $repoSecretsProjectDir -Recurse -Force
    }
}

$supabaseBackupDir = Join-Path $backupRoot 'supabase'
$supabaseTempDir = Join-Path $projectRoot 'supabase\.temp'

if (Test-Path -LiteralPath (Join-Path $supabaseBackupDir 'linked-project.json')) {
    New-Item -ItemType Directory -Path $supabaseTempDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $supabaseBackupDir 'linked-project.json') -Destination (Join-Path $supabaseTempDir 'linked-project.json') -Force
}

if (Test-Path -LiteralPath (Join-Path $supabaseBackupDir 'project-ref.txt')) {
    New-Item -ItemType Directory -Path $supabaseTempDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $supabaseBackupDir 'project-ref.txt') -Destination (Join-Path $supabaseTempDir 'project-ref') -Force
}

Write-Host "Restore completed for $projectRoot"
'@

$readmeText = @'
WMatch offline backup bundle

This folder is the Desktop continuity copy that can be moved to USB.

Use:
1. Clone the private GitHub repo.
2. Run RESTORE-TO-PROJECT.ps1 against the repo root.
3. Install dependencies with npm ci.
4. Build normally.
'@

$restoreChecklist = @'
WMatch recovery checklist

1. Copy this entire folder to a safe location before formatting or changing machines.
2. Clone the private GitHub repo to the new machine.
3. Run:
   powershell -ExecutionPolicy Bypass -File .\RESTORE-TO-PROJECT.ps1 -ProjectRoot <CLONED_REPO_PATH>
4. Verify these files now exist inside the repo:
   - .env
   - credentials.json
   - credentials\ios\dist-cert.p12
   - credentials\ios\profile.mobileprovision
   - credentials\ios\profile-associated-domains.mobileprovision
   - android\keystore.properties
   - android\keystores\*.jks
   - android\app\google-services.json
   - firebase\google-services.json
   - firebase\GoogleService-Info.plist
   - .secrets\firebase-admin\*.json
   - .secrets\AuthKey_*.p8
5. Run npm ci
6. For Android release verification:
   - cd android
   - .\gradlew.bat printReleaseSigningFingerprint
   - .\gradlew.bat bundleRelease
7. For Supabase deploy continuity, verify SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD as needed.
'@

$envProperties = Read-SimpleProperties -Path (Join-Path $projectRoot '.env')
$serviceRolePresent = -not [string]::IsNullOrWhiteSpace($envProperties['SUPABASE_SERVICE_ROLE_KEY'])
$databasePasswordPresent = -not [string]::IsNullOrWhiteSpace($envProperties['SUPABASE_DB_PASSWORD'])

$criticalNotes = @(
    'WMatch continuity backup bundle',
    '',
    'Included in this backup:',
    '- .env',
    '- credentials.json',
    '- credentials/ios/dist-cert.p12',
    '- credentials/ios/profile.mobileprovision',
    '- credentials/ios/profile-associated-domains.mobileprovision',
    '- android/keystore.properties',
    '- android/keystores/*',
    '- android/app/debug.keystore',
    '- android/app/google-services.json',
    '- firebase/google-services.json',
    '- firebase/GoogleService-Info.plist',
    '- .secrets/firebase-admin/*',
    '- .secrets/eas/*',
    '- .secrets/AuthKey_*.p8',
    '- scripts/deploy-supabase.ps1',
    '- app.json',
    '- eas.json',
    '- PRIVATE_REPO_BOOTSTRAP.md',
    '- RESTORE-TO-PROJECT.ps1',
    '- RESTORE-CHECKLIST.txt',
    '- SHA256SUMS.txt',
    '',
    'Critical notes:',
    "- Expected Android upload SHA1: $sha1",
    '- Private GitHub repo expected: cayankuzu/WMatch',
    '- Keep this folder private and copy it to USB before any risky machine change.',
    '- Google Play App Signing app-signing key remains provider-side.',
    "- SUPABASE_SERVICE_ROLE_KEY present in local .env: $serviceRolePresent",
    "- SUPABASE_DB_PASSWORD present in local .env: $databasePasswordPresent",
    '- The current EAS FCM V1 key id is documented and local validated Google service account backups are included under .secrets/firebase-admin/.',
    '- If any secret changes later, rerun scripts/export-wmatch-secrests.ps1.'
)

$remainingMissingItems = @()
if (-not $databasePasswordPresent) {
    $remainingMissingItems += 'SUPABASE_DB_PASSWORD is still empty. It is required for `supabase db push --linked` and remote migration continuity.'
}

if ($remainingMissingItems.Count -eq 0) {
    $remainingMissingItems = @('No known missing continuity secrets remain in the local workspace.')
}

Set-Content -LiteralPath (Join-Path $targetRoot 'RESTORE-TO-PROJECT.ps1') -Value $restoreScript -Encoding ASCII
Set-Content -LiteralPath (Join-Path $targetRoot 'README.txt') -Value $readmeText -Encoding ASCII
Set-Content -LiteralPath (Join-Path $targetRoot 'CRITICAL_NOTES.txt') -Value $criticalNotes -Encoding ASCII
Set-Content -LiteralPath (Join-Path $targetRoot 'RESTORE-CHECKLIST.txt') -Value $restoreChecklist -Encoding ASCII
Set-Content -LiteralPath (Join-Path $targetRoot 'REMAINING-MISSING-ITEMS.txt') -Value $remainingMissingItems -Encoding ASCII

$hashFilePath = Join-Path $targetRoot 'SHA256SUMS.txt'
$hashLines = Get-ChildItem -LiteralPath $targetRoot -Recurse -File |
    Where-Object { $_.FullName -ne $hashFilePath } |
    Sort-Object FullName |
    ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
        $relativePath = $_.FullName.Substring($targetRoot.Length).TrimStart('\')
        "$($hash.Hash)  $relativePath"
    }

Set-Content -LiteralPath $hashFilePath -Value $hashLines -Encoding ASCII

Write-Host "WMatch desktop backup refreshed at $targetRoot"
