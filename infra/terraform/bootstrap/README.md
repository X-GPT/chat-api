# Bootstrap Terraform Stack

One-time local setup that creates foundational AWS resources for Terraform CI/CD.

## What It Creates

- **S3 bucket** for Terraform remote state (versioned, encrypted, public access blocked)
- **GitHub OIDC identity provider** for keyless authentication from GitHub Actions
- **IAM role** for GitHub Actions with scoped permissions (S3 state, SQS management, CloudWatch alarms)

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

1. Copy the `github_actions_role_arn` output value
2. Add it as a GitHub Actions repository secret named `AWS_ROLE_ARN`

```bash
terraform output github_actions_role_arn
```

## Important

- This stack uses a **local backend** — the `terraform.tfstate` file in this directory is critical
- Do not delete or lose the state file — back it up securely (e.g., password manager, private S3 bucket)
- Do not commit the state file to the repository — it contains AWS account IDs and resource ARNs
- The OIDC provider is account-wide; if one already exists for `token.actions.githubusercontent.com`, import it: `terraform import aws_iam_openid_connect_provider.github <existing-arn>`
