#!/usr/bin/env bash
set -euo pipefail
# Enable debug mode to see exactly which commands are running
set -x

BRANCH_SLUG="$1"         # e.g. "pr-123" (lowercase, non-alnum -> '-')
IMAGE="$2"               # full ECR image ref for API
WORKER_IMAGE="${3:-$2}"  # full ECR image ref for worker (defaults to same as API, but should be different)
CONTAINER_PORT="${4:-3000}"
REPO_SLUG="${5:-chat-api}" # repository identifier to avoid conflicts

# Sanitize/validate the slug (lowercase letters, digits, dash)
if [[ ! "$BRANCH_SLUG" =~ ^[a-z0-9-]+$ ]]; then
  echo "Error: BRANCH_SLUG must match ^[a-z0-9-]+$ (got: '$BRANCH_SLUG')" >&2
  exit 1
fi

STATE_DIR="/var/preview/$REPO_SLUG/$BRANCH_SLUG"
PORT_FILE="$STATE_DIR/port"

# Nginx conf.d layout
NGINX_DIR="/etc/nginx/conf.d"
NGINX_TEMPLATES_DIR="/etc/nginx/templates/chat-api"
API_CONF="${API_CONF:-$NGINX_DIR/$REPO_SLUG-$BRANCH_SLUG.conf}"
API_TEMPLATE="${API_TEMPLATE:-$NGINX_TEMPLATES_DIR/chat-api-preview-template.conf}"

echo "Creating state directory: $STATE_DIR"
sudo -n mkdir -p "$STATE_DIR" || { echo "Failed to create state directory"; exit 1; }

API_CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG-api"
WORKER_CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG-worker"
PROJECT_NAME="preview-$REPO_SLUG-$BRANCH_SLUG"
# Use absolute path to compose file in shared location
COMPOSE_FILE="/etc/mymemo/chat-api/compose.preview.yaml"

# Export variables for docker compose
export REPO_SLUG
export BRANCH_SLUG
export IMAGE
export WORKER_IMAGE
export CONTAINER_PORT

echo "Pulling Docker images..."
sudo -n docker pull "$IMAGE" || { echo "Failed to pull API image"; exit 1; }
sudo -n docker pull "$WORKER_IMAGE" || { echo "Failed to pull worker image"; exit 1; }

echo "Stopping existing compose project if any"
sudo -n docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down || true

echo "Starting new container via docker compose"
sudo -n docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d || {
  echo "Failed to start Docker container via compose";
  exit 1;
}

# Robust, deterministic port extraction
echo "Getting Docker container port mapping for API"
PORT="$(sudo -n docker port "$API_CONTAINER" "${CONTAINER_PORT}/tcp" | head -n1 | awk -F: '{print $NF}')" \
  || { echo "Failed to get container port"; exit 1; }

# Validate discovered port
if [[ -z "${PORT:-}" || ! "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Failed to parse mapped host port (got: '$PORT')" >&2
  sudo -n docker logs "$API_CONTAINER" || true
  exit 1
fi

echo "Container is mapped to port: $PORT"
echo "$PORT" | sudo -n tee "$PORT_FILE" >/dev/null || { echo "Failed to write port file"; exit 1; }

# Brief readiness probe so nginx doesn't route to an unopened socket
echo "Waiting for API service to listen on 127.0.0.1:$PORT"
READY=0
for i in {1..30}; do
  if (echo >/dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" -ne 1 ]]; then
  echo "Error: API service did not become available on 127.0.0.1:$PORT after 30 attempts" >&2
  sudo -n docker logs "$API_CONTAINER" || true
  echo "Worker logs:" >&2
  sudo -n docker logs "$WORKER_CONTAINER" || true
  exit 1
fi

# Verify worker is running
echo "Verifying worker container is running"
if ! sudo -n docker ps --format '{{.Names}}' | grep -q "^$WORKER_CONTAINER$"; then
  echo "Warning: Worker container is not running" >&2
  sudo -n docker logs "$WORKER_CONTAINER" || true
fi

# Generate Nginx API config via sed + tee (no root redirection needed)
echo "Generating Nginx API configuration from template: $API_TEMPLATE"
sed -e "s/__SERVER_NAME__/${REPO_SLUG}-${BRANCH_SLUG}.preview.mymemo.ai/g" \
    -e "s/__PORT__/${PORT}/g" \
    "$API_TEMPLATE" | sudo -n tee "$API_CONF" >/dev/null || { echo "Failed to generate Nginx API config"; exit 1; }

echo "Testing Nginx configuration"
sudo -n nginx -t || { echo "Nginx configuration test failed"; exit 1; }

echo "Reloading Nginx"
sudo -n systemctl reload nginx || { echo "Failed to reload Nginx"; exit 1; }

echo "========================================="
echo "Deployment successful!"
echo "API: https://${REPO_SLUG}-${BRANCH_SLUG}.preview.mymemo.ai"
echo "Containers:"
echo "  - $API_CONTAINER (port $PORT)"
echo "  - $WORKER_CONTAINER"
echo "========================================="

