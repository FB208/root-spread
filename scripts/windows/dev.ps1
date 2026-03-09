param(
    [ValidateSet("web", "api", "all")]
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

switch ($Target) {
    "web" {
        Start-Web
    }
    "api" {
        Start-Api
    }
    "all" {
        $command = "Set-Location '$RepoRoot'; pnpm run dev:api"
        Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command | Out-Null
        Start-Web
    }
}
