param(
    [string]$Installer = (Join-Path (Split-Path -Parent $PSScriptRoot) "release/Boundary-Lab-Deploy-0.1.0-win-x64.exe")
)
$ErrorActionPreference = "Stop"
$deployRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$testRoot = [IO.Path]::GetFullPath((Join-Path $deployRoot "build/installer-test"))
if (-not $testRoot.StartsWith((Join-Path $deployRoot "build") + [IO.Path]::DirectorySeparatorChar)) {
    throw "Installer test directory escaped the build directory."
}
$registryRoots = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*")
$existing = Get-ItemProperty -Path $registryRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "^Boundary Lab Deploy(?: |$)" }
if ($existing -or (Test-Path -LiteralPath $testRoot)) {
    throw "An existing Deploy installation or test directory was found; refusing to replace it."
}
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$setup = Start-Process -FilePath $Installer -ArgumentList "/S", "/D=$testRoot" -WindowStyle Hidden -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installer failed with exit $($setup.ExitCode)" }
$env:DEPLOY_SMOKE_DATA = Join-Path $deployRoot "build/Installed Smoke Data"
$env:DEPLOY_PYTHON_EXE = "Z:\not-installed\python.exe"
$env:DEPLOY_JULIA_EXE = "Z:\not-installed\julia.exe"
$application = Join-Path $testRoot "Boundary Lab Deploy.exe"
try {
    $smoke = Start-Process -FilePath $application -ArgumentList "--packaged-smoke" -WindowStyle Hidden -Wait -PassThru
    if ($smoke.ExitCode -ne 0) { throw "Installed app failed with exit $($smoke.ExitCode)" }
    $report = Get-Content -LiteralPath (Join-Path $env:DEPLOY_SMOKE_DATA "packaged-smoke.json") -Raw | ConvertFrom-Json
    if (-not ($report.packaged -and $report.workerReady -and $report.canvas)) { throw "Installed app report is incomplete" }
    $report | ConvertTo-Json
} finally {
    $registration = Get-ItemProperty -Path $registryRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "^Boundary Lab Deploy(?: |$)" }
    $uninstallCommand = if ($registration) { $registration.UninstallString } else { "" }
    if ($uninstallCommand -match '^"([^"\r\n]+)"') {
        $uninstaller = $Matches[1]
        $registeredRoot = [IO.Path]::GetFullPath((Split-Path -Parent $uninstaller)).TrimEnd('\')
        if ($registeredRoot -ne $testRoot.TrimEnd('\')) { throw "Registered uninstaller is outside the test directory" }
        $removed = Start-Process -FilePath $uninstaller -ArgumentList "/S", "/currentuser" -WindowStyle Hidden -Wait -PassThru
        if ($removed.ExitCode -ne 0) { throw "Test uninstaller failed with exit $($removed.ExitCode)" }
    } else { throw "Unexpected install registration; automatic cleanup was not attempted." }
}
Write-Output "Temporary per-user install, bundled app launch, and uninstall passed."
