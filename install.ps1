# ==============================================================================
# 🌐 HOTZEN — Governed AI Engineering Framework - Online One-Liner Installer (Windows PowerShell)
# Legacy remote bootstrap (private repository access required; no public endpoint approved).
# Usage: iwr -useb https://raw.githubusercontent.com/aminkhan1/agent-core-hub/main/install.ps1 | iex
# Or:    & ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/aminkhan1/agent-core-hub/main/install.ps1))) -Stack laravel
# ==============================================================================

param (
    [string]$Stack = "",
    [string]$Bridges = "core",
    [switch]$DryRun,
    [switch]$ForceRemote
)

# Packaged/local installation never needs the private remote bootstrap.
$LocalCli = if ($PSScriptRoot) { Join-Path $PSScriptRoot "cli\index.js" } else { $null }
if (!$ForceRemote -and $LocalCli -and (Test-Path -LiteralPath $LocalCli)) {
    $CliArguments = @()
    if ($Stack) { $CliArguments += "--stack=$Stack" }
    $CliArguments += "--bridges=$Bridges"
    if ($DryRun) { $CliArguments += "--dry-run" }
    & node $LocalCli @CliArguments
    exit $LASTEXITCODE
}

$RepoUser = "aminkhan1"
$RepoName = "agent-core-hub"

if ($DryRun) {
    Write-Host "🔍 [DRY-RUN MODE ACTIVATED]: Simulating deployment without modifying disk." -ForegroundColor Yellow
}

function Safe-CopyFile {
    param (
        [string]$Src,
        [string]$Dst
    )
    if ($DryRun) {
        if (Test-Path $Dst) {
            Write-Host "   [DRY-RUN] Would backup & overwrite: $Dst -> .bak" -ForegroundColor Gray
        } else {
            Write-Host "   [DRY-RUN] Would create: $Dst" -ForegroundColor Gray
        }
        return
    }
    $parent = Split-Path $Dst -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if ((Test-Path -LiteralPath $Dst) -and [IO.Path]::GetExtension($Dst) -eq ".json") { return }
    if (Test-Path $Dst) {
        $srcHash = (Get-FileHash $Src -Algorithm SHA256).Hash
        $dstHash = (Get-FileHash $Dst -Algorithm SHA256).Hash
        if ($srcHash -ne $dstHash) {
            $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $bak = "$Dst.bak.$timestamp"
            Copy-Item -Path $Dst -Destination $bak -Force
            Write-Host "   🛡️ Backed up existing file: $(Split-Path $Dst -Leaf) -> $(Split-Path $bak -Leaf)" -ForegroundColor Yellow
        }
    }
    Copy-Item -Path $Src -Destination $Dst -Force
}

function Safe-WriteString {
    param (
        [string]$Dst,
        [string]$Content
    )
    if ($DryRun) {
        if (Test-Path $Dst) {
            Write-Host "   [DRY-RUN] Would backup & overwrite: $Dst -> .bak" -ForegroundColor Gray
        } else {
            Write-Host "   [DRY-RUN] Would create: $Dst" -ForegroundColor Gray
        }
        return
    }
    $parent = Split-Path $Dst -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    if (Test-Path $Dst) {
        $existing = Get-Content -Path $Dst -Raw -ErrorAction SilentlyContinue
        if ($existing -ne $Content) {
            $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            $bak = "$Dst.bak.$timestamp"
            Copy-Item -Path $Dst -Destination $bak -Force
            Write-Host "   🛡️ Backed up existing file: $(Split-Path $Dst -Leaf) -> $(Split-Path $bak -Leaf)" -ForegroundColor Yellow
        }
    }
    [System.IO.File]::WriteAllText($Dst, $Content, [System.Text.Encoding]::UTF8)
}

