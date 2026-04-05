terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local backend — this stack bootstraps the remote state bucket.
  # The terraform.tfstate file is critical and must not be deleted.
}
