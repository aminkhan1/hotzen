# HOTZEN — Governed AI Engineering Framework. User-local wrappers only.
$ErrorActionPreference = "Stop"
$SourceDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BinDir = "$HOME\.local\bin"

function Get-LegacyWrapper([string]$Source) {
    return @"
@echo off
rem agent-core-hub local CLI wrapper
set "HUB_SOURCE=$Source"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is required to execute Universal Agent Core Hub CLI. >&2
    echo Please install Node.js from https://nodejs.org or run via npx. >&2
    exit /b 1
)

node "%HUB_SOURCE%\cli\index.js" %*
exit /b %ERRORLEVEL%
"@
}

function Get-HotzenWrapper([string]$Source) {
    return @"
@echo off
rem HOTZEN local CLI wrapper v1
setlocal DisableDelayedExpansion
set "HUB_SOURCE=$Source"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is required to execute HOTZEN CLI. >&2
    exit /b 1
)

node "%HUB_SOURCE%\cli\index.js" %*
exit /b %ERRORLEVEL%
"@
}

# Inspect all command extensions and aliases before any write or PATH change.
foreach ($Alias in @("core", "hotzen", "agent-hub", "agent-hub-init")) {
    foreach ($Extension in @("", ".cmd", ".bat", ".exe", ".ps1")) {
        $Candidate = Join-Path $BinDir "$Alias$Extension"
        $Item = Get-Item -LiteralPath $Candidate -Force -ErrorAction SilentlyContinue
        if ($null -eq $Item) { continue }
        $Owned = $false
        if ($Extension -eq ".cmd" -and !$Item.PSIsContainer -and
            !($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $Existing = (Get-Content -LiteralPath $Candidate -Raw).Replace("`r`n", "`n").TrimEnd("`n")
            # Source is data only. Never invoke, dot-source or eval an old wrapper.
            $Match = [regex]::Match($Existing, '(?m)^set "HUB_SOURCE=([^\r\n]*)"$')
            if ($Match.Success) {
                $OldSource = $Match.Groups[1].Value
                $Legacy = (Get-LegacyWrapper $OldSource).Replace("`r`n", "`n").TrimEnd("`n")
                $Current = (Get-HotzenWrapper $OldSource).Replace("`r`n", "`n").TrimEnd("`n")
                $Owned = $Existing -ceq $Legacy -or $Existing -ceq $Current
            }
        }
        if (!$Owned) { throw "$Alias already exists at $Candidate; leaving existing commands unchanged." }
    }
}

# Percent signs are literal path data in a batch file; delayed expansion is off.
$CmdContent = Get-HotzenWrapper ($SourceDir.Replace('%', '%%'))
if (!(Test-Path -LiteralPath $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}
foreach ($Alias in @("hotzen", "core", "agent-hub", "agent-hub-init")) {
    [IO.File]::WriteAllText((Join-Path $BinDir "$Alias.cmd"), $CmdContent + "`r`n", [Text.UTF8Encoding]::new($false))
}
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($BinDir -notin ($UserPath -split ';')) {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
}
Write-Host "Installed hotzen, core, agent-hub and agent-hub-init into $BinDir"
Write-Host "Open a new terminal and run hotzen --help. Keep the source directory in place."
