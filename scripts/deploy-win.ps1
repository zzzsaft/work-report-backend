param(
  [string]$NasHost = "hz.jc-times.com",
  [string]$SshPort = "24",
  [string]$NasUser = "zzzsaft",
  [string]$RemoteAppDir = "/volume1/docker/work-report-backend",
  [string]$ContainerName = "work-report-backend",
  [string]$BuildCommand = "npm run prisma:generate; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE }; npm run build",
  [string]$RemoteDockerCommand = "",
  [switch]$SkipBuild,
  [switch]$Preflight,
  [bool]$LegacyScp = $true,
  [bool]$UseSudoForDocker = $true,
  [switch]$NoSshMultiplex
)

$ErrorActionPreference = "Stop"

function Require-Value {
  param([string]$Name, [string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Missing $Name. Edit scripts/deploy-win.ps1 or pass -$Name when running deploy."
  }
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Command '$Name' was not found. Install/enable it first and try again."
  }
}

function Run-Command {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

Require-Value "NasHost" $NasHost
Require-Value "NasUser" $NasUser
Require-Value "RemoteAppDir" $RemoteAppDir
Require-Value "ContainerName" $ContainerName
Require-Command "ssh"
Require-Command "scp"
Require-Command "tar"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$DistDir = Join-Path $ProjectRoot ".dist"
$ArchivePath = Join-Path $DistDir "work-report-backend.tar.gz"
$RemoteScriptLocalPath = Join-Path $DistDir "remote-deploy.sh"
$Target = "${NasUser}@${NasHost}"
$RemoteArchive = "$RemoteAppDir/work-report-backend.tar.gz"
$RemoteScriptPath = "$RemoteAppDir/.deploy-remote.sh"
$SafeControlName = "${NasUser}_${NasHost}_${SshPort}" -replace "[^a-zA-Z0-9_.-]", "_"
$SshControlPath = Join-Path $DistDir "ssh-$SafeControlName.sock"
$SshMultiplexStarted = $false
$SshBaseArgs = @("-p", $SshPort)
$ScpBaseArgs = @("-P", $SshPort)
$AppFiles = @(
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "prisma.config.ts",
  "dist",
  "src",
  "scripts",
  "prisma"
)

try {
  Set-Location $ProjectRoot
  New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

  if (-not $NoSshMultiplex) {
    Write-Host "Opening reusable SSH connection..."
    $SshBaseArgs = @(
      "-p", $SshPort,
      "-o", "ControlMaster=auto",
      "-o", "ControlPath=$SshControlPath",
      "-o", "ControlPersist=10m"
    )
    $ScpBaseArgs = @(
      "-P", $SshPort,
      "-o", "ControlMaster=auto",
      "-o", "ControlPath=$SshControlPath",
      "-o", "ControlPersist=10m"
    )

    & ssh @SshBaseArgs "-MNf" $Target
    if ($LASTEXITCODE -eq 0) {
      $SshMultiplexStarted = $true
    } else {
      Write-Warning "Could not open reusable SSH connection. Continuing without SSH multiplexing."
      $SshBaseArgs = @("-p", $SshPort)
      $ScpBaseArgs = @("-P", $SshPort)
    }
  }

  if ($Preflight) {
    Write-Host "Checking remote prerequisites..."
    $PreflightScript = @"
APP_DIR="$RemoteAppDir"
CONTAINER="$ContainerName"
DOCKER_CMD="$RemoteDockerCommand"
USE_SUDO="$($UseSudoForDocker.ToString().ToLowerInvariant())"
FAILED=0

find_docker() {
  if [ -n "`$DOCKER_CMD" ]; then
    if [ -x "`$DOCKER_CMD" ] || command -v "`$DOCKER_CMD" >/dev/null 2>&1; then
      echo "`$DOCKER_CMD"
      return 0
    fi
    return 1
  fi

  if command -v docker >/dev/null 2>&1; then
    command -v docker
    return 0
  fi

  if [ -x /usr/local/bin/docker ]; then
    echo /usr/local/bin/docker
    return 0
  fi

  return 1
}

check() {
  LABEL="`$1"
  shift
  if "`$@"; then
    echo "[OK] `$LABEL"
  else
    CODE="`$?"
    echo "[FAIL] `$LABEL" >&2
    FAILED=1
    return "`$CODE"
  fi
}

check "tar is available" command -v tar >/dev/null
check "remote app directory exists: `$APP_DIR" test -d "`$APP_DIR"
check "remote app directory is writable: `$APP_DIR" test -w "`$APP_DIR"
check "remote .env exists: `$APP_DIR/.env" test -f "`$APP_DIR/.env"

DOCKER_BIN="`$(find_docker)" || {
  echo "[FAIL] docker is available" >&2
  FAILED=1
}

if [ -n "`$DOCKER_BIN" ]; then
  echo "[OK] docker is available: `$DOCKER_BIN"
  if [ "`$USE_SUDO" = "true" ]; then
    check "sudo is available" command -v sudo >/dev/null
    check "Docker container exists and is accessible: `$CONTAINER" sudo "`$DOCKER_BIN" inspect "`$CONTAINER" >/dev/null 2>&1
  else
    check "Docker container exists and is accessible: `$CONTAINER" "`$DOCKER_BIN" inspect "`$CONTAINER" >/dev/null 2>&1
  fi
fi

if [ "`$FAILED" -ne 0 ]; then
  echo "Remote preflight failed. Fix the failed item(s), then rerun deploy." >&2
  exit 1
fi

echo "Remote preflight ok."
"@
    $PreflightScript | ssh @SshBaseArgs $Target "sh -s"
    if ($LASTEXITCODE -ne 0) {
      throw "Remote preflight failed."
    }
  }

  if (-not $SkipBuild) {
    Write-Host "Building project..."
    Run-Command "powershell" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $BuildCommand)
  }

  Remove-Item -Force -ErrorAction SilentlyContinue $ArchivePath

  Write-Host "Compressing app files..."
  $TarArgs = @(
    "--exclude=._*",
    "--exclude=.DS_Store",
    "-czf",
    $ArchivePath
  ) + $AppFiles
  Run-Command "tar" $TarArgs

  Write-Host "Uploading archive to $Target..."
  $ScpArgs = @()
  if ($LegacyScp) {
    $ScpArgs += "-O"
  }
  $ScpArgs += $ScpBaseArgs + @($ArchivePath, "${Target}:$RemoteArchive")
  & scp @ScpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to upload archive to $Target. If the remote login works but upload fails, try: npm run deploy:win -- -LegacyScp `$false"
  }

  $RemoteScript = @"
set -eu

APP_DIR="$RemoteAppDir"
ARCHIVE="$RemoteArchive"
CONTAINER="$ContainerName"
DOCKER_CMD="$RemoteDockerCommand"
USE_SUDO="$($UseSudoForDocker.ToString().ToLowerInvariant())"
STAMP=`$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=".deploy-backup"
BACKUP_PATH="`$BACKUP_DIR/app-`$STAMP"

find_docker() {
  if [ -n "`$DOCKER_CMD" ]; then
    if [ -x "`$DOCKER_CMD" ] || command -v "`$DOCKER_CMD" >/dev/null 2>&1; then
      echo "`$DOCKER_CMD"
      return 0
    fi
    return 1
  fi

  if command -v docker >/dev/null 2>&1; then
    command -v docker
    return 0
  fi

  if [ -x /usr/local/bin/docker ]; then
    echo /usr/local/bin/docker
    return 0
  fi

  return 1
}

cd "`$APP_DIR"
mkdir -p "`$BACKUP_PATH"

for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
  if [ -e "`$path" ]; then
    mv "`$path" "`$BACKUP_PATH/"
  fi
done

restore_backup() {
  for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
    rm -rf "`$path"
    if [ -e "`$BACKUP_PATH/`$path" ]; then
      mv "`$BACKUP_PATH/`$path" .
    fi
  done
}

if ! tar -xzf "`$ARCHIVE" -C "`$APP_DIR"; then
  restore_backup
  echo "Deploy failed while extracting archive. Previous app files were restored." >&2
  exit 1
fi

find prisma dist/prisma \( -name '._*' -o -name '.DS_Store' \) -type f -exec rm -f {} + 2>/dev/null || true

DOCKER_BIN="`$(find_docker)" || {
  restore_backup
  echo "Deploy failed because docker command was not found. Try passing -RemoteDockerCommand /usr/local/bin/docker if that path exists on Synology." >&2
  exit 1
}

if [ "`$USE_SUDO" = "true" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    restore_backup
    echo "Deploy failed because sudo command was not found." >&2
    exit 1
  fi

  if ! sudo "`$DOCKER_BIN" restart "`$CONTAINER"; then
    restore_backup
    echo "Deploy failed while restarting Docker container with sudo. Previous app files were restored." >&2
    exit 1
  fi
elif ! "`$DOCKER_BIN" restart "`$CONTAINER"; then
  restore_backup
  echo "Deploy failed while restarting Docker container. Previous app files were restored." >&2
  exit 1
fi

rm -f "`$ARCHIVE"
rm -f "$RemoteScriptPath"
echo "Deploy finished. Container restarted: `$CONTAINER"
"@

  [System.IO.File]::WriteAllText(
    $RemoteScriptLocalPath,
    $RemoteScript,
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-Host "Uploading remote deploy script..."
  $ScriptScpArgs = @()
  if ($LegacyScp) {
    $ScriptScpArgs += "-O"
  }
  $ScriptScpArgs += $ScpBaseArgs + @($RemoteScriptLocalPath, "${Target}:$RemoteScriptPath")
  Run-Command "scp" $ScriptScpArgs

  Write-Host "Replacing app files and restarting container..."
  $SshArgs = @()
  if ($UseSudoForDocker) {
    $SshArgs += "-tt"
  }
  $SshArgs += $SshBaseArgs + @($Target, "sh '$RemoteScriptPath'")
  Run-Command "ssh" $SshArgs

  Write-Host "Done."
} finally {
  if ($SshMultiplexStarted) {
    & ssh @SshBaseArgs "-O" "exit" $Target *> $null
  }
}
