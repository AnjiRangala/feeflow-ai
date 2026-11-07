# FeeFlow AI

A coaching-institute fee management system with a React parent/accounts/counsellor portal, an Express API, MongoDB/Mongoose models, a local FastAPI student-support rules baseline, OTP sign-in, a paise-based fee ledger, mock payments and reminders, refund review, and accounts dashboards.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+
- Python 3.11+ (local FastAPI risk service and its tests)
- MongoDB (local or hosted)

## Architecture and technology

The application is a local-development monorepo: a React/Vite/Tailwind browser client calls an Express/Mongoose API, which owns authentication, role checks, validation, fee/payment/refund/reminder workflows, and MongoDB persistence. The API can call a separate loopback FastAPI service for explainable student-support risk assessments. See [the architecture notes](docs/architecture.md) for component boundaries and [the deployment guide](deployment.md) for environment-variable descriptions and deployment constraints.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `MONGO_URI`, `JWT_SECRET`, `OTP_HMAC_SECRET`, and the two demo password variables. Use independent random secrets of at least 32 characters for both secrets. Quote password values that contain `#`.
3. Keep `NODE_ENV=development` for the demo OTP flow. OTP values are printed only by the backend in development; they are never returned by the API or stored as plaintext.
4. Configure MongoDB as a replica set (including a single-node local replica set) for atomic payment recording and migration. The payment API returns `503` if MongoDB transaction support is unavailable; it never falls back to non-atomic writes.
5. Install and prepare the local AI service:

   ```powershell
   npm install
   py -3 -m venv ai-service\.venv
   ai-service\.venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt
   ```

6. Start the optional local AI service in its own terminal:

   ```powershell
   ai-service\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
   ```

7. Seed the configured development database, then start the backend and frontend:

   ```powershell
   npm run seed
   npm run dev
   ```

`npm run dev` starts the Express API and Vite frontend together. To run them separately, use `npm run dev:backend` and `npm run dev:frontend`. The frontend runs at `http://localhost:5173`, the API at `http://localhost:4000`, and the local AI service at `http://127.0.0.1:8000`. Configure the frontend API URL through `frontend/.env` only when the default is unsuitable.

If upgrading a database created by the Day 1 rupee-based schema, back it up and run `npm run migrate:fee-ledger` before starting the API. This migration converts existing fee plans and payments transactionally without deleting them. `npm run seed` is insert-only: it creates missing demo users, students, fee plans, and payments using stable keys, and never deletes or replaces existing records. Existing unmarked records that collide with demo identifiers cause the seed to stop without changing them. Seed-managed records include an internal marker excluded from API responses.

The frontend defaults to `http://localhost:4000/api`. To point it elsewhere, copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL`.

The frontend is at `http://localhost:5173`; the API is at `http://localhost:4000`. The insert-only seed script creates four fictional students with realistic three- and four-instalment plans, including a discounted plan, overdue and partial balances, and completed payments, plus a pending mock reminder and refund-review example. If the local AI service is available when seeding, it creates one explainable rules-baseline counsellor task for the high-risk sample. It provisions:

- Parent accounts: `parent0587@feeflow.demo`, `parent0412@feeflow.demo`, and `parent0773@feeflow.demo` (passwords configured using `DEMO_PARENT_PASSWORD`), each linked to its own student.
- Accounts: `accounts@feeflow.demo` (password configured using `DEMO_ACCOUNTS_PASSWORD`).
- Optional counsellor: `counsellor@feeflow.demo` is created only when `DEMO_COUNSELLOR_PASSWORD` is configured.

For production, configure SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and `SMTP_SECURE`) to deliver verification codes. The API refuses to issue a production OTP when SMTP is not configured. Do not use demo credentials in production.

Parent accounts have a mobile-first dashboard and can start a mock checkout for an outstanding instalment. `MOCK_PAYMENTS_ENABLED` defaults to `true` outside production; mock settlement is always disabled when `NODE_ENV=production`. The simulator is not a real payment gateway. Production payment processing requires a provider integration with server-side verification of signed provider callbacks. Successful mock payments update the fee plan and payment history transactionally. Receipts download as HTML and can be printed or saved as PDF. `RECEIPT_GST_NOTE` is a configurable, explicitly labelled project assumption; its default states that GST is not configured, calculated, or collected. This is not a tax determination or legal-compliance claim.

The reminder scheduler checks the configured offsets (`REMINDER_SCHEDULE_OFFSETS_DAYS`, default `3,0,-3,-7,-15`) every `REMINDER_POLL_INTERVAL_MS`. Positive offsets are days before the due date, zero is the due date, and negative offsets are days after. Reminders use each parent's saved English/Hindi preference, recalculate the remaining amount before delivery, and cancel when an instalment is fully paid. `REMINDER_CATCH_UP_WINDOW_MS` limits late sends after a scheduler outage; overdue schedule points outside that window are skipped rather than sent as a backlog. Incomplete `sending` records older than `REMINDER_STALE_SENDING_TIMEOUT_MS` (default five minutes) are recovered into the retry flow. Failed mock deliveries retry using `REMINDER_RETRY_DELAYS_MS` and can also be retried from the accounts Reminder centre. The mock provider only records the delivery in MongoDB; it does not send SMS or contact a messaging provider.

