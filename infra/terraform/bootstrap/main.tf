# ─── S3 State Bucket ───────────────────────────────────────────────

resource "aws_s3_bucket" "terraform_state" {
  bucket = var.state_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}

# ─── GitHub Actions Write Role (main branch only) ─────────────────

data "aws_iam_policy_document" "github_actions_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "github-actions-${var.github_org}-${var.github_repo}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_trust.json
  tags               = var.tags
}

data "aws_iam_policy_document" "github_actions_permissions" {
  # S3 state bucket access
  statement {
    sid    = "TerraformStateS3"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]
  }

  # SQS queue-level operations scoped to sandbox-sync queues
  statement {
    sid    = "TerraformSQSManage"
    effect = "Allow"
    actions = [
      "sqs:DeleteQueue",
      "sqs:SetQueueAttributes",
      "sqs:GetQueueAttributes",
      "sqs:TagQueue",
      "sqs:UntagQueue",
      "sqs:ListQueueTags",
    ]
    resources = ["arn:aws:sqs:${var.aws_region}:*:sandbox-sync-*"]
  }

  # SQS actions that require broad resource scope
  statement {
    sid    = "TerraformSQSCreate"
    effect = "Allow"
    actions = [
      "sqs:CreateQueue",
      "sqs:GetQueueUrl",
      "sqs:ListQueues",
    ]
    resources = ["*"]
  }

  # CloudWatch alarm mutations scoped to sandbox-sync alarms
  statement {
    sid    = "TerraformCloudWatchAlarms"
    effect = "Allow"
    actions = [
      "cloudwatch:PutMetricAlarm",
      "cloudwatch:DeleteAlarms",
      "cloudwatch:TagResource",
      "cloudwatch:UntagResource",
    ]
    resources = ["arn:aws:cloudwatch:${var.aws_region}:*:alarm:sandbox-sync-*"]
  }

  # CloudWatch read/list actions (cannot be scoped to alarm ARNs)
  statement {
    sid    = "TerraformCloudWatchRead"
    effect = "Allow"
    actions = [
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions" {
  name   = "terraform-permissions"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_permissions.json
}

# ─── GitHub Actions Read-Only Role (all branches, for PR plans) ───

data "aws_iam_policy_document" "github_actions_readonly_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/*",
        "repo:${var.github_org}/${var.github_repo}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_readonly" {
  name               = "github-actions-${var.github_org}-${var.github_repo}-readonly"
  assume_role_policy = data.aws_iam_policy_document.github_actions_readonly_trust.json
  tags               = var.tags
}

data "aws_iam_policy_document" "github_actions_readonly_permissions" {
  # S3 state bucket read (terraform plan needs to read state)
  statement {
    sid    = "TerraformStateRead"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]
  }

  # SQS read (terraform plan needs to refresh queue attributes)
  statement {
    sid    = "TerraformSQSRead"
    effect = "Allow"
    actions = [
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ListQueues",
      "sqs:ListQueueTags",
    ]
    resources = ["*"]
  }

  # CloudWatch read (terraform plan needs to refresh alarm state)
  statement {
    sid    = "TerraformCloudWatchRead"
    effect = "Allow"
    actions = [
      "cloudwatch:DescribeAlarms",
      "cloudwatch:ListTagsForResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_actions_readonly" {
  name   = "terraform-readonly-permissions"
  role   = aws_iam_role.github_actions_readonly.id
  policy = data.aws_iam_policy_document.github_actions_readonly_permissions.json
}
