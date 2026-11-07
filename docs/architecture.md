# Architecture

## Application scope

The repository is an npm-workspaces monorepo with a React/Vite/Tailwind client, an Express/Mongoose API, and a local FastAPI student-support service. The API owns authentication, validation, authorization, persistence, financial calculations, and communication with the local risk service. Monetary persistence and JSON API values are integer paise.

```text
React + Vite browser
  └── HTTPS/JSON → Express API
                    ├── OTP/JWT authentication, Zod validation, role checks
                    ├── Fee ledger, payment, receipt, refund and dashboard services
                    ├── Mock reminder scheduler/provider (MongoDB only)
                    ├── Local FastAPI risk adapter (no external AI provider)
                    └── Mongoose → MongoDB
                           ├── users, students, fee plans, payments
                           ├── reminders, refunds, OTP challenges
                           └── counsellor tasks/feedback

Local FastAPI → explainable rules baseline
  └── Separate synthetic-only scikit-learn experiment; not used for predictions
```

## Authentication

`POST /api/auth/login` validates credentials and creates a short-lived OTP challenge. In development the OTP is written to the backend console only. In other environments a configured SMTP transport delivers it; when SMTP is missing, the endpoint fails explicitly. Only an HMAC of the OTP is stored, along with an expiry and attempt count. Challenges expire automatically in MongoDB, allow at most five attempts, and are atomically consumed on successful verification.

`POST /api/auth/verify-otp` returns a signed JWT. `GET /api/auth/me` validates the token and fetches the active account from MongoDB. Role middleware uses the current database role rather than trusting a role claim alone. User responses omit password hashes.

## Fee ledger and payments

`GET /api/fees/students` returns active student ledgers. Accounts users see all students; parents see only their linked student. `GET /api/fees/student/:studentId` uses the same access boundary. Accounts-only endpoints create a plan and retrieve institute-wide summary statistics. A plan must contain exactly three or four instalments, with strictly valid, increasing ISO calendar due dates. Omitted custom amounts are split evenly in integer paise, with any remainder assigned one paise at a time to the earliest instalments. Any unpaid balance past its UTC due date is overdue, including partially paid instalments; fully paid instalments are never overdue.

`POST /api/payments/record` accepts `studentId`, `installmentNumber`, `amountPaise`, `transactionId`, and `paymentMethod`. It updates the fee plan and inserts the payment in one MongoDB transaction. Transaction IDs are unique. MongoDB must run as a replica set or mongos; payment recording fails explicitly with `503` on standalone MongoDB rather than risk a split ledger/history update. The ledger calculates statuses and overdue days from UTC dates at read time.

The Day 1 stored fee-plan/payment fields used rupees. Day 2 uses `*Paise` integer fields. Back up an existing database, then run `npm run migrate:fee-ledger`; the migration converts all legacy fee plans and payments to paise in one transaction. For a demo-only database, running the seed script refreshes the seeded fee plans and demo transactions instead.

## Parent portal and mock checkout

The parent dashboard reads only the active student linked to the authenticated parent. It surfaces the outstanding balance, next unpaid instalment, and payment action first; profile, instalment schedule, and payment history use the same parent-to-student access boundary.

`POST /api/parent-payments/orders` accepts only an instalment number. The API derives the student from the authenticated account, validates and fixes the amount to the current instalment balance, and creates a short-lived order with a unique server-generated transaction ID. In non-production, the mock checkout requests a simulated result from the backend mock-gateway adapter; the adapter signs an order-bound callback with a domain-separated server key. The settlement service verifies that signature and all callback/order fields, rechecks the amount against the current ledger, and commits successful payment, ledger update, and order completion in one MongoDB transaction. The browser's simulated outcome is only input to the development simulator, never evidence accepted by settlement. Replays are rejected. Mock settlement is unavailable in production regardless of `MOCK_PAYMENTS_ENABLED`; this simulator is not a real payment integration and its development scenario selector must not be used as payment authorization in a real gateway integration.

`GET /api/parent-payments/receipts/:paymentId` returns a downloadable, printable HTML receipt for an authorised completed payment. It contains student/payment identifiers and the configurable `RECEIPT_GST_NOTE`. The default explicitly states that no GST is configured, calculated, or collected; this is a project assumption, not tax or legal advice.

## Accounts, refunds and reminders

Accounts-only endpoints return collection totals, centre/batch summaries, monthly trend, overdue ageing and a formula-safe CSV export. Refund calculations use a versioned, explicitly assumed pro-rata formula, persist a review record, and require an accounts user to approve/reject it. Approval is not a disbursement.

The reminder scheduler runs in the backend process. It stores mock delivery attempts in MongoDB, uses configured schedule offsets and retry timing, refreshes partial-payment balances, and cancels pending reminders when an instalment is paid. It does not contact an SMS provider.

## Student-support risk workflow

Accounts staff can request a risk assessment; the Node API derives inputs from the fee ledger and student records and calls the configured local FastAPI service. The active prediction method is an explainable rules baseline. The scikit-learn comparison uses generated synthetic data only and is not used by the prediction endpoint. Medium/high flags create a counsellor task; only a counsellor can record valid/false-flag feedback. The risk workflow does not modify fees, reminders, enrolment or penalties.

## Local development and operations

The API reads configuration from environment variables, allows the configured frontend origin, and exposes MongoDB status at `/api/health`. Run `npm run seed` after configuring MongoDB and demo passwords. Run `npm test` for authentication and financial calculation tests and `npm run build` for the frontend production build.

The reminder worker runs as part of the backend process. It schedules idempotent, localized mock reminders using `REMINDER_SCHEDULE_OFFSETS_DAYS`, checks the current ledger immediately before delivery, and retries mock-provider failures according to `REMINDER_RETRY_DELAYS_MS`. Missed reminders outside `REMINDER_CATCH_UP_WINDOW_MS` are cancelled instead of sent in a backlog, and stale `sending` records are recovered after `REMINDER_STALE_SENDING_TIMEOUT_MS`. Parents manage their language preference through the reminder preferences API; accounts staff can view statuses, process a cycle, and retry failed messages in the Reminder centre. No real SMS delivery occurs.

Accounts endpoints provide ledger-backed monthly collection, centre/batch summaries, overdue ageing, and a quoted CSV export. The CSV is a FeeFlow sample export, with decimal INR values and spreadsheet-formula protection; it is not a Tally integration. Refund calculations use a configurable policy version (`REFUND_POLICY_VERSION`) and a clearly disclosed demonstration pro-rata assumption. They are stored for accounts review; approval/rejection is role-protected and does not disburse funds.

The risk service is intentionally a small demonstration, not a validated dropout predictor. There is no verified historical labelled dataset. Its score is not a probability and requires human review. See [the AI service documentation](../ai-service/README.md) for rule thresholds, the synthetic experiment and limitations.
