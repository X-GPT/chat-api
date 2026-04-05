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
  description = "IAM role ARN for GitHub Actions — add as GitHub Actions secret AWS_ROLE_ARN"
  value       = aws_iam_role.github_actions.arn
}

output "github_actions_role_name" {
  description = "IAM role name for GitHub Actions"
  value       = aws_iam_role.github_actions.name
}
