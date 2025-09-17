# Preview Environment Deployment

This document describes the preview environment deployment system for the chat-api project.

## Overview

The preview deployment system automatically creates isolated preview environments for each pull request, allowing you to test changes before merging them into the main branch.

### What gets deployed:
- **API Preview**: Your chat-api service accessible at `https://chat-api-pr-{PR_NUMBER}.preview.mymemo.ai`

## How it works

1. **Automatic Triggers**: When you create, update, or sync a pull request that changes relevant files
2. **Build & Push**: Builds a Docker image and pushes it to AWS ECR
3. **Deploy**: Deploys the container to EC2 and configures nginx routing
4. **Cleanup**: Automatically destroys the preview environment when the PR is closed

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

1. **Docker installed and running**
2. **AWS CLI configured** with ECR access
3. **Nginx installed and running**
4. **User `deploy` with sudo privileges**
5. **SSH access configured**

#### Server Configuration

```bash
# Install dependencies
sudo apt update
sudo apt install -y docker.io nginx awscli

# Add deploy user to docker group
sudo usermod -aG docker deploy

# Enable nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Create required directories
sudo mkdir -p /etc/nginx/templates/chat-api
sudo mkdir -p /var/preview
```

### Domain Configuration

Ensure these DNS records point to your EC2 server:
- `*.preview.mymemo.ai` → Your EC2 server IP

## Workflow Files

### `.github/workflows/deploy-preview.yml`
Main workflow that orchestrates the deployment process.

### `scripts/chat-api-preview-deploy.sh`
Deployment script that:
- Pulls the Docker image from ECR
- Runs the container with automatic port assignment
- Stores deployment state in `/var/preview/`
- Configures nginx reverse proxy via template substitution
- Includes comprehensive health checks and validation

### `scripts/chat-api-preview-destroy.sh`
Cleanup script that:
- Stops and removes the Docker container
- Removes nginx configuration from conf.d
- Cleans up state directory
- Performs verification checks

### `infra/nginx/templates/chat-api-preview-template.conf`
Nginx configuration template using placeholder substitution (`__SERVER_NAME__`, `__PORT__`) for dynamic preview environment setup. Includes auth subrequest pattern for `/beta-api/chat` endpoints.

## Usage

### Automatic Deployment

1. Create a pull request with changes to:
   - `src/**` (source code)
   - `package.json` (dependencies)
   - `bun.lock` (lock file)
   - `Dockerfile` (container config)
   - `compose.yaml` (compose config)
   - `.github/workflows/deploy-preview.yml` (workflow itself)

2. The workflow will automatically:
   - Build and push a Docker image
   - Deploy to the preview environment
   - Comment on the PR with the preview URL

3. When you close the PR, the preview environment is automatically destroyed.

### Manual Deployment

You can manually trigger a deployment using the GitHub Actions interface:

1. Go to Actions → Deploy Preview Environment
2. Click "Run workflow"
3. Optionally specify a PR number
4. Click "Run workflow"

## Preview URLs

For PR #123, your preview will be available at:
- **API**: `https://chat-api-pr-123.preview.mymemo.ai`

## Monitoring and Debugging

### Check Deployment Status

View the GitHub Actions logs to see deployment progress and any errors.

### Server-side Debugging

SSH to the EC2 server and check:

```bash
# Check running containers
sudo docker ps --filter "name=preview-chat-api-"

# Check container logs
sudo docker logs preview-chat-api-pr-123

# Check deployment state
ls -la /var/preview/chat-api/pr-123/
cat /var/preview/chat-api/pr-123/port

# Check nginx configuration
sudo nginx -t
ls -la /etc/nginx/conf.d/api-preview-*

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Container Health

The deployment script includes comprehensive health checks:
- Container starts successfully with proper port mapping
- Application responds to TCP connection tests
- Nginx configuration validates successfully
- End-to-end HTTP proxy verification

## Security

- All preview environments are isolated from each other
- Each environment uses a unique port and domain
- CORS is configured for API access
- Security headers are applied via nginx

## Resource Cleanup

- Docker containers are automatically removed when PRs are closed
- Unused Docker images are cleaned up periodically
- Nginx configurations are removed on cleanup

## Troubleshooting

### Common Issues

1. **Container fails to start**
   - Check Docker image availability: `sudo docker pull <image>`
   - Verify memory constraints are appropriate
   - Check container logs: `sudo docker logs preview-chat-api-pr-<number>`

2. **Port extraction fails**
   - Verify Docker port mapping: `sudo docker port <container_name>`
   - Check if container is actually running and listening
   - Ensure no conflicts with existing containers

3. **Nginx configuration test fails**
   - Verify template file exists: `ls /etc/nginx/templates/chat-api/chat-api-preview-template.conf`
   - Check placeholder substitution in generated config
   - Validate nginx syntax: `sudo nginx -t`

4. **Health check timeout**
   - Check if application starts correctly on port 3000
   - Verify TCP connectivity: `telnet localhost <port>`
   - Increase health check timeout if needed

5. **State directory issues**
   - Ensure `/var/preview` directory exists and is writable
   - Check permissions: `sudo ls -la /var/preview/`

### Manual Cleanup

If automatic cleanup fails:

```bash
# Stop all preview containers for this repo
sudo docker ps -a --filter "name=preview-chat-api-" -q | xargs sudo docker stop
sudo docker ps -a --filter "name=preview-chat-api-" -q | xargs sudo docker rm

# Remove nginx configurations
sudo rm -f /etc/nginx/conf.d/api-preview-chat-api-*.conf
sudo systemctl reload nginx

# Clean up state directories
sudo rm -rf /var/preview/chat-api/

# Remove any dangling images
sudo docker image prune -f
```
