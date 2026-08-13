# FUK-YT Build Script (scripts/build.ps1)
param(
    [switch]$ExtensionOnly,
    [switch]$HostOnly,
    [switch]$Clean,
    [switch]$Install,
    [switch]$Dev
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

$EXTENSION_ID = "afkbnpippihdclgeodpmmpeocbbinpeo"
$HOST_ID      = "com.fukyt.host"

function Write-Step([string]$msg) {
    Write-Host "`n>>> $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}
function Write-Warn([string]$msg) {
    Write-Host "  [WARN] $msg" -ForegroundColor Yellow
}
function Write-Fail([string]$msg) {
    Write-Host "`n  [FAIL] $msg" -ForegroundColor Red
    exit 1
}

function Require-Go {
    if (Get-Command go -ErrorAction SilentlyContinue) { return }
    $candidates = @(
        "C:\Program Files\Go\bin\go.exe",
        "$env:LOCALAPPDATA\go\bin\go.exe",
        "$env:USERPROFILE\go\bin\go.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $env:PATH += ";$(Split-Path $c)"
            return
        }
    }
    Write-Fail "Go not found. Install from https://go.dev/dl/ and add to PATH."
}

function Require-Node {
    if (Get-Command node -ErrorAction SilentlyContinue) { return }
    Write-Fail "Node.js not found. Install from https://nodejs.org/"
}

if ($Clean) {
    Write-Step "Cleaning build artifacts"
    Remove-Item -Recurse -Force "$Root\extension\dist"    -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$Root\native-host\bin"   -ErrorAction SilentlyContinue
    Write-Ok "Clean complete"
}

if (!$HostOnly) {
    Write-Step "Building Chrome extension"
    Require-Node

    Push-Location "$Root\extension"
    try {
        if (!(Test-Path "node_modules")) {
            Write-Host "  Installing npm dependencies..." -ForegroundColor DarkGray
            npm install --silent
        }

        if ($Dev) {
            Write-Host "  Starting Vite in watch mode..." -ForegroundColor DarkGray
            npm run dev
        } else {
            npm run build 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            if ($LASTEXITCODE -ne 0) { Write-Fail "Extension build failed" }
            Write-Ok "Extension built -> extension/dist/"
        }
    } finally {
        Pop-Location
    }
}

if (!$ExtensionOnly) {
    Write-Step "Building Go native host"
    Require-Go

    Push-Location "$Root\native-host"
    try {
        Write-Host "  go mod tidy..." -ForegroundColor DarkGray
        go mod tidy 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

        New-Item -ItemType Directory -Force "$Root\native-host\bin" | Out-Null

        $env:GOOS   = "windows"
        $env:GOARCH  = "amd64"
        $env:CGO_ENABLED = "0"

        Write-Host "  go build..." -ForegroundColor DarkGray
        go build -ldflags="-s -w" -o "bin\native-host.exe" ".\cmd\host" 2>&1 |
            ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

        if ($LASTEXITCODE -ne 0) { Write-Fail "Native host build failed" }
        Write-Ok "Native host built -> native-host/bin/native-host.exe"
    } finally {
        Pop-Location
    }

    Write-Step "Running engine health check"
    $hostExe = "$Root\native-host\bin\native-host.exe"
    if (Test-Path $hostExe) {
        & $hostExe --health-check
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Health check reported issues (binaries may not be present yet)"
        } else {
            Write-Ok "Health check passed"
        }
    } else {
        Write-Warn "native-host.exe not found - skipping health check"
    }
}

if ($Install) {
    Write-Step "Registering Chrome Native Messaging host"

    $hostExe = "$Root\native-host\bin\native-host.exe"
    if (!(Test-Path $hostExe)) {
        Write-Fail "native-host.exe not found."
    }

    $manifestDir  = "$Root\native-host"
    $manifestPath = "$manifestDir\$HOST_ID.json"
    $escapedPath  = $hostExe.Replace('\', '\\')

    $manifestObj = @{
        name = $HOST_ID
        description = "FUK-YT Local Download Engine"
        path = $hostExe
        type = "stdio"
        allowed_origins = @("chrome-extension://$EXTENSION_ID/")
    }
    $jsonContent = $manifestObj | ConvertTo-Json -Depth 3
    [System.IO.File]::WriteAllText($manifestPath, $jsonContent)

    $regKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HOST_ID"
    New-Item -Path $regKey -Force | Out-Null
    Set-ItemProperty -Path $regKey -Name "(Default)" -Value $manifestPath

    Write-Ok "Native host registered in Registry"
    Write-Ok "Manifest: $manifestPath"
    Write-Ok "Registry key: $regKey"
}

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host "  BUILD COMPLETE" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""
