# Preview Environment Deployment

This document describes the preview environment deployment system for the chat-api project.

## Overview

The preview deployment system automatically creates isolated preview environments for each pull request, allowing you to test changes before merging them into the main branch.

### What gets deployed:
- **API Preview**: Your chat-api service accessible at `https://chat-api-pr-{PR_NUMBER}.preview.mymemo.ai`
- **Worker Preview**: Background worker service for processing async tasks (ingest-worker)

## How it works

1. **Automatic Triggers**: When you create, update, or sync a pull request
2. **Build & Push**: Builds two Docker images (API and Worker) and pushes them to AWS ECR with PR-specific tags
3. **Deploy**: Uses Docker Compose to deploy both containers to EC2 and configures nginx routing
4. **Cleanup**: Automatically destroys the preview environment (both containers) when the PR is closed

## Setup Requirements

### GitHub Secrets

Add these secrets to your GitHub repository:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS access key for ECR and EC2 access | `AKIA...` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `xyz123...` |
| `EC2_SSH_KEY` | Private SSH key for EC2 deployment server | `-----BEGIN OPENSSH PRIVATE KEY-----...` |

### EC2 Server Setup

The deployment server needs the following prerequisites:

1. **Docker and Docker Compose installed and running**
2. **AWS CLI configured** with ECR access
3. **Nginx installed and running**
4. **User `deploy` with sudo privileges and passwordless sudo**
5. **SSH access configured**
6. **CloudWatch Logs agent configured** (for container logging)

#### Server Configuration

```bash
# Install dependencies
sudo apt update
sudo apt install -y docker.io docker-compose nginx awscli

# Add deploy user to docker group
sudo usermod -aG docker deploy

# Enable nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Create required directories
sudo mkdir -p /etc/nginx/templates/chat-api
sudo mkdir -p /etc/mymemo/chat-api
sudo mkdir -p /var/preview

# Create environment file for preview deployments
# This should contain all required environment variables
sudo touch /etc/mymemo/chat-api/env.dev
sudo chmod 644 /etc/mymemo/chat-api/env.dev
```

### Domain Configuration

Ensure these DNS records point to your EC2 server:
- `*.preview.mymemo.ai` → Your EC2 server IP

## Workflow Files

### `.github/workflows/deploy-preview.yml`
Main workflow that orchestrates the deployment process with three jobs:
- **build-and-push**: Builds and pushes both API and worker Docker images to ECR with caching
- **deploy-preview**: Deploys the preview environment when PR is opened/updated
- **destroy-preview**: Cleans up the preview environment when PR is closed

### `compose.preview.yaml`
Docker Compose configuration that defines:
- **chat-api** service: API container with automatic port mapping
- **ingest-worker** service: Background worker container
- Both services configured with CloudWatch Logs, memory limits, and shared environment file

### `scripts/chat-api-preview-deploy-compose.sh`
Deployment script that:
- Pulls both Docker images (API and worker) from ECR
- Uses Docker Compose to manage the multi-container environment
- Extracts the dynamically assigned port for the API container
- Stores deployment state in `/var/preview/{REPO_SLUG}/{BRANCH_SLUG}/`
- Configures nginx reverse proxy via template substitution
- Includes comprehensive health checks for both API and worker containers
- Installs scripts to `/usr/local/bin/` and configs to `/etc/mymemo/chat-api/`

### `scripts/chat-api-preview-destroy-compose.sh`
Cleanup script that:
- Stops and removes both Docker containers via Docker Compose
- Removes nginx configuration from `/etc/nginx/conf.d/`
- Cleans up state directory
- Performs verification checks

### `infra/nginx/templates/chat-api-preview-template.conf`
Nginx configuration template using placeholder substitution (`__SERVER_NAME__`, `__PORT__`) for dynamic preview environment setup. Includes:
- Auth subrequest pattern for `/beta-api/chat/v2/` endpoints
- WebSocket support with connection upgrade handling
- Custom error handling for auth failures (401, 403, 5xx)
- Identity header injection (X-Member-Code, X-Team-Code, X-Member-Auth)

## Usage

### Automatic Deployment

1. **Create or update a pull request**
   - The workflow automatically triggers for all PRs (opened, synchronize, reopened)

2. **The workflow will automatically:**
   - Build and push Docker images for both API and worker to ECR
   - Deploy both containers to the preview environment using Docker Compose
   - Comment on the PR with the preview URL

3. **When you close the PR:**
   - The preview environment is automatically destroyed
   - Both containers are stopped and removed
   - Nginx configuration is cleaned up

### Concurrency Control

The workflow uses concurrency groups to ensure only one deployment per PR runs at a time. If you push new commits while a deployment is in progress, the old deployment is cancelled automatically.

## Preview URLs

For PR #123, your preview will be available at:
- **API**: `https://chat-api-pr-123.preview.mymemo.ai`

## Monitoring and Debugging

### Check Deployment Status

View the GitHub Actions logs to see deployment progress and any errors.

### Server-side Debugging

SSH to the EC2 server and check:

