# FeeFlow AI Deployment Guide

This guide describes production prerequisites. It does not deploy the application.

The selected external deployment target is AWS. Use AWS Secrets Manager with an
IAM workload role for production secrets, and keep the AI service and MongoDB on
private network paths.

## Services

1. MongoDB replica set or managed MongoDB with TLS and backups.
2. Backend Node.js service.
3. Frontend static/Vite build served behind HTTPS.
4. Private AI FastAPI service reachable only by the backend.

## Required backend environment

Copy `.env.example` into a secret-managed environment and replace every placeholder:

- `NODE_ENV=production`
- `MONGO_URI`
- `JWT_SECRET`
- `OTP_HMAC_SECRET`
- `FRONTEND_URL` with the exact HTTPS frontend origin
- `AI_SERVICE_URL` with a private service URL
- `AI_SERVICE_TOKEN` shared only between the backend and private AI service
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
- `MOCK_PAYMENTS_ENABLED=false`
- `PAYMENT_PROVIDER=razorpay` with sandbox credentials during gateway certification
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`
- reminder and refund policy settings appropriate for the institute

Do not commit `.env` or inject secrets into frontend bundles.

## Build and run

```powershell
npm ci
npm run build --workspace frontend
npm start --workspace backend
```

Run the AI service in a separate private process:

```powershell
python -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

For production, bind services to managed process supervision and place the frontend/backend behind HTTPS and an ingress or reverse proxy.

## Pre-release checks

- Run backend, frontend, Playwright, and AI tests.
- Check `/api/health` and AI `/health`.
- Verify SMTP with a synthetic mailbox.
- Verify MongoDB backup and restore.
- Verify rate limiting, CORS, and security headers from the production origin.
- Verify mock payment routes are unavailable in production.
- Confirm logs contain no OTPs, tokens, passwords, MongoDB URIs, or payment secrets.
- Confirm alerts exist for startup failure, database failure, SMTP failure, payment reconciliation, and AI unavailability.
- Run `scripts/backup-mongodb.ps1` to an encrypted backup location and restore only into an isolated MongoDB target using `scripts/restore-mongodb-isolated.ps1`.

## External provisioning handover

The executable setup and evidence matrix is in
[docs/external-integration-checklist.md](docs/external-integration-checklist.md).
The AWS target should use an ECS task role, EKS service-account role, or EC2
instance profile rather than long-lived access keys. Grant only scoped
`secretsmanager:GetSecretValue`, required KMS decrypt, and service log/metric
permissions. Use separate Secrets Manager namespaces and network controls for
staging and production.

Before any production approval, the operator must attach redacted evidence for
Razorpay Test Mode settlement/webhooks/refunds, verified SMTP DNS and synthetic
delivery, secret retrieval/denial, CloudWatch alert acknowledgement, isolated
MongoDB restore consistency, private AI reachability restrictions, ACM
certificate validation, MongoDB TLS, and exact-origin CORS preflight.

## Phase 27 execution status

On 2026-11-08, resource discovery confirmed that AWS identity/tooling,
Razorpay Test Mode credentials, managed SMTP, MongoDB Database Tools, Docker,
OpenSSL, production domain/certificates, CloudWatch/SNS, private AI networking,
and production MongoDB TLS inputs were unavailable. No external operation was
attempted. Follow the acceptance matrix in
[docs/external-integration-checklist.md](docs/external-integration-checklist.md)
when those resources are provisioned.
