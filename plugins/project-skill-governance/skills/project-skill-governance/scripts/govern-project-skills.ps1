param(
    [string]$Root,
    [switch]$CreateMissingAgentDirs,
    [switch]$VerifyOnly,
    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    if ($Root) {
        return (Resolve-Path -LiteralPath $Root).Path
    }

    $candidate = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..\..")
    return $candidate.Path
}

function Get-RelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$FromDirectory,
        [Parameter(Mandatory = $true)][string]$ToPath
    )

    if (Test-Path -LiteralPath $FromDirectory) {
        $resolvedFrom = (Resolve-Path -LiteralPath $FromDirectory).Path
    } else {
        $resolvedFrom = [System.IO.Path]::GetFullPath($FromDirectory)
    }
    $fromUri = [Uri]($resolvedFrom.TrimEnd('\') + '\')
    if (Test-Path -LiteralPath $ToPath) {
        $resolvedTo = (Resolve-Path -LiteralPath $ToPath).Path
    } else {
        $resolvedTo = [System.IO.Path]::GetFullPath($ToPath)
    }
    $toUri = [Uri]$resolvedTo
    return [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString()).Replace('/', '\')
}

function Get-DirectoryHash {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }

    $files = Get-ChildItem -LiteralPath $Path -Recurse -File -Force |
        Where-Object {
            $_.FullName -notmatch '\\node_modules\\' -and
            $_.Name -ne '.env'
        } |
        Sort-Object FullName

    $sha = [System.Security.Cryptography.SHA256]::Create()
    $builder = [System.Text.StringBuilder]::new()

    foreach ($file in $files) {
        $relative = Get-RelativePath -FromDirectory $Path -ToPath $file.FullName
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace("-", "")
        [void]$builder.AppendLine("$relative=$hash")
    }

    $summaryBytes = [System.Text.Encoding]::UTF8.GetBytes($builder.ToString())
    return [BitConverter]::ToString($sha.ComputeHash($summaryBytes)).Replace("-", "")
}

function Copy-SkillToCanonical {
    param(
        [Parameter(Mandatory = $true)][string]$SourceSkill,
        [Parameter(Mandatory = $true)][string]$DestinationSkill
    )

    if ($WhatIf) {
        Write-Host "[whatif] Copy $SourceSkill -> $DestinationSkill"
        return
    }

    Copy-Item -LiteralPath $SourceSkill -Destination $DestinationSkill -Recurse -Force
    Write-Host "[copy] $SourceSkill -> $DestinationSkill"
}

function Read-Utf8Text {
    param([Parameter(Mandatory = $true)][string]$Path)

    $text = [System.IO.File]::ReadAllText($Path, [System.Text.UTF8Encoding]::new($false))
    return $text.TrimStart([char]0xFEFF)
}

function Get-SkillFrontmatterBlock {
    param([Parameter(Mandatory = $true)][string]$SkillFile)

    $content = Read-Utf8Text -Path $SkillFile
    $match = [regex]::Match($content, "(?s)\A---\r?\n.*?\r?\n---")
    if (-not $match.Success) {
        throw "Missing YAML frontmatter in $SkillFile"
    }
    return $match.Value
}

function Normalize-Newlines {
    param([Parameter(Mandatory = $true)][string]$Text)

    return $Text.Replace("`r`n", "`n")
}

function Test-RouterSkill {
    param(
        [Parameter(Mandatory = $true)][string]$SourceSkill,
        [Parameter(Mandatory = $true)][string]$CanonicalSkillDir
    )

    $skillFile = Join-Path $SourceSkill "SKILL.md"
    if (-not (Test-Path -LiteralPath $skillFile)) {
        return $false
    }

    $canonicalSkillFile = Join-Path $CanonicalSkillDir "SKILL.md"
    $expectedRelative = Get-RelativePath -FromDirectory $SourceSkill -ToPath $CanonicalSkillDir
    $content = Read-Utf8Text -Path $skillFile
    $sourceFrontmatter = Get-SkillFrontmatterBlock -SkillFile $skillFile
    $canonicalFrontmatter = Get-SkillFrontmatterBlock -SkillFile $canonicalSkillFile
    return $content.Contains("compatibility router") -and
        $content.Contains($expectedRelative) -and
        ((Normalize-Newlines -Text $sourceFrontmatter) -eq (Normalize-Newlines -Text $canonicalFrontmatter))
}

function Test-RouterDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$SkillsDir,
        [Parameter(Mandatory = $true)][object[]]$CanonicalSkillDirs
    )

    $failures = 0
    foreach ($canonical in $CanonicalSkillDirs) {
        $routerDir = Join-Path $SkillsDir $canonical.Name
        $routerSkillFile = Join-Path $routerDir "SKILL.md"
        $canonicalSkillFile = Join-Path $canonical.FullName "SKILL.md"
        $expectedRelative = Get-RelativePath -FromDirectory $routerDir -ToPath $canonical.FullName

        if (-not (Test-Path -LiteralPath $routerSkillFile)) {
            Write-Host "[missing] $routerSkillFile"
            $failures += 1
            continue
        }

        $resolvedTarget = [System.IO.Path]::GetFullPath((Join-Path $routerDir $expectedRelative))
        $actualTarget = (Resolve-Path -LiteralPath $canonical.FullName).Path
        if ($resolvedTarget -ne $actualTarget) {
            Write-Host "[bad-path] $routerSkillFile -> $expectedRelative resolves to $resolvedTarget"
            $failures += 1
            continue
        }

        if (-not (Test-RouterSkill -SourceSkill $routerDir -CanonicalSkillDir $canonical.FullName)) {
            Write-Host "[bad-router] $routerSkillFile"
            $failures += 1
            continue
        }

        Write-Host "[ok] $routerSkillFile -> $expectedRelative"
    }

    return $failures
}

