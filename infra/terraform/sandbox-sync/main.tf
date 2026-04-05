locals {
  common_tags = merge(var.tags, {
    managed-by  = "terraform"
    component   = "sandbox-sync"
    environment = var.environment
  })
}

# ─── Dead Letter Queue ─────────────────────────────────────────────

resource "aws_sqs_queue" "sandbox_sync_dlq" {
  name                      = "sandbox-sync-dlq-${var.environment}.fifo"
  fifo_queue                = true
  message_retention_seconds = var.dlq_message_retention_seconds
  tags                      = local.common_tags
}

# ─── Main Queue ────────────────────────────────────────────────────

resource "aws_sqs_queue" "sandbox_sync" {
  name                        = "sandbox-sync-${var.environment}.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = var.visibility_timeout_seconds
  message_retention_seconds   = var.message_retention_seconds
  receive_wait_time_seconds   = 20
  max_message_size            = 262144

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.sandbox_sync_dlq.arn
    maxReceiveCount     = var.dlq_max_receive_count
  })

  tags = local.common_tags
}

# ─── CloudWatch Alarms ─────────────────────────────────────────────

locals {
  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

resource "aws_cloudwatch_metric_alarm" "oldest_message_age" {
  alarm_name          = "sandbox-sync-${var.environment}-oldest-message-age"
  alarm_description   = "Oldest message in sandbox-sync queue exceeds 5 minutes"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 300
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.sandbox_sync.name
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "message_backlog" {
  alarm_name          = "sandbox-sync-${var.environment}-message-backlog"
  alarm_description   = "More than 100 visible messages in sandbox-sync queue"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 100
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.sandbox_sync.name
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "sandbox-sync-${var.environment}-dlq-messages"
  alarm_description   = "Messages appearing in sandbox-sync DLQ"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.sandbox_sync_dlq.name
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
  tags          = local.common_tags
}
