set -eu

APP_DIR="/volume1/docker/work-report-backend"
ARCHIVE="/volume1/docker/work-report-backend/work-report-backend.tar.gz"
CONTAINER="work-report-backend"
DOCKER_CMD=""
USE_SUDO="true"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=".deploy-backup"
BACKUP_PATH="$BACKUP_DIR/app-$STAMP"

find_docker() {
  if [ -n "$DOCKER_CMD" ]; then
    if [ -x "$DOCKER_CMD" ] || command -v "$DOCKER_CMD" >/dev/null 2>&1; then
      echo "$DOCKER_CMD"
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

cd "$APP_DIR"
mkdir -p "$BACKUP_PATH"

for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
  if [ -e "$path" ]; then
    mv "$path" "$BACKUP_PATH/"
  fi
done

restore_backup() {
  for path in package.json package-lock.json tsconfig.json prisma.config.ts dist src scripts prisma; do
    rm -rf "$path"
    if [ -e "$BACKUP_PATH/$path" ]; then
      mv "$BACKUP_PATH/$path" .
    fi
  done
}

if ! tar -xzf "$ARCHIVE" -C "$APP_DIR"; then
  restore_backup
  echo "Deploy failed while extracting archive. Previous app files were restored." >&2
  exit 1
fi

find prisma dist/prisma \( -name '._*' -o -name '.DS_Store' \) -type f -exec rm -f {} + 2>/dev/null || true

DOCKER_BIN="$(find_docker)" || {
  restore_backup
  echo "Deploy failed because docker command was not found. Try passing -RemoteDockerCommand /usr/local/bin/docker if that path exists on Synology." >&2
  exit 1
}

if [ "$USE_SUDO" = "true" ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    restore_backup
    echo "Deploy failed because sudo command was not found." >&2
    exit 1
  fi

  if ! sudo "$DOCKER_BIN" restart "$CONTAINER"; then
    restore_backup
    echo "Deploy failed while restarting Docker container with sudo. Previous app files were restored." >&2
    exit 1
  fi
elif ! "$DOCKER_BIN" restart "$CONTAINER"; then
  restore_backup
  echo "Deploy failed while restarting Docker container. Previous app files were restored." >&2
  exit 1
fi

rm -f "$ARCHIVE"
rm -f "/volume1/docker/work-report-backend/.deploy-remote.sh"
echo "Deploy finished. Container restarted: $CONTAINER"