function Safe-CopyDirectory {
    param (
        [string]$SrcDir,
        [string]$DstDir
    )
    if (-not (Test-Path $SrcDir)) { return }
    Get-ChildItem -Path $SrcDir -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($SrcDir.Length).TrimStart("\", "/")
        if ($rel -match '^(memory|tasks)([\\/]|$)') { return }
        $targetPath = Join-Path $DstDir $rel
        Safe-CopyFile -Src $_.FullName -Dst $targetPath
    }
}

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "🌐 HOTZEN — Governed AI Engineering Framework - Windows Instant Deployer" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($Stack)) {
    Write-Host "🎯 Select Tech Stack to Deploy into $(Get-Location):" -ForegroundColor Yellow
    Write-Host "  [Mobile & Native]"
    Write-Host "   1) flutter           2) kotlin            3) swift"
    Write-Host "  [Web & Frontend]"
    Write-Host "   4) react             5) react-nextjs      6) vue             7) vanilla-web     8) wordpress"
    Write-Host "  [Backend & Enterprise]"
    Write-Host "   9) python-fastapi   10) golang           11) rust           12) cpp"
    Write-Host "  13) java             14) php              15) laravel        16) dotnet"
    Write-Host "  17) nestjs           18) nodejs           19) dart-backend"
    Write-Host "  [AI & Data]"
    Write-Host "  20) python-ai-ml     21) database"
    Write-Host "  [Blockchain & Smart Contracts]"
    Write-Host "  22) solidity"
    Write-Host "  [Game Engines & Automation]"
    Write-Host "  23) unity            24) godot            25) gdscript       26) unreal-engine"
    Write-Host "  27) bash             28) core (Raw Core)"
    Write-Host "======================================================================" -ForegroundColor Cyan

    $choice = Read-Host "Enter number [1-28] (default: 1)"
    switch ($choice) {
        "2"  { $Stack = "kotlin" }
        "3"  { $Stack = "swift" }
        "4"  { $Stack = "react" }
        "5"  { $Stack = "react-nextjs" }
        "6"  { $Stack = "vue" }
        "7"  { $Stack = "vanilla-web" }
        "8"  { $Stack = "wordpress" }
        "9"  { $Stack = "python-fastapi" }
        "10" { $Stack = "golang" }
        "11" { $Stack = "rust" }
        "12" { $Stack = "cpp" }
        "13" { $Stack = "java" }
        "14" { $Stack = "php" }
        "15" { $Stack = "laravel" }
        "16" { $Stack = "dotnet" }
        "17" { $Stack = "nestjs" }
        "18" { $Stack = "nodejs" }
        "19" { $Stack = "dart-backend" }
        "20" { $Stack = "python-ai-ml" }
        "21" { $Stack = "database" }
        "22" { $Stack = "solidity" }
        "23" { $Stack = "unity" }
        "24" { $Stack = "godot" }
        "25" { $Stack = "gdscript" }
        "26" { $Stack = "unreal-engine" }
        "27" { $Stack = "bash" }
        "28" { $Stack = "core" }
        default { $Stack = "flutter" }
    }
}

Write-Host "🚀 Fetching and deploying stack: $Stack directly from GitHub..." -ForegroundColor Green

$ZipUrl = "https://github.com/$RepoUser/$RepoName/archive/refs/heads/$Stack.zip"
$TempZip = Join-Path $env:TEMP "agent-hub-$Stack.zip"
$TempExtract = Join-Path $env:TEMP "agent-hub-extract-$([Guid]::NewGuid().ToString())"

