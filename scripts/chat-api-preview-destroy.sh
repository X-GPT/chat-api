#!/usr/bin/env bash
set -euo pipefail
set -x

BRANCH_SLUG="$1"
REPO_SLUG="${2:-chat-api}" # repository identifier to avoid conflicts

# Should add validation like in preview-deploy.sh:
if [[ ! "$BRANCH_SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "Error: BRANCH_SLUG must match ^[a-z0-9-]+$ (got: '$BRANCH_SLUG')" >&2
  exit 1
fi

CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG"
CONF="/etc/nginx/conf.d/api-preview-$REPO_SLUG-$BRANCH_SLUG.conf"
STATE_DIR="/var/preview/$REPO_SLUG/$BRANCH_SLUG"

echo "Removing container: $CONTAINER"
sudo docker rm -f "$CONTAINER" || echo "Container not found"

if sudo docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "Warning: Container $CONTAINER still exists after removal attempt"
  sudo docker ps -a --filter "name=$CONTAINER" --format "table {{.Names}}\t{{.Status}}"
fi

echo "Removing Nginx configuration: $CONF"
sudo rm -f "$CONF"

if [[ -f "$CONF" ]]; then
  echo "Warning: Nginx config $CONF still exists after removal"
fi

echo "Testing Nginx configuration"
sudo nginx -t && sudo systemctl reload nginx

echo "Removing state directory: $STATE_DIR"
sudo rm -rf "$STATE_DIR" || true

echo "Preview environment destroyed"
