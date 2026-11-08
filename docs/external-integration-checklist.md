# Phase 20 external integration checklist

This checklist is an execution handoff, not evidence that external production
controls have been completed. Do not place secret values in this file, tickets,
logs, browser forms, or source control.

## Required accounts and infrastructure

| Area | Required dependency | Minimum non-secret input | Secret values |
|---|---|---|---|
| Payments | Razorpay sandbox account | Key ID, webhook URL, test-card/UPI procedure | Key secret, webhook secret |
| Email | Managed SMTP provider | Host, port, TLS mode, verified sender/domain | SMTP username/password or API key |
| Secrets | AWS Secrets Manager | Secret ARN, workload identity/IAM role | Stored only in Secrets Manager |
| AI | Private service network | Internal DNS/service URL, ingress policy | AI service token |
| Monitoring | Central log/metrics/error platform | Workspace/project IDs, alert destinations | Ingestion credentials |
| Database | MongoDB replica set/Atlas | TLS URI, isolated restore target, backup bucket | DB credentials, encryption/key access |
| HTTPS | Managed domain and certificate authority | Production frontend/API hostnames, DNS access | DNS/API credentials held by operator |
| Tooling | MongoDB Database Tools | `mongodump`, `mongorestore` versions pinned to server compatibility | None |

## Razorpay sandbox execution

