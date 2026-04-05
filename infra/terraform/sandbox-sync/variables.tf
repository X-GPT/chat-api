variable "environment" {
  description = "Environment name (staging or production)"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "AWS CLI profile (empty string = use env credentials, e.g. OIDC in CI)"
  type        = string
  default     = ""
}

variable "visibility_timeout_seconds" {
  description = "How long a message is hidden after a consumer receives it"
  type        = number
  default     = 600
}

variable "message_retention_seconds" {
  description = "How long unprocessed messages are kept in the main queue"
  type        = number
  default     = 86400 # 1 day
}

variable "dlq_message_retention_seconds" {
  description = "How long messages are kept in the DLQ for debugging"
  type        = number
  default     = 345600 # 4 days
}

variable "dlq_max_receive_count" {
  description = "Number of receive attempts before moving message to DLQ"
  type        = number
  default     = 5
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for alarm notifications (empty = alarms created but no action)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags for all resources"
  type        = map(string)
  default     = {}
}
