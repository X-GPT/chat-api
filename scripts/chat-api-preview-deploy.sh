#!/usr/bin/env bash
set -euo pipefail
# Enable debug mode to see exactly which commands are running
set -x

BRANCH_SLUG="$1"         # e.g. "pr-123" (lowercase, non-alnum -> '-')
IMAGE="$2"               # full ECR image ref
CONTAINER_PORT="${3:-3000}"
REPO_SLUG="${4:-chat-api}" # repository identifier to avoid conflicts

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

CONTAINER="preview-$REPO_SLUG-$BRANCH_SLUG"

echo "Pulling Docker image: $IMAGE"
sudo -n docker pull "$IMAGE" || { echo "Failed to pull Docker image"; exit 1; }

echo "Checking for existing container: $CONTAINER"
if sudo -n docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "Removing existing container: $CONTAINER"
  sudo -n docker rm -f "$CONTAINER" || true
fi

echo "Starting new container: $CONTAINER"
sudo -n docker run -d --name "$CONTAINER" \
  --restart unless-stopped \
  --env-file /etc/mymemo/chat-api/env.dev \
  -e NODE_ENV=production \
  -p ":${CONTAINER_PORT}" \
	--add-host=host.docker.internal:host-gateway \
  --memory=1g \
  --memory-reservation=512m \
  --memory-swap=2g \
	--log-driver=awslogs \
	--log-opt awslogs-region=us-west-2 \
	--log-opt awslogs-group=/apps/chat-api-preview \
	--log-opt awslogs-stream=ec2-{{$PR_NUMBER}} \
	--log-opt awslogs-create-group=true \

  "$IMAGE" || { echo "Failed to start Docker container"; exit 1; }

# Robust, deterministic port extraction
echo "Getting Docker container port mapping"
PORT="$(sudo -n docker port "$CONTAINER" "${CONTAINER_PORT}/tcp" | head -n1 | awk -F: '{print $NF}')" \
  || { echo "Failed to get container port"; exit 1; }

# Validate discovered port
if [[ -z "${PORT:-}" || ! "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Failed to parse mapped host port (got: '$PORT')" >&2
  sudo -n docker logs "$CONTAINER" || true
  exit 1
fi

echo "Container is mapped to port: $PORT"
echo "$PORT" | sudo -n tee "$PORT_FILE" >/dev/null || { echo "Failed to write port file"; exit 1; }

# Brief readiness probe so nginx doesn't route to an unopened socket
echo "Waiting for service to listen on 127.0.0.1:$PORT"
READY=0
for i in {1..30}; do
  if (echo >/dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" -ne 1 ]]; then
  echo "Error: Service did not become available on 127.0.0.1:$PORT after 30 attempts" >&2
  sudo -n docker logs "$CONTAINER" || true
  exit 1
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

echo "API deployment successful: https://${REPO_SLUG}-${BRANCH_SLUG}.preview.mymemo.ai"
