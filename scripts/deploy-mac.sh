#!/usr/bin/env bash
set -euo pipefail

NAS_HOST="hz.jc-times.com"
SSH_PORT="24"
NAS_USER="zzzsaft"
REMOTE_APP_DIR="/volume1/docker/work-report-backend"
CONTAINER_NAME="work-report-backend"
BUILD_COMMAND="npm run prisma:generate && npm run build"
REMOTE_DOCKER_COMMAND=""
SKIP_BUILD="false"
PREFLIGHT="false"
LEGACY_SCP="true"
USE_SUDO_FOR_DOCKER="true"
NO_SSH_MULTIPLEX="false"

usage() {
  cat <<'EOF'
Usage: npm run deploy:mac -- [options]

Options:
  -NasHost, --NasHost VALUE
  -SshPort, --SshPort VALUE
  -NasUser, --NasUser VALUE
  -RemoteAppDir, --RemoteAppDir VALUE
  -ContainerName, --ContainerName VALUE
  -BuildCommand, --BuildCommand VALUE
  -RemoteDockerCommand, --RemoteDockerCommand VALUE
  -SkipBuild, --SkipBuild
  -Preflight, --Preflight
  -LegacyScp, --LegacyScp VALUE               true or false, default true
  -UseSudoForDocker, --UseSudoForDocker VALUE true or false, default true
  -NoSshMultiplex, --NoSshMultiplex
  -Help, --help
EOF
}

require_value() {
  local name="$1"
  local value="$2"
  if [[ -z "${value// }" ]]; then
    echo "Missing $name. Edit scripts/deploy-mac.sh or pass -$name when running deploy." >&2
    exit 1
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Command '$name' was not found. Install/enable it first and try again." >&2
    exit 1
  fi
}