try {
    Invoke-WebRequest -Uri $ZipUrl -OutFile $TempZip -UseBasicParsing
    Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force

    $ExtractedFolder = Get-ChildItem -Path $TempExtract | Where-Object { $_.PSIsContainer } | Select-Object -First 1

    if (-not $ExtractedFolder) {
        Write-Error "❌ Failed to extract $Stack from GitHub archive."
        exit 1
    }

    # Copy .agents via Safe-CopyDirectory
    $SourceAgents = Join-Path $ExtractedFolder.FullName ".agents"
    if (Test-Path $SourceAgents) {
        $DestAgents = Join-Path (Get-Location) ".agents"
        Safe-CopyDirectory -SrcDir $SourceAgents -DstDir $DestAgents
        $srcMcp = Join-Path $SourceAgents "mcp_config.json"
        if (Test-Path $srcMcp) { Safe-CopyFile -Src $srcMcp -Dst (Join-Path (Get-Location) ".mcp.json") }
        $srcAgentsMd = Join-Path $ExtractedFolder.FullName "AGENTS.md"
        if (Test-Path $srcAgentsMd) { Safe-CopyFile -Src $srcAgentsMd -Dst (Join-Path (Get-Location) "AGENTS.md") }

        # Memory sanitization in target project to prevent cross-project history leakage
        $projName = Split-Path (Get-Location) -Leaf
        $cleanSession = @"
# Session Memory - Executive Summary of Completed Tasks

این فایل تاریخچه کارهای انجام‌شده در سشن‌های کاری فعال این پروژه را برای بازیابی سریع بدون نیاز به مرور مجدد ثبت می‌کند.

---

## 📌 گزارش اقدامات انجام‌شده:

*(هنوز اقدامی در این سشن کاری ثبت نشده است. پس از تکمیل هر تسک توسط ایجنت، خلاصه اجرایی آن در این بخش ثبت می‌شود)*
"@
        if (!(Test-Path -LiteralPath (Join-Path $DestAgents "memory\session_memory.md"))) {
            Safe-WriteString -Dst (Join-Path $DestAgents "memory\session_memory.md") -Content $cleanSession
        }

        $cleanWorking = @"
# Working Memory - Active Context & Resume Point

- **Current State**: آماده برای دریافت و اجرای تسک جدید.
- **Active Task**: هیچ تسک فعالی در جریان نیست.
- **Resume Point**: منتظر دریافت دستور جدید از سوی کاربر.
"@
        if (!(Test-Path -LiteralPath (Join-Path $DestAgents "memory\working_memory.md"))) {
            Safe-WriteString -Dst (Join-Path $DestAgents "memory\working_memory.md") -Content $cleanWorking
        }

        $cleanProject = @"
# Project Memory (Architecture & Repository Identity)

این فایل شناسنامه پایدار، اصول ثابت معماری، الگوهای نام‌گذاری و مشخصات اختصاصی این پروژه را برای بازیابی آنی کانتکست ایجنت‌ها ثبت می‌کند.

---

## 🏛️ ۱. ماهیت و معماری پروژه

- **نام پروژه / مخزن**: $projName
- **پشته فنی (Stack)**: $Stack
- **اصول معماری**: معماری تمیز (Clean Architecture)، تفکیک لایه‌ها، تایپ‌های صریح و اعتبارسنجی هدفمند بدون اثرات جانبی واقعی.

---

## 📁 ۲. ساختار کلیدی دایرکتوری‌ها

- لایه منطق / دامنه (Core / Domain)
- لایه داده و ذخیره‌سازی (Data / Infrastructure)
- لایه ارائه و کاربری (Presentation / UI / Transport)
- مستندات و قوانین حاکمیتی (.agents/)
"@
        if (!(Test-Path -LiteralPath (Join-Path $DestAgents "memory\project_memory.md"))) {
            Safe-WriteString -Dst (Join-Path $DestAgents "memory\project_memory.md") -Content $cleanProject
        }
    }


    # Deploy Core Rules & Bridges
    $BridgeDir = Join-Path $ExtractedFolder.FullName "core\bridges"
    $BridgeMap = @{
        "gemini"    = @("GEMINI.md", ".geminiignore")
        "claude"    = @("CLAUDE.md", ".claude\settings.json", ".claude\commands\route.md", ".claude\commands\plan.md", ".claude\commands\critic.md", ".claude\commands\verify.md", ".mcp.json")
        "codex"     = @("CODEX.md", ".codexignore", "AGENTS.md")
        "cursor"    = @("CURSOR.md", ".cursorrules", ".cursor\rules\governance.mdc", ".cursor\rules\clean-architecture.mdc", ".cursor\mcp.json", ".cursorignore")
        "copilot"   = @(".github\copilot-instructions.md")
        "windsurf"  = @("WINDSURF.md", ".windsurfrules", ".windsurfignore")
        "cline"     = @("CLINE.md", ".clinerules")
        "aider"     = @("AIDER.md", ".aider.conf.yml", ".aiderignore")
        "deepseek"  = @("DEEPSEEK.md", ".deepseekignore")
        "qwen"      = @("QWEN.md", ".qwenignore")
        "codestral" = @("CODESTRAL.md", ".codestralignore")
        "ollama"    = @("OLLAMA.md", ".ollamaignore")
        "kimi"      = @("KIMI.md", ".kimiignore")
        "opencode"  = @("OPENCODE.md", ".opencodeignore")
    }


    $SelectedBridges = @("gemini", "claude", "codex")
    if ($Bridges -eq "all") {
        $SelectedBridges = $BridgeMap.Keys
    } elseif ($Bridges -ne "core" -and $Bridges -ne "default") {
        $extra = $Bridges.Split(",") | ForEach-Object { $_.Trim().ToLower() }
        $SelectedBridges = ($SelectedBridges + $extra) | Select-Object -Unique
    }

    foreach ($bKey in $SelectedBridges) {
        if ($BridgeMap.ContainsKey($bKey)) {
            foreach ($relPath in $BridgeMap[$bKey]) {
                $src = Join-Path $BridgeDir $relPath
                $dst = Join-Path (Get-Location) $relPath
                if (Test-Path $src) {
                    Safe-CopyFile -Src $src -Dst $dst
                }
            }
        }
    }

    # Stack Rules file
    $srcStackRules = Join-Path $ExtractedFolder.FullName "STACK_RULES.md"
    if (Test-Path $srcStackRules) {
        Safe-CopyFile -Src $srcStackRules -Dst (Join-Path (Get-Location) "STACK_RULES.md")
    }

    # Setup Git Security Hook if inside a git repository
    if (Test-Path (Join-Path (Get-Location) ".git")) {
        if ($DryRun) {
            Write-Host "   [DRY-RUN] Would configure Git pre-commit hook: git config core.hooksPath .agents/hooks" -ForegroundColor Gray
        } else {
            $hookPath = Join-Path (Get-Location) ".agents\hooks\pre-commit"
            if (Test-Path $hookPath) {
                try {
                    git config core.hooksPath .agents/hooks 2>$null
                } catch {}
            }
        }
    }

    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "✅ HOTZEN framework successfully deployed for: $Stack" -ForegroundColor Green
    Write-Host "📂 Structure deployed into $(Get-Location):" -ForegroundColor Green
    Write-Host "   • .agents/ (Rules, Memory, Skills, MCP config)" -ForegroundColor Gray
    Write-Host "   • 🔒 Git Pre-commit Security Hook automatically configured" -ForegroundColor Gray
    Write-Host "   • Core AI Bridges: Gemini (Antigravity), Claude Code, OpenAI Codex" -ForegroundColor Gray
    if ($Bridges -ne "core" -and $Bridges -ne "default") {
        Write-Host "   • Extra Bridges: $Bridges" -ForegroundColor Gray
    }
    Write-Host "   • Clean Project Root & Strict Git Human Guardian Law" -ForegroundColor Gray
    Write-Host "======================================================================" -ForegroundColor Green
}
finally {
    if (Test-Path $TempZip) { Remove-Item $TempZip -Force -ErrorAction SilentlyContinue }
    if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force -ErrorAction SilentlyContinue }
}