1. Store `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and
   `RAZORPAY_WEBHOOK_SECRET` in the secret manager.
2. Set `PAYMENT_PROVIDER=razorpay` and `MOCK_PAYMENTS_ENABLED=false` only in
   the sandbox environment.
3. Use a synthetic parent/student and a sandbox payment method.
4. Capture evidence for order amount/currency/ownership, successful payment,
   failed payment, invalid signature, invalid amount, expired order, duplicate
   webhook event, and reconciliation totals.
5. Test refund authorization only with a sandbox transaction and record the
   provider refund identifier. Never use a production key.

The current application now persists provider payment IDs, handles provider
payment states, reconciles completed orders against ledger entries, and exposes
an Accounts-authorized sandbox refund path. These capabilities still require
execution against a Razorpay sandbox account before production approval.

## Managed SMTP execution

Use a verified sender domain with SPF and DKIM; configure DMARC according to the
organization's email policy. Set `SMTP_SECURE=true` for implicit TLS or use
authenticated STARTTLS as required by the provider. Test only a consented
synthetic mailbox:

- OTP delivery and expiry
- invitation delivery and activation
- expired and reused invitation rejection
- provider rejection/timeout and application error handling

Never paste credentials into test output. Redact provider message IDs if they
contain account-identifying data.

## Secrets and rotation

AWS Secrets Manager is the selected implementation: use an IAM workload role,
one secret namespace per environment, least-privilege read access, versioned
secrets, and rotation runbooks. Rotate JWT/OTP secrets with a planned token
invalidation window; rotate SMTP, Razorpay, MongoDB, and AI tokens by staging
the new version, switching consumers, verifying health, then revoking the old
version.

## AI private deployment

Expose the AI service only on an internal network or private service endpoint.
Allow inbound traffic only from the backend identity/network. Keep `/health`
available only to internal probes if the platform permits it; require
`Authorization: Bearer <AI_SERVICE_TOKEN>` for prediction requests. Verify
public requests fail, missing/incorrect tokens return 401, rate limits return
429, and backend timeout behavior returns a safe 503.

## Monitoring and alerts

Forward redacted `http_request` events and application errors to the selected
central platform. Create dashboards for request rate, latency, 4xx/5xx rate,
MongoDB health, AI availability/429/5xx, SMTP failures, payment failures,
webhook duplicates, and backup age. Test alerts through a non-production
notification channel and record timestamps and acknowledgement.

## Backup and isolated restore

Install MongoDB Database Tools compatible with the MongoDB server. Write
encrypted archives to access-controlled object storage with retention and
immutability policy. Run `scripts/backup-mongodb.ps1`, restore into a new
isolated database with `scripts/restore-mongodb-isolated.ps1`, and compare
collection counts, unique indexes, user roles, fee-ledger totals, and payment
transaction uniqueness. Do not use `--drop` against a production URI.

## HTTPS, MongoDB TLS, and CORS

Provision distinct production hostnames, valid certificates, and redirects from
HTTP to HTTPS. Set `FRONTEND_URL` to one exact HTTPS origin. Use a TLS-enabled
MongoDB URI, least-privilege application credentials, and network allowlists.
Capture preflight evidence for required methods and verify that an unrelated
origin is rejected.

## Acceptance evidence

Production approval requires dated, redacted evidence for every section above.
Until all evidence exists, the project status remains **NOT READY FOR
PRODUCTION**.

## Phase 23 execution record

Availability checks on 2026-11-08 found no AWS CLI/profile, Razorpay sandbox
credentials, SMTP credentials, production MongoDB URI, MongoDB Database Tools,
Docker, or OpenSSL. Local service health and regression tests passed, but all
external sections remain unverified. No external calls or production changes
were made.

## Phase 24 provisioning record

The provisioning check again found no AWS CLI/profile, IAM role, Razorpay
sandbox credentials, SMTP credentials, production MongoDB URI, MongoDB Database
Tools, Docker, or OpenSSL. Final local regression passed; all external
acceptance evidence remains outstanding.

## Phase 25 readiness record

On 2026-11-08, the environment was re-audited before any external execution.
AWS tooling and identity, provider credentials, MongoDB tools, cloud monitoring,
production network inputs, domain, and certificate inputs were unavailable.
Local service health and regression evidence were not reclassified as external
verification. All external acceptance criteria remain blocked.

## Phase 26 actionable handover

This section is the execution plan for an operator with authorized AWS,
Razorpay, SMTP, DNS, and MongoDB access. Run in a non-production AWS account
first. Do not paste secret values into a terminal transcript, ticket, or chat.

### AWS foundation

1. Select an AWS region and create separate `dev`, `staging`, and `prod`
   resource namespaces.
2. Run the backend on an AWS workload with an attached IAM role (ECS task role,
   EKS service account role, or EC2 instance profile). Do not use access keys in
   the application environment.
3. Create Secrets Manager secrets such as
   `feeflow/staging/backend` and `feeflow/production/backend`. Store the
   backend variables from `.env.example` as JSON values, excluding frontend
   secrets. Enable rotation for credentials supported by the selected provider.
4. Grant the workload role only `secretsmanager:GetSecretValue` for those exact
   secret ARNs, `kms:Decrypt` only for the backup/secret encryption key, and
   CloudWatch log/metric permissions for the service's own log group.
5. Verify with `aws sts get-caller-identity` and a secret retrieval command that
   prints only the secret name and a success/failure result. Verify an unrelated
   secret is denied. Record the role ARN, secret ARN, region, timestamp, and
   redacted command output.
6. Configure CloudWatch Logs, a dashboard for API latency/errors, database
   health, AI failures, payment failures, webhook duplicates, and backup age.
   Create SNS alerts and trigger them with a synthetic staging alarm.

### Razorpay sandbox

1. Create a Razorpay Test Mode account and generate a test Key ID, Key Secret,
   and webhook secret. Put them into the staging secret, never `.env` or the
   frontend bundle.
2. Set `PAYMENT_PROVIDER=razorpay`, `MOCK_PAYMENTS_ENABLED=false`, and the
   staging backend URL. Configure the webhook endpoint
   `/api/parent-payments/webhooks/razorpay` with the secret and payment events
   used by the adapter.
3. Use a synthetic seeded parent/student and create an order. Verify the
   server-calculated amount, INR currency, provider order ID, and ownership.
4. Execute successful, failed, pending, authorized, and cancelled test-mode
   flows. Verify signed callback handling, provider payment ID persistence,
   installment ledger totals, and receipt access.
5. Replay the same webhook event and verify a successful idempotent response
   without a second ledger payment. Send a bad signature and verify HTTP 400.
6. Run the Accounts-only reconciliation endpoint and compare provider test
   order/payment totals to the FeeFlow ledger. Record sanitized IDs only.
7. Approve a synthetic refund, execute the sandbox refund path, verify the
   provider refund ID and idempotent repeat behavior, then reconcile the refund.

### Managed SMTP

1. Select a provider supporting authenticated TLS/STARTTLS and a consented
   synthetic mailbox. Verify the sender domain with provider-issued SPF and
   DKIM records; publish a DMARC policy appropriate for staging.
2. Store `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
   `SMTP_PASSWORD`, and `SMTP_FROM` in Secrets Manager. Keep `SMTP_FROM` on the
   verified domain.
3. Test OTP delivery/expiry, invitation delivery/activation, expired and reused
   invitations, and provider rejection/timeout. Verify failures surface as safe
   application errors and logs contain no message body, OTP, token, or password.
4. Record provider, DNS verification status, TLS mode, synthetic mailbox domain,
   sanitized message IDs, timestamps, and delivery/failure results.

### MongoDB backup and isolated restore

1. Install MongoDB Database Tools compatible with the server version and record
   `mongodump --version` and `mongorestore --version`.
2. Use an authorized staging MongoDB TLS URI with a least-privilege backup user.
   Write gzip archives to encrypted, access-controlled object storage with
   retention and object-lock policy.
3. Run `scripts/backup-mongodb.ps1` and verify the archive integrity.
4. Create a new isolated database/cluster and run
   `scripts/restore-mongodb-isolated.ps1`; never use its `--drop` option against
   a production URI.
