output "sandbox_sync_queue_url" {
  description = "Main FIFO queue URL — inject as SANDBOX_SYNC_QUEUE_URL in app config"
  value       = aws_sqs_queue.sandbox_sync.url
}

output "sandbox_sync_queue_arn" {
  description = "Main FIFO queue ARN"
  value       = aws_sqs_queue.sandbox_sync.arn
}

output "sandbox_sync_dlq_url" {
  description = "Dead letter queue URL"
  value       = aws_sqs_queue.sandbox_sync_dlq.url
}

output "sandbox_sync_dlq_arn" {
  description = "Dead letter queue ARN"
  value       = aws_sqs_queue.sandbox_sync_dlq.arn
}

output "producer_policy_json" {
  description = "IAM policy JSON for producers (sqs:SendMessage)"
  value       = data.aws_iam_policy_document.producer.json
}

output "consumer_policy_json" {
  description = "IAM policy JSON for consumers (receive/delete/visibility)"
  value       = data.aws_iam_policy_document.consumer.json
}
