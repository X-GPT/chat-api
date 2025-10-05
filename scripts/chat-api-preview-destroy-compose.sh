#!/usr/bin/env bash
set -euo pipefail
set -x

BRANCH_SLUG="$1"
REPO_SLUG="${2:-chat-api}" # repository identifier to avoid conflicts

# Validation
if [[ ! "$BRANCH_SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "Error: BRANCH_SLUG must match ^[a-z0-9-]+$ (got: '$BRANCH_SLUG')" >&2
  exit 1
fi

PROJECT_NAME="preview-$REPO_SLUG-$BRANCH_SLUG"
# Use absolute path to compose file in shared location
COMPOSE_FILE="/etc/mymemo/chat-api/compose.preview.yaml"
CONF="/etc/nginx/conf.d/$REPO_SLUG-$BRANCH_SLUG.conf"
STATE_DIR="/var/preview/$REPO_SLUG/$BRANCH_SLUG"

# Export variables for compose (needed for variable substitution in compose file)
export REPO_SLUG
export BRANCH_SLUG
export API_IMAGE="placeholder"  # Not used during down, but may be required by compose
export RAG_API_IMAGE="placeholder"
export RAG_WORKER_IMAGE="placeholder"
export CONTAINER_PORT="3000"

echo "Stopping and removing containers via docker compose"
sudo -n API_IMAGE="$API_IMAGE" RAG_API_IMAGE="$RAG_API_IMAGE" RAG_WORKER_IMAGE="$RAG_WORKER_IMAGE" CONTAINER_PORT="$CONTAINER_PORT" REPO_SLUG="$REPO_SLUG" BRANCH_SLUG="$BRANCH_SLUG" \
  docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down -v || echo "Compose project not found or already removed"

# Double-check containers are gone
API_CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG-api"
RAG_API_CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG-rag-api"
RAG_WORKER_CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG-rag-worker"

if sudo -n docker ps -a --format '{{.Names}}' | grep -q "^$API_CONTAINER$"; then
  echo "Warning: API container $API_CONTAINER still exists, forcing removal"
  sudo -n docker rm -f "$API_CONTAINER" || true
fi

if sudo -n docker ps -a --format '{{.Names}}' | grep -q "^$RAG_API_CONTAINER$"; then
  echo "Warning: RAG API container $RAG_API_CONTAINER still exists, forcing removal"
  sudo -n docker rm -f "$RAG_API_CONTAINER" || true
fi

if sudo -n docker ps -a --format '{{.Names}}' | grep -q "^$RAG_WORKER_CONTAINER$"; then
  echo "Warning: RAG worker container $RAG_WORKER_CONTAINER still exists, forcing removal"
  sudo -n docker rm -f "$RAG_WORKER_CONTAINER" || true
fi

echo "Removing Nginx configuration: $CONF"
sudo -n rm -f "$CONF"

if [[ -f "$CONF" ]]; then
  echo "Warning: Nginx config $CONF still exists after removal"
fi

echo "Testing Nginx configuration"
sudo -n nginx -t && sudo -n systemctl reload nginx

echo "Removing state directory: $STATE_DIR"
sudo -n rm -rf "$STATE_DIR" || true

echo "========================================="
echo "Preview environment destroyed"
echo "Project: $PROJECT_NAME"
echo "Containers removed:"
echo "  - $API_CONTAINER"
echo "  - $RAG_API_CONTAINER"
echo "  - $RAG_WORKER_CONTAINER"
echo "========================================="

