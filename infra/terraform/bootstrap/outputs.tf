output "state_bucket_name" {
  description = "S3 bucket name for Terraform remote state"
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.terraform_state.arn
}

output "oidc_provider_arn" {
  description = "GitHub OIDC provider ARN"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "github_actions_role_arn" {
  description = "Write role ARN (main branch, terraform apply) — add as GitHub Actions secret AWS_ROLE_ARN"
  value       = aws_iam_role.github_actions.arn
}

output "github_actions_role_name" {
  description = "Write role name"
  value       = aws_iam_role.github_actions.name
}

output "github_actions_readonly_role_arn" {
  description = "Read-only role ARN (all branches, terraform plan) — add as GitHub Actions secret AWS_READONLY_ROLE_ARN"
  value       = aws_iam_role.github_actions_readonly.arn
}

output "github_actions_readonly_role_name" {
  description = "Read-only role name"
  value       = aws_iam_role.github_actions_readonly.name
}