```bash
# Check running containers (both API and worker)
sudo docker ps --filter "name=preview-chat-api-"

# Check container logs
sudo docker logs preview-chat-api-pr-123-api
sudo docker logs preview-chat-api-pr-123-worker

# Or use docker-compose
sudo docker-compose -f /etc/mymemo/chat-api/compose.preview.yaml \
  -p preview-chat-api-pr-123 logs

# Check CloudWatch Logs (if configured)
# Logs are streamed to: /apps/chat-api-preview
# Stream names: ec2-pr-{NUMBER}-api and ec2-pr-{NUMBER}-worker

# Check deployment state
ls -la /var/preview/chat-api/pr-123/
cat /var/preview/chat-api/pr-123/port

# Check nginx configuration
sudo nginx -t
ls -la /etc/nginx/conf.d/chat-api-pr-*

# Check nginx logs
sudo tail -f /var/log/nginx/chat-api-pr-123.preview.mymemo.ai.access.log
sudo tail -f /var/log/nginx/chat-api-pr-123.preview.mymemo.ai.error.log
```

### Container Health

The deployment script includes comprehensive health checks:
- Both containers start successfully with Docker Compose
- API container has proper port mapping and TCP connectivity
- Worker container is running and healthy
- Application responds to TCP connection tests on the mapped port
- Nginx configuration validates successfully
- End-to-end HTTP proxy verification

## Security

- All preview environments are isolated from each other
- Each environment uses a unique port and domain
- CORS is configured for API access
- Security headers are applied via nginx

## Resource Cleanup

- Docker containers (API and worker) are automatically removed when PRs are closed
- Docker Compose volumes are removed during cleanup (`-v` flag)
- Unused Docker images are cleaned up periodically
- Nginx configurations are removed on cleanup

## Troubleshooting

### Common Issues

1. **Containers fail to start**
   - Check Docker images availability: `sudo docker pull <image>`
   - Verify memory constraints are appropriate (1GB limit, 512MB reservation)
   - Check compose logs: `sudo docker-compose -f /etc/mymemo/chat-api/compose.preview.yaml -p preview-chat-api-pr-<number> logs`
   - Check individual container logs: `sudo docker logs preview-chat-api-pr-<number>-api`

2. **Worker container not running**
   - Check worker logs: `sudo docker logs preview-chat-api-pr-<number>-worker`
   - Verify environment file exists: `cat /etc/mymemo/chat-api/env.dev`
   - Check worker container status: `sudo docker ps -a --filter "name=preview-chat-api-pr-<number>-worker"`

3. **Port extraction fails**
   - Verify Docker port mapping: `sudo docker port preview-chat-api-pr-<number>-api`
   - Check if API container is actually running and listening
   - Ensure no conflicts with existing containers
   - Verify compose file has correct port configuration

4. **Nginx configuration test fails**
   - Verify template file exists: `ls /etc/nginx/templates/chat-api/chat-api-preview-template.conf`
   - Check placeholder substitution in generated config: `cat /etc/nginx/conf.d/chat-api-pr-<number>.conf`
   - Validate nginx syntax: `sudo nginx -t`
   - Check for auth endpoint availability at `/beta-api/_auth`

5. **Health check timeout**
   - Check if application starts correctly on port 3000 inside container
   - Verify TCP connectivity to mapped port: `telnet localhost <port>`
   - Check container networking: `sudo docker network inspect bridge`
   - Increase health check timeout if needed (currently 30 seconds)

6. **State directory issues**
   - Ensure `/var/preview` directory exists and is writable
   - Check permissions: `sudo ls -la /var/preview/`
   - Verify subdirectories: `ls -la /var/preview/chat-api/`

7. **CloudWatch Logs not appearing**
   - Verify AWS credentials are configured on EC2 instance
   - Check CloudWatch Logs group exists: `/apps/chat-api-preview`
   - Verify Docker logging driver is properly configured
   - Check awslogs plugin is available: `sudo docker plugin ls`

### Manual Cleanup

If automatic cleanup fails:

```bash
# Stop and remove all preview containers using Docker Compose
# For a specific PR:
sudo docker-compose -f /etc/mymemo/chat-api/compose.preview.yaml \
  -p preview-chat-api-pr-<number> down -v

# Stop and remove all preview containers manually
sudo docker ps -a --filter "name=preview-chat-api-" -q | xargs -r sudo docker stop
sudo docker ps -a --filter "name=preview-chat-api-" -q | xargs -r sudo docker rm

# Remove nginx configurations
sudo rm -f /etc/nginx/conf.d/chat-api-pr-*.conf
sudo nginx -t && sudo systemctl reload nginx

# Clean up state directories
sudo rm -rf /var/preview/chat-api/

# Remove any dangling images
sudo docker image prune -f

# Clean up old ECR images (optional)
aws ecr list-images --repository-name chat-api --region us-west-2 \
  --filter "tagStatus=UNTAGGED" \
  --query 'imageIds[*]' --output json | \
  jq -r '.[] | "\(.imageDigest)"' | \
  xargs -I {} aws ecr batch-delete-image \
    --repository-name chat-api \
    --region us-west-2 \
    --image-ids imageDigest={}
```