5. Compare collection names/counts, indexes, user roles, fee-ledger totals,
   payment transaction uniqueness, and application health. Record backup start,
   restore end, duration, archive checksum, RPO/RTO, and redacted results.

### Private AI networking

1. Place the AI service in a private subnet or private service namespace with no
   public ingress. Permit inbound traffic only from the backend security group
   on the internal service port.
2. Store `AI_SERVICE_TOKEN` in Secrets Manager and inject it into both services.
   Set `AI_SERVICE_URL` to internal DNS. Keep health probes internal where the
   platform supports it.
3. Verify a backend assessment succeeds, a request without/with a wrong token
   returns 401, a public-path request is unreachable, repeated requests are
   rate-limited with 429, and a timeout returns safe HTTP 503.

### HTTPS, TLS, and CORS

1. Provision separate API and frontend hostnames. Request an ACM certificate
   with DNS validation and verify the hostname chain from an external client.
2. Redirect HTTP to HTTPS at the load balancer and set `FRONTEND_URL` to one
   exact HTTPS origin. Verify an unrelated origin is rejected and the required
   `PATCH` preflight returns the expected allow methods.
3. Use a TLS-enabled MongoDB/SRV URI, certificate validation, private network
   allowlists, and a least-privilege database user. Capture the sanitized
   connection/health result.

## Phase 26 acceptance matrix

| Requirement | Required resource | Setup instructions | Verification procedure | Expected result | Evidence required | Current status |
|---|---|---|---|---|---|---|
| Workload identity | AWS IAM + compute role | Attach role; no access keys | Caller identity and denied unrelated secret | Correct role; least privilege | Role ARN, redacted CLI output | BLOCKED |
| Secret retrieval | Secrets Manager + KMS | Create per-environment secret | Retrieve without printing value | Application starts and reads secret | ARN, timestamp, success result | BLOCKED |
| CloudWatch | Logs, metrics, dashboard, SNS | Create service log group and alarms | Emit synthetic staging alarm | Alert delivered to test channel | Dashboard/ alarm IDs, acknowledgement | BLOCKED |
| Razorpay order | Razorpay Test Mode | Store test credentials; enable provider | Create synthetic order | Correct amount/currency/owner | Sanitized order ID and response | BLOCKED |
| Payment settlement | Razorpay Test Mode | Configure Checkout.js/webhook | Complete success/failure/pending/cancelled flows | Correct provider and ledger states | Sanitized IDs, ledger assertions | BLOCKED |
| Webhook idempotency | Razorpay webhook | Configure endpoint and secret | Replay event; send bad signature | Duplicate is harmless; bad signature is 400 | Event IDs and HTTP results | BLOCKED |
| Refund | Razorpay Test Mode + Accounts role | Approve synthetic refund | Execute and repeat refund | Authorized, provider ID stored, repeat safe | Sanitized refund ID and reconciliation | BLOCKED |
| SMTP delivery | Managed SMTP + verified domain | Publish SPF/DKIM/DMARC; store TLS credentials | Send synthetic OTP/invitation | Delivered; failure is safe | DNS results, sanitized message IDs | BLOCKED |
| Backup | MongoDB Tools + encrypted storage | Install tools; configure retention | Run staging backup/integrity check | Archive valid and retained | Tool versions, checksum, archive metadata | BLOCKED |
| Restore | Isolated MongoDB target | Create disposable target | Restore and compare records/indexes | Counts and consistency match | Duration, counts, checksum, health | BLOCKED |
| AI privacy | Private network + security groups | Internal DNS; backend-only ingress | Public, wrong-token, timeout, rate tests | Public blocked; safe 401/429/503 | Network test results, no token | BLOCKED |
| HTTPS/TLS/CORS | Domain + ACM + MongoDB TLS | Validate cert; configure origin | TLS, redirect, preflight, DB health | Valid cert, exact origin, TLS DB | Certificate and preflight evidence | BLOCKED |

## Phase 27 execution record

**Verification date:** 2026-11-08  
**Environment:** Local Windows workspace; no external credentials or cloud
identity configured.

Resource discovery found no AWS CLI or identity, Razorpay Test Mode
credentials, managed SMTP credentials or verified sender, MongoDB Database
Tools, Docker, OpenSSL, production domain/certificate inputs, CloudWatch/SNS
access, production MongoDB TLS URI, or private AI networking configuration.
Only the local frontend (`http://localhost:5173`) and AI health endpoint
(`http://localhost:8000/health`) returned HTTP 200 during the check. No
external request was attempted.

Consequently, AWS, Razorpay, SMTP, backup/restore, private AI, monitoring, and
HTTPS/TLS acceptance rows remain **BLOCKED**. The procedures and evidence
requirements above are ready for execution once the operator supplies
authorized non-production resources.
