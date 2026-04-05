variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile name"
  type        = string
  default     = "mymemo"
}

variable "github_org" {
  description = "GitHub organization or user"
  type        = string
  default     = "X-GPT"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "chat-api"
}

variable "state_bucket_name" {
  description = "S3 bucket name for Terraform remote state"
  type        = string
  default     = "mymemo-terraform-state"
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    project    = "mymemo"
    managed-by = "terraform"
    component  = "bootstrap"
  }
}
