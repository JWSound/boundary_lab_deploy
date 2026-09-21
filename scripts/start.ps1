$ErrorActionPreference = "Stop"
$deployRoot = Split-Path -Parent $PSScriptRoot
$env:DEPLOY_PYTHON_EXE = Join-Path $deployRoot ".venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $env:DEPLOY_PYTHON_EXE)) {
    throw "Create the Deploy .venv and install the project first; see README.md."
}
Push-Location (Join-Path $deployRoot "desktop")
try {
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    npm start
} finally { Pop-Location }