The AI Risk Monitor calls the local FastAPI `/predict-risk` endpoint through the backend. The active method is explicitly a rules baseline, not a trained model; a separate reproducible scikit-learn experiment uses synthetic labels only. Medium/high flags create a counsellor task for human review. No AI workflow sends reminders, changes fees, suspends students, or applies penalties. See [the AI service documentation](ai-service/README.md).

The accounts overview includes collection/ageing charts and an authenticated CSV export at `GET /api/fees/export.csv`; amounts are exported as decimal INR and CSV cells are quoted and guarded against spreadsheet-formula injection. This is a FeeFlow sample format, not a Tally integration or Tally-compatible import guarantee. The Refund calculator records a policy-versioned calculation and supports review at `GET /api/refunds`, `POST /api/refunds/calculate`, `POST /api/refunds/:refundId/approve`, and `POST /api/refunds/:refundId/reject`. All are accounts-only; approval records an accounts reviewer and never disburses funds.

`REFUND_POLICY_VERSION` defaults to `demo-pro-rata-v1`. The demonstration assumption is `max(0, amount paid − fee earned − non-refundable charges)`, where fee earned is net course fee prorated by completed course days. Net fee and paid amount default to the persisted ledger values; accounts may enter explicit overrides only with a recorded reason. Course dates, total duration, non-refundable charges and the policy version are captured for each calculation. Day counting uses whole UTC calendar-day differences (start date is day zero, withdrawal date is not an extra day), clamped to the course duration; fee earned rounds half up to paise. This is an explicitly labelled demonstration assumption, not a legal formula or an institution's published policy. Confirm applicable published policy before relying on it.

## Useful commands

```powershell
npm run dev
npm run dev:backend
npm run dev:frontend
npm test
npm run test:frontend
npm run seed
npm run build
Set-Location ai-service
.\.venv\Scripts\python.exe -m pytest -q .\tests
```

The backend tests include optional live MongoDB suites; review their test guards before enabling suites that write to configured or disposable databases. See [runtime-validation-report.md](runtime-validation-report.md) for the latest executed regression evidence.

`GET /api/health` reports API and MongoDB readiness. Authentication endpoints are `POST /api/auth/login`, `POST /api/auth/verify-otp`, and authenticated `GET /api/auth/me`. Fee endpoints are `GET /api/fees/students`, `GET /api/fees/student/:studentId`, `POST /api/fees/create-plan`, `GET /api/fees/summary`, `GET /api/fees/dashboard`, `GET /api/fees/export.csv`, and `POST /api/payments/record`. Amounts sent to and returned by the JSON API are integer paise; the portal accepts and displays rupees.

After seeding, sign in with the accounts email and the `DEMO_ACCOUNTS_PASSWORD` from `.env`. Enter the development OTP printed in the backend terminal. The Overview dashboard shows fee totals and students; Fee ledger opens searchable/filterable student records. The accounts role can create fee plans for students without one and record payment transactions. Each parent demo account is restricted to its own linked student.

Sign in to the parent demo with `parent0587@feeflow.demo` and `DEMO_PARENT_PASSWORD`. The parent dashboard shows the linked student's outstanding balance, next instalment and Pay Now action. Continue to the mock checkout and choose a simulated success or failure. Success updates the ledger and provides a downloadable HTML receipt; failure leaves the balance unchanged. Print the receipt or choose “Save as PDF” from the print dialog. The mock checkout is for development/testing only and is disabled in production.

`npm test` runs the backend suite. The configured-database seed, login, dashboard, and parent-isolation test is opt-in because it writes insert-only demo records to the configured MongoDB database:

```powershell
$env:RUN_CONFIGURED_MONGO_SEED_TESTS = "true"
npm test
Remove-Item Env:\RUN_CONFIGURED_MONGO_SEED_TESTS
```

That test runs the safe seed twice and leaves the resulting demo data in place. A separate disposable-MongoDB integration test creates a uniquely named temporary database and removes only that test database; it may require a MongoDB user with database-creation permissions. The Python service tests run from `ai-service` with `.venv\Scripts\python.exe -m pytest`. `npm run build` creates the responsive dashboard build.

See [docs/architecture.md](docs/architecture.md), [docs/database-schema.md](docs/database-schema.md), [docs/TDD.md](docs/TDD.md), and [deployment.md](deployment.md) for implementation and deployment notes.

## Security and privacy

Keep `.env` files, database URIs, signing/HMAC secrets, SMTP credentials, and demo passwords out of source control. The checked-in `.env.example` files contain local placeholders only; replace them privately before use. Configure least-privilege MongoDB access, restrict network exposure, and use a secret manager and HTTPS for production. Development OTPs are printed to the backend console; production OTP delivery requires SMTP. Mock payments and reminder delivery are local demonstrations, not payment or messaging integrations. Student risk scores use an unvalidated rules baseline, are not probabilities, and require human review. Avoid production or real student data in this demo without an approved privacy/security review.

Production-build login screenshots: [mobile](docs/screenshots/login-mobile.png), [tablet](docs/screenshots/login-tablet.png), [desktop](docs/screenshots/login-desktop.png). These show the unauthenticated login page only; they are not evidence of database-backed workflows.