function Write-RouterSkill {
    param(
        [Parameter(Mandatory = $true)][string]$SkillDir,
        [Parameter(Mandatory = $true)][string]$SkillName,
        [Parameter(Mandatory = $true)][string]$CanonicalSkillDir
    )

    $canonicalSkillFile = Join-Path $CanonicalSkillDir "SKILL.md"
    $relative = Get-RelativePath -FromDirectory $SkillDir -ToPath $CanonicalSkillDir
    $canonicalFrontmatter = Get-SkillFrontmatterBlock -SkillFile $canonicalSkillFile
    $content = @"
$canonicalFrontmatter

# $SkillName Router

This is a compatibility router. The canonical project skill folder is:

Canonical path: $relative

Resolve that path relative to this file, read `SKILL.md` inside that canonical folder, and follow the canonical instructions. Treat bundled resources in that folder as part of the skill. Do not treat this router as the source of truth.
"@

    if ($WhatIf) {
        Write-Host "[whatif] Rewrite router $SkillDir -> $relative"
        return
    }

    if (Test-Path -LiteralPath $SkillDir) {
        Remove-Item -LiteralPath $SkillDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
    $skillFile = Join-Path $SkillDir "SKILL.md"
    [System.IO.File]::WriteAllText($skillFile, $content, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[route] $SkillDir -> $relative"
}

$repoRoot = Get-RepoRoot
$canonicalSkills = Join-Path $repoRoot ".agents\skills"
$agentConfigDirs = @(".claude", ".cursor", ".qoder", ".codex", ".opencode", ".openclaw")

if (-not (Test-Path -LiteralPath $canonicalSkills)) {
    if ($WhatIf) {
        Write-Host "[whatif] Create $canonicalSkills"
    } else {
        New-Item -ItemType Directory -Path $canonicalSkills -Force | Out-Null
    }
}

$sourceSkills = @()
foreach ($agentDirName in @(".agents") + $agentConfigDirs) {
    $agentDir = Join-Path $repoRoot $agentDirName
    $skillsDir = Join-Path $agentDir "skills"

    if (-not (Test-Path -LiteralPath $skillsDir)) {
        if ($CreateMissingAgentDirs -and $agentDirName -ne ".agents") {
            if ($WhatIf) {
                Write-Host "[whatif] Create $skillsDir"
            } else {
                New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
            }
        }
        continue
    }

    $sourceSkills += Get-ChildItem -LiteralPath $skillsDir -Directory -Force | ForEach-Object {
        [pscustomobject]@{
            AgentDir = $agentDirName
            Name = $_.Name
            Path = $_.FullName
        }
    }
}

$canonicalSkillDirs = Get-ChildItem -LiteralPath $canonicalSkills -Directory -Force | Sort-Object Name

if ($VerifyOnly) {
    $totalFailures = 0
    foreach ($agentDirName in $agentConfigDirs) {
        $skillsDir = Join-Path (Join-Path $repoRoot $agentDirName) "skills"
        if (-not (Test-Path -LiteralPath $skillsDir)) {
            Write-Host "[skip] $agentDirName has no skills directory"
            continue
        }
        $totalFailures += Test-RouterDirectory -SkillsDir $skillsDir -CanonicalSkillDirs $canonicalSkillDirs
    }
    if ($totalFailures -gt 0) {
        throw "Router verification failed with $totalFailures issue(s)."
    }
    Write-Host "[done] router verification passed"
    exit 0
}

foreach ($skill in $sourceSkills | Where-Object { $_.AgentDir -ne ".agents" }) {
    $target = Join-Path $canonicalSkills $skill.Name
    if (-not (Test-Path -LiteralPath $target)) {
        Copy-SkillToCanonical -SourceSkill $skill.Path -DestinationSkill $target
        continue
    }

    if (Test-RouterSkill -SourceSkill $skill.Path -CanonicalSkillDir $target) {
        Write-Host "[router] $($skill.AgentDir)/skills/$($skill.Name)"
        continue
    }

    $sourceHash = Get-DirectoryHash -Path $skill.Path
    $targetHash = Get-DirectoryHash -Path $target
    if ($sourceHash -eq $targetHash) {
        Write-Host "[same] $($skill.AgentDir)/skills/$($skill.Name)"
    } else {
        Write-Host "[conflict] $($skill.AgentDir)/skills/$($skill.Name) differs from .agents/skills/$($skill.Name); kept canonical"
    }
}

foreach ($agentDirName in $agentConfigDirs) {
    $agentDir = Join-Path $repoRoot $agentDirName
    $skillsDir = Join-Path $agentDir "skills"

    if (-not (Test-Path -LiteralPath $skillsDir)) {
        if ($CreateMissingAgentDirs) {
            if ($WhatIf) {
                Write-Host "[whatif] Create $skillsDir"
            } else {
                New-Item -ItemType Directory -Path $skillsDir -Force | Out-Null
            }
        } else {
            Write-Host "[skip] $agentDirName has no skills directory"
            continue
        }
    }

    foreach ($canonical in $canonicalSkillDirs) {
        $routerDir = Join-Path $skillsDir $canonical.Name
        Write-RouterSkill -SkillDir $routerDir -SkillName $canonical.Name -CanonicalSkillDir $canonical.FullName
    }
}

Write-Host "[done] canonical skills: $($canonicalSkillDirs.Count)"
