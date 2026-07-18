param(
    [switch]$SkipDbPush
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot '.env'

if (-not (Test-Path $envFile)) {
    throw "Missing .env file at $envFile"
}

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()

    if (-not $line -or $line.StartsWith('#')) {
        return
    }

    $parts = $line -split '=', 2

    if ($parts.Count -ne 2) {
        return
    }

    $name = $parts[0].Trim()
    $value = $parts[1]

    if ($name) {
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) {
    throw "SUPABASE_ACCESS_TOKEN is empty in .env"
}

if (-not $env:SUPABASE_PROJECT_REF) {
    throw "SUPABASE_PROJECT_REF is empty in .env"
}

$supabaseDir = Join-Path $repoRoot 'supabase'

if (-not (Test-Path $supabaseDir)) {
    throw "Missing supabase directory at $supabaseDir"
}

Push-Location $repoRoot
try {
    npx supabase link --project-ref $env:SUPABASE_PROJECT_REF

    if ($LASTEXITCODE -ne 0) {
        throw "supabase link failed"
    }

    if ($SkipDbPush) {
        Write-Host "Skipping database push because -SkipDbPush was provided."
    }
    elseif ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_PASSWORD)) {
        Write-Warning "SUPABASE_DB_PASSWORD is empty. Database migrations were not pushed."
    }
    else {
        npx supabase db push --linked -p $env:SUPABASE_DB_PASSWORD --include-all --yes

        if ($LASTEXITCODE -ne 0) {
            throw "supabase db push failed"
        }
    }

    npx supabase functions deploy make-server-d962235e --project-ref $env:SUPABASE_PROJECT_REF --use-api --yes

    if ($LASTEXITCODE -ne 0) {
        throw "supabase functions deploy failed"
    }
}
finally {
    Pop-Location
}
