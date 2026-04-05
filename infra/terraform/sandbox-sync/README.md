# Sandbox Sync SQS Infrastructure

Terraform stack for the sandbox sync SQS FIFO queue, dead letter queue, and CloudWatch alarms.

## What It Creates

- **SQS FIFO main queue** (`sandbox-sync-<env>.fifo`) — per-user ordered message processing
- **SQS FIFO dead letter queue** (`sandbox-sync-dlq-<env>.fifo`) — failed messages after max retries
- **CloudWatch alarms** — oldest message age, message backlog, DLQ messages
- **IAM policy documents** (outputs only) — producer and consumer policies for attachment to existing roles

## Prerequisites

- Terraform >= 1.10
- Bootstrap stack applied (`../bootstrap/`)
- AWS profile `mymemo` (local) or OIDC role credentials (CI)

## Usage

### Local

```bash
cd infra/terraform/sandbox-sync

# Initialize with remote backend (replace <env> with staging or production)
terraform init \
  -backend-config=bucket=mymemo-terraform-state \
  -backend-config=key=sandbox-sync/<env> \
  -backend-config=region=us-west-2 \
  -backend-config=profile=mymemo

# Plan and apply
terraform plan -var-file=<env>.tfvars
terraform apply -var-file=<env>.tfvars
```

### CI (GitHub Actions with OIDC)

```bash
# No profile needed — credentials come from OIDC role assumption
terraform init \
  -backend-config=bucket=mymemo-terraform-state \
  -backend-config=key=sandbox-sync/<env> \
  -backend-config=region=us-west-2

terraform plan -var-file=<env>.tfvars -var="aws_profile="
terraform apply -var-file=<env>.tfvars -var="aws_profile="
```

## Outputs

| Output | Description |
|--------|-------------|
| `sandbox_sync_queue_url` | Inject as `SANDBOX_SYNC_QUEUE_URL` in app deploy config |
| `sandbox_sync_queue_arn` | Main queue ARN for IAM policy references |
| `sandbox_sync_dlq_url` | DLQ URL for monitoring/debugging |
| `sandbox_sync_dlq_arn` | DLQ ARN for IAM policy references |
| `producer_policy_json` | IAM policy JSON to attach to producer roles |
| `consumer_policy_json` | IAM policy JSON to attach to consumer roles |

## Queue Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| FIFO | Yes | Per-user ordering via MessageGroupId |
| Content-based dedup | No | Explicit MessageDeduplicationId required |
| Visibility timeout | 600s (10 min) | Match to expected sync job duration |
| Main queue retention | 1 day | Jobs should process quickly |
| DLQ retention | 4 days | Longer window for debugging failures |
| Max receive count | 5 | Attempts before moving to DLQ |
| Long polling | 20s | Reduces empty receives |