read_value() {
  local option="$1"
  if [[ $# -lt 2 || "$2" == -* ]]; then
    echo "Missing value for $option." >&2
    exit 1
  fi
  printf '%s' "$2"
}

normalize_bool() {
  local option="$1"
  local value="$2"
  local lower_value
  lower_value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$lower_value" in
    true|1|yes|y) printf 'true' ;;
    false|0|no|n) printf 'false' ;;
    *)
      echo "Invalid boolean for $option: $value. Use true or false." >&2
      exit 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -LegacyScp:*|--LegacyScp=*)
      LEGACY_SCP="$(normalize_bool "${1%%[:=]*}" "${1#*[:=]}")"
      shift
      ;;
    -UseSudoForDocker:*|--UseSudoForDocker=*)
      USE_SUDO_FOR_DOCKER="$(normalize_bool "${1%%[:=]*}" "${1#*[:=]}")"
      shift
      ;;
    -NasHost|--NasHost)
      NAS_HOST="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -SshPort|--SshPort)
      SSH_PORT="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -NasUser|--NasUser)
      NAS_USER="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -RemoteAppDir|--RemoteAppDir)
      REMOTE_APP_DIR="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -ContainerName|--ContainerName)
      CONTAINER_NAME="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -BuildCommand|--BuildCommand)
      BUILD_COMMAND="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -RemoteDockerCommand|--RemoteDockerCommand)
      REMOTE_DOCKER_COMMAND="$(read_value "$1" "${2-}")"
      shift 2
      ;;
    -SkipBuild|--SkipBuild)
      SKIP_BUILD="true"
      shift
      ;;
    -Preflight|--Preflight)
      PREFLIGHT="true"
      shift
      ;;
    -LegacyScp|--LegacyScp)
      if [[ $# -ge 2 && "$2" != -* ]]; then
        LEGACY_SCP="$(normalize_bool "$1" "$2")"
        shift 2
      else
        LEGACY_SCP="true"
        shift
      fi
      ;;
    -UseSudoForDocker|--UseSudoForDocker)
      if [[ $# -ge 2 && "$2" != -* ]]; then
        USE_SUDO_FOR_DOCKER="$(normalize_bool "$1" "$2")"
        shift 2
      else
        USE_SUDO_FOR_DOCKER="true"
        shift
      fi
      ;;
    -NoSshMultiplex|--NoSshMultiplex)
      NO_SSH_MULTIPLEX="true"
      shift
      ;;
    -Help|--help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_value "NasHost" "$NAS_HOST"
require_value "NasUser" "$NAS_USER"
require_value "RemoteAppDir" "$REMOTE_APP_DIR"
require_value "ContainerName" "$CONTAINER_NAME"
require_command "ssh"
require_command "scp"
require_command "tar"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/.dist"
ARCHIVE_PATH="$DIST_DIR/work-report-backend.tar.gz"
REMOTE_SCRIPT_LOCAL_PATH="$DIST_DIR/remote-deploy.sh"
TARGET="${NAS_USER}@${NAS_HOST}"
REMOTE_ARCHIVE="$REMOTE_APP_DIR/work-report-backend.tar.gz"
REMOTE_SCRIPT_PATH="$REMOTE_APP_DIR/.deploy-remote.sh"
SAFE_CONTROL_NAME="$(printf '%s_%s_%s' "$NAS_USER" "$NAS_HOST" "$SSH_PORT" | sed 's/[^a-zA-Z0-9_.-]/_/g')"
SSH_CONTROL_PATH="$DIST_DIR/ssh-$SAFE_CONTROL_NAME.sock"
SSH_MULTIPLEX_STARTED="false"
SSH_BASE_ARGS=(-p "$SSH_PORT")
SCP_BASE_ARGS=(-P "$SSH_PORT")
APP_FILES=(
  package.json
  package-lock.json
  tsconfig.json
  prisma.config.ts
  dist
  src
  scripts
  prisma
)

cleanup() {
  if [[ "$SSH_MULTIPLEX_STARTED" == "true" ]]; then
    ssh "${SSH_BASE_ARGS[@]}" -O exit "$TARGET" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$PROJECT_ROOT"
mkdir -p "$DIST_DIR"

if [[ "$NO_SSH_MULTIPLEX" != "true" ]]; then
  echo "Opening reusable SSH connection..."
  SSH_BASE_ARGS=(
    -p "$SSH_PORT"
    -o "ControlMaster=auto"
    -o "ControlPath=$SSH_CONTROL_PATH"
    -o "ControlPersist=10m"
  )
  SCP_BASE_ARGS=(
    -P "$SSH_PORT"
    -o "ControlMaster=auto"
    -o "ControlPath=$SSH_CONTROL_PATH"
    -o "ControlPersist=10m"
  )

  if ssh "${SSH_BASE_ARGS[@]}" -MNf "$TARGET"; then
    SSH_MULTIPLEX_STARTED="true"
  else
    echo "Warning: Could not open reusable SSH connection. Continuing without SSH multiplexing." >&2
    SSH_BASE_ARGS=(-p "$SSH_PORT")
    SCP_BASE_ARGS=(-P "$SSH_PORT")
  fi
fi

if [[ "$PREFLIGHT" == "true" ]]; then
  echo "Checking remote prerequisites..."
  ssh "${SSH_BASE_ARGS[@]}" "$TARGET" "sh -s" <<EOF
APP_DIR="$REMOTE_APP_DIR"
CONTAINER="$CONTAINER_NAME"
DOCKER_CMD="$REMOTE_DOCKER_COMMAND"
USE_SUDO="$USE_SUDO_FOR_DOCKER"
FAILED=0

find_docker() {
  if [ -n "\$DOCKER_CMD" ]; then
    if [ -x "\$DOCKER_CMD" ] || command -v "\$DOCKER_CMD" >/dev/null 2>&1; then
      echo "\$DOCKER_CMD"
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
  LABEL="\$1"
  shift
  if "\$@"; then
    echo "[OK] \$LABEL"
  else
    CODE="\$?"
    echo "[FAIL] \$LABEL" >&2
    FAILED=1
    return "\$CODE"
  fi
}

check "tar is available" command -v tar >/dev/null
check "remote app directory exists: \$APP_DIR" test -d "\$APP_DIR"
check "remote app directory is writable: \$APP_DIR" test -w "\$APP_DIR"
check "remote .env exists: \$APP_DIR/.env" test -f "\$APP_DIR/.env"

DOCKER_BIN="\$(find_docker)" || {
  echo "[FAIL] docker is available" >&2
  FAILED=1
}

if [ -n "\$DOCKER_BIN" ]; then
  echo "[OK] docker is available: \$DOCKER_BIN"
  if [ "\$USE_SUDO" = "true" ]; then
    check "sudo is available" command -v sudo >/dev/null
    check "Docker container exists and is accessible: \$CONTAINER" sudo "\$DOCKER_BIN" inspect "\$CONTAINER" >/dev/null 2>&1
  else
    check "Docker container exists and is accessible: \$CONTAINER" "\$DOCKER_BIN" inspect "\$CONTAINER" >/dev/null 2>&1
  fi
fi

if [ "\$FAILED" -ne 0 ]; then
  echo "Remote preflight failed. Fix the failed item(s), then rerun deploy." >&2
  exit 1
fi

echo "Remote preflight ok."
EOF
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  echo "Building project..."
  bash -lc "$BUILD_COMMAND"
fi

rm -f "$ARCHIVE_PATH"

echo "Compressing app files..."
COPYFILE_DISABLE=1 tar --no-xattrs \
  --exclude='._*' \
  --exclude='.DS_Store' \
  -czf "$ARCHIVE_PATH" "${APP_FILES[@]}"

echo "Uploading archive to $TARGET..."
SCP_ARGS=()
if [[ "$LEGACY_SCP" == "true" ]]; then
  SCP_ARGS+=(-O)
fi
SCP_ARGS+=("${SCP_BASE_ARGS[@]}" "$ARCHIVE_PATH" "${TARGET}:$REMOTE_ARCHIVE")
if ! scp "${SCP_ARGS[@]}"; then
  echo "Failed to upload archive to $TARGET. If the remote login works but upload fails, try: npm run deploy:mac -- -LegacyScp false" >&2
  exit 1
fi

cat > "$REMOTE_SCRIPT_LOCAL_PATH" <<EOF
set -eu

APP_DIR="$REMOTE_APP_DIR"
ARCHIVE="$REMOTE_ARCHIVE"
CONTAINER="$CONTAINER_NAME"
DOCKER_CMD="$REMOTE_DOCKER_COMMAND"
USE_SUDO="$USE_SUDO_FOR_DOCKER"
STAMP=\$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=".deploy-backup"
BACKUP_PATH="\$BACKUP_DIR/app-\$STAMP"

find_docker() {
  if [ -n "\$DOCKER_CMD" ]; then
    if [ -x "\$DOCKER_CMD" ] || command -v "\$DOCKER_CMD" >/dev/null 2>&1; then
      echo "\$DOCKER_CMD"
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

cd "\$APP_DIR"
mkdir -p "\$BACKUP_PATH"

for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
  if [ -e "\$path" ]; then
    mv "\$path" "\$BACKUP_PATH/"
  fi
done

restore_backup() {
  for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
    rm -rf "\$path"
    if [ -e "\$BACKUP_PATH/\$path" ]; then
      mv "\$BACKUP_PATH/\$path" .
    fi
  done
}

if ! tar -xzf "\$ARCHIVE" -C "\$APP_DIR"; then
  restore_backup
  echo "Deploy failed while extracting archive. Previous app files were restored." >&2
  exit 1
fi

find prisma dist/prisma \( -name '._*' -o -name '.DS_Store' \) -type f -exec rm -f {} + 2>/dev/null || true

DOCKER_BIN="\$(find_docker)" || {
  restore_backup
  echo "Deploy failed because docker command was not found. Try passing -RemoteDockerCommand /usr/local/bin/docker if that path exists on Synology." >&2
  exit 1
}

if [ "\$USE_SUDO" = "true" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    restore_backup
    echo "Deploy failed because sudo command was not found." >&2
    exit 1
  fi

  if ! sudo "\$DOCKER_BIN" restart "\$CONTAINER"; then
    restore_backup
    echo "Deploy failed while restarting Docker container with sudo. Previous app files were restored." >&2
    exit 1
  fi
elif ! "\$DOCKER_BIN" restart "\$CONTAINER"; then
  restore_backup
  echo "Deploy failed while restarting Docker container. Previous app files were restored." >&2
  exit 1
fi

rm -f "\$ARCHIVE"
rm -f "$REMOTE_SCRIPT_PATH"
echo "Deploy finished. Container restarted: \$CONTAINER"
EOF

echo "Uploading remote deploy script..."
SCRIPT_SCP_ARGS=()
if [[ "$LEGACY_SCP" == "true" ]]; then
  SCRIPT_SCP_ARGS+=(-O)
fi
SCRIPT_SCP_ARGS+=("${SCP_BASE_ARGS[@]}" "$REMOTE_SCRIPT_LOCAL_PATH" "${TARGET}:$REMOTE_SCRIPT_PATH")
if ! scp "${SCRIPT_SCP_ARGS[@]}"; then
  echo "Failed to upload remote deploy script to $TARGET." >&2
  exit 1
fi

echo "Replacing app files and restarting container..."
SSH_ARGS=()
if [[ "$USE_SUDO_FOR_DOCKER" == "true" ]]; then
  SSH_ARGS+=(-tt)
fi
SSH_ARGS+=("${SSH_BASE_ARGS[@]}" "$TARGET" "sh '$REMOTE_SCRIPT_PATH'")
if ! ssh "${SSH_ARGS[@]}"; then
  echo "Remote deploy failed." >&2
  exit 1
fi

echo "Done."
