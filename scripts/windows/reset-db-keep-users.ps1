param(
    [switch]$Force,
    [switch]$DryRun
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ApiProject = Join-Path $RepoRoot "apps\api"
$ScriptPath = Join-Path $ApiProject "scripts\reset_non_user_data.py"

$arguments = @(
    "run",
    "--project",
    $ApiProject,
    "python",
    $ScriptPath
)

if ($Force) {
    $arguments += "--yes"
}

if ($DryRun) {
    $arguments += "--dry-run"
}

& uv @arguments
