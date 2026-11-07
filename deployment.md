# FeeFlow AI deployment guide

This guide prepares a local or provider-managed deployment. No deployment provider, production environment, or live application URL has been verified for this workspace. Do not treat the sample mock payment/reminder features as production integrations.

## Prerequisites

- Node.js 20.19+ or 22.12+ and npm 10+.
- Python 3.11+ for the local AI service and its test suite.
- MongoDB Atlas or another MongoDB deployment that supports transactions for payment operations (replica set or mongos).
- SMTP credentials for OTP delivery outside development.
- HTTPS origins and a secret manager for production values.

## Local setup

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item frontend\.env.example frontend\.env
npm install
py -3.12 -m venv ai-service\.venv
ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
```

Set the environment variable names below in `.env` and `frontend\.env`. Do not put secrets in source control. Configure a test/development MongoDB database first. Use an independently generated JWT secret and OTP HMAC secret, each at least 32 characters.

Start the local AI service in one terminal:

```powershell
ai-service\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Start the Node API and frontend in another terminal:

```powershell
npm run dev
```

The API defaults to port 4000, the Vite development server to port 5173, and the local AI service to port 8000. Visit `http://localhost:5173`. Check `GET /api/health` for API/database readiness and `GET /health` on the local AI service for its rules-baseline status.

## Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | Express API listen port |
| `MONGO_URI` | MongoDB connection URI; never log or commit it |
| `JWT_SECRET` | JWT signing secret, at least 32 characters |
| `JWT_EXPIRES_IN` | JWT lifetime |
| `OTP_HMAC_SECRET` | HMAC secret for one-time-code digests, at least 32 characters |
| `OTP_EXPIRES_MINUTES` | OTP lifetime |
| `FRONTEND_URL` | Exact allowed browser origin |
| `AI_SERVICE_URL` | Local/private FastAPI origin; public AI providers are rejected |
| `AI_SERVICE_TIMEOUT_MS` | Risk-service request timeout |
| `MOCK_PAYMENTS_ENABLED` | Development mock-checkout switch; production always disables mock settlement |
| `REFUND_POLICY_VERSION` | Version recorded with sample refund calculations |
| `REMINDER_SCHEDULE_OFFSETS_DAYS` | Comma-separated schedule offsets |
| `REMINDER_POLL_INTERVAL_MS` | Reminder scheduler interval |
| `REMINDER_CATCH_UP_WINDOW_MS` | Maximum late-send window |
| `REMINDER_STALE_SENDING_TIMEOUT_MS` | Recovery window for stale deliveries |
| `REMINDER_RETRY_DELAYS_MS` | Comma-separated retry delays |
| `RECEIPT_GST_NOTE` | Explicit receipt note; configure only with approved wording |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE` | OTP mail delivery configuration |
| `DEMO_PARENT_PASSWORD` | Local/demo parent password, 12–128 characters |
| `DEMO_ACCOUNTS_PASSWORD` | Local/demo accounts password, 12–128 characters |
| `DEMO_COUNSELLOR_PASSWORD` | Optional local/demo counsellor password |
| `VITE_API_URL` | Frontend API base URL, including `/api` |

Example files document names only and contain no operational credentials. Production values belong in the hosting platform's secret manager.

## Database setup and demo data

1. Create a dedicated MongoDB database and least-privilege database user. Allow only the application host/network.
2. Ensure the deployment is transaction-capable before enabling payments; payment recording deliberately fails rather than falling back to non-atomic writes.
3. Configure `MONGO_URI` privately, then check `GET /api/health`.
4. Configure demo passwords and run `npm run seed` only against a development/demo database. The seed is insert-only, uses stable keys, and does not delete records. If a collision or changed seed-managed identity is detected, it stops instead of overwriting.
5. The seed can create a counsellor task only when the local AI service is available and returns a valid human-review result. Otherwise it reports that the optional task was skipped.
6. To run a configured-database integration test, use a dedicated non-production test database and `RUN_CONFIGURED_MONGO_SEED_TESTS=true`. This test leaves its demo records in place. The disposable integration test needs permissions for a uniquely named temporary database and removes only that database.

Never point automated tests or the demo seed at production.

## Frontend deployment

Build the static client:

```powershell
$env:VITE_API_URL = "https://<api-host>/api"
npm run build
```

Publish `frontend/dist` using the selected static hosting provider. Configure SPA fallback to `index.html`, HTTPS, and the correct `VITE_API_URL` at build time. Add the exact frontend origin to backend `FRONTEND_URL`. No provider-specific deployment was performed or verified.

## Backend deployment

Run `npm install --omit=dev` and `npm start` in the backend workspace or use the root workspace's production process configuration. Supply all required environment values through the platform's secret store. Use HTTPS at the ingress/load balancer, restrict inbound access, configure graceful process shutdown and health probes, and monitor MongoDB connection state and reminder-worker audit events.

Use SMTP with TLS/STARTTLS for OTP messages. Development OTP console logging is not a production delivery mechanism. Mock settlement is disabled in production even if the feature flag is set.

## AI service deployment

For local development, bind FastAPI to loopback as shown above. If deployed separately, restrict the network to the private application network, use TLS where traffic crosses hosts, and set `AI_SERVICE_URL` to a private single-label service hostname. The backend configuration rejects public provider URLs. Do not expose `/predict-risk` publicly.

The deployed service is a transparent rules baseline. The synthetic scikit-learn experiment is not the prediction model and its generated-data metrics are not evidence of real-world accuracy.

## Demo login details

| Role | Login email | Password setup |
|---|---|---|
| Parent | `parent0587@feeflow.demo` | Set `DEMO_PARENT_PASSWORD` locally |
| Parent isolation sample | `parent0412@feeflow.demo` | Set `DEMO_PARENT_PASSWORD` locally |
| Parent risk sample | `parent0773@feeflow.demo` | Set `DEMO_PARENT_PASSWORD` locally |
| Accounts | `accounts@feeflow.demo` | Set `DEMO_ACCOUNTS_PASSWORD` locally |
| Counsellor (optional) | `counsellor@feeflow.demo` | Set `DEMO_COUNSELLOR_PASSWORD` locally |

No passwords are published in this document. Outside development, users receive OTP through configured SMTP. In development, the OTP is written to the backend console and is not included in the HTTP response.

## Troubleshooting

- **API health returns 503:** verify MongoDB reachability, authentication and database permissions without printing `MONGO_URI`.
- **MongoDB authentication fails:** confirm the secret-manager value, database username/password encoding, database name, Atlas network allowlist and database user. Never paste the URI into logs or tickets.
- **Payment returns 503:** confirm transaction-capable MongoDB (replica set/mongos); do not disable transaction enforcement.
- **OTP login fails outside development:** configure SMTP sender/credentials and TLS/STARTTLS.
- **Risk assessment returns 503:** confirm the private local FastAPI service is healthy and the API's timeout/URL configuration is correct.
- **Optional demo risk task is absent:** start the local FastAPI service and re-run the insert-only seed; verify that no existing open counsellor task is being preserved.
- **CORS error:** set `FRONTEND_URL` to the exact browser origin and rebuild the frontend with its API URL.
- **Seed reports an identity collision:** inspect the targeted demo record manually. Do not delete it or force an overwrite.
