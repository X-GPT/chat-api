# Bootstrap Terraform Stack

One-time local setup that creates foundational AWS resources for Terraform CI/CD.

## What It Creates

- **S3 bucket** for Terraform remote state (versioned, encrypted, public access blocked)
- **GitHub OIDC identity provider** for keyless authentication from GitHub Actions
- **Write IAM role** (`github-actions-X-GPT-chat-api`) — main branch only, for `terraform apply`
- **Read-only IAM role** (`github-actions-X-GPT-chat-api-readonly`) — all branches + pull requests, for `terraform plan` on PRs (must use `-lock=false`)

## Prerequisites

- Terraform >= 1.10
- AWS CLI profile `mymemo` configured (`aws configure --profile mymemo`)

## Usage

```bash
cd infra/terraform/bootstrap

terraform init
terraform plan
terraform apply
```

## After Apply

1. Copy both role ARN outputs
2. Add them as GitHub Actions repository secrets

```bash
terraform output github_actions_role_arn           # → secret AWS_ROLE_ARN
terraform output github_actions_readonly_role_arn   # → secret AWS_READONLY_ROLE_ARN
```

## Important

- This stack uses a **local backend** — the `terraform.tfstate` file in this directory is critical
- Do not delete or lose the state file — back it up securely (e.g., password manager, private S3 bucket)
- Do not commit the state file to the repository — it contains AWS account IDs and resource ARNs
- The OIDC provider is account-wide; if one already exists for `token.actions.githubusercontent.com`, import it: `terraform import aws_iam_openid_connect_provider.github <existing-arn>`
