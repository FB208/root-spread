param(
    [ValidateSet("web", "api", "collab", "all")]
    [string]$Target = "all"
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\.." )).Path

function Start-Web {
    Set-Location $RepoRoot
    pnpm run dev:web
}

function Start-Api {
    Set-Location $RepoRoot
    pnpm run dev:api
}

function Start-Collab {
    Set-Location $RepoRoot
    pnpm run dev:collab
}

switch ($Target) {
    "web" {
        Start-Web
    }
    "api" {
        Start-Api
    }
    "collab" {
        Start-Collab
    }
    "all" {
        $command = "Set-Location '$RepoRoot'; pnpm run dev:api"
        Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command | Out-Null
        $collabCommand = "Set-Location '$RepoRoot'; pnpm run dev:collab"
        Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $collabCommand | Out-Null
        Start-Web
    }
}
