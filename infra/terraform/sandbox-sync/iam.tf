# Policy documents only — no roles created here.
# Consumers of these outputs attach the JSON to their own roles.

data "aws_iam_policy_document" "producer" {
  statement {
    sid       = "SandboxSyncProducer"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.sandbox_sync.arn]
  }
}

data "aws_iam_policy_document" "consumer" {
  statement {
    sid    = "SandboxSyncConsumer"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.sandbox_sync.arn]
  }
}
