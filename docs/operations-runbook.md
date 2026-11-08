# FeeFlow AI operations runbook

## Backups and recovery

Backups use `mongodump --archive --gzip --oplog` and must be written to encrypted,
access-controlled storage outside the application host. Schedule
[`scripts/backup-mongodb.ps1`](../scripts/backup-mongodb.ps1) at least daily and
retain backups according to the organization's legal and operational policy.

Never restore into production during a test. Use a disposable MongoDB instance and
[`scripts/restore-mongodb-isolated.ps1`](../scripts/restore-mongodb-isolated.ps1).
After restoring, verify collection counts, unique indexes, user roles, fee-ledger
totals, payment transaction uniqueness, and application health.

The recommended initial objectives are RPO 24 hours and RTO 4 hours; these must be
approved and tested by the operations owner before launch.

## Monitoring

`GET /api/health` reports database connectivity. `GET /api/health/metrics` reports
process-local request counts, failures, and latency. Forward structured
`http_request` logs to a redacting centralized collector and add alerts for health
failures, 5xx spikes, payment failures, AI 5xx/429 responses, and backup failures.

## Secrets and deployment

Use a secret manager for JWT, OTP, SMTP, Razorpay, MongoDB, and AI-service tokens.
Do not pass production secrets on command lines or commit them to the repository.
