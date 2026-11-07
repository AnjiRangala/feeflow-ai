# Runtime Validation Report

**Generated**: 2026-11-06T09:16:33+05:30
**Target**: `C:\IsoCode-sajo`
**Database**: `feeflow_ai` (configured Atlas deployment)

## Summary

| Step | Status | Exit Code | Details |
|---|---|---:|---|
| Phase 1 connection and health | PASS | 0 | MongoDB auth, ping, read/write/cleanup probe, and backend health were verified previously. |
| Phase 2 safe seed | PASS | 0 | Four users, four students, four fee plans, two payments, one seed reminder, and one seed refund remain. |
| Phase 3 MongoDB workflow tests | PASS | 0 | After the risk-task upsert fix, all three live MongoDB integration files passed; isolated test records were cleaned up. |
| Dashboard API against MongoDB | PASS | 0 | Financial totals and new student, refund, reminder, and risk metrics matched real MongoDB aggregations. |
| FastAPI risk service | PASS | 0 | Local `/health` and `/predict-risk` returned HTTP 200; Express-to-service assessment and MongoDB counsellor-task persistence succeeded. |
| MongoDB transactions | PASS | 0 | An isolated user insert/delete committed within one transaction; no probe record remained. |

**Overall**: PASS for the Phase 3 workflows and Accounts Dashboard metrics update. Reminder audit callbacks remain in-process only and are not persisted.

## Workflow Results

| Workflow | Result | Evidence |
|---|---|---|
| Parent authentication | PASS | All three configured demo parents logged in; JWTs validated through `/auth/me`. |
| Accounts login | PASS | Demo Accounts Executive login and JWT validation succeeded. |
| Parent isolation | PASS | Cross-parent student ledger and receipt requests were denied; role restrictions and unauthorized requests were checked against MongoDB-backed API responses. |
| Payment order | PASS | Two mock orders persisted on an isolated QA student. |
| Payment settlement | PASS | Mock failure left the ledger unchanged; mock success created one linked payment and updated its ledger. Duplicate settlement was rejected; invalid signatures were rejected. |
| Payment receipt | PASS | Receipt generated for the test payment; another parent received 404. |
| Reminder persistence | PASS | Isolated reminder records were stored/retrieved; duplicate schedule produced no new records. Hindi and English preferences/messages were verified. |
| Reminder cancellation | PASS | A fully paid test instalment cancelled its pending reminder. Retry and stale-delivery recovery were verified with mock delivery. |
| Refund calculation | PASS | Calculation used the isolated student's MongoDB ledger and stored the configured policy version. |
| Refund approval | PASS | Separate isolated refunds were approved/rejected; review fields persisted and no disbursement occurred. Parent review requests were denied. |
| AI risk assessment | PASS | FastAPI prediction and Express-to-FastAPI communication succeeded; new task creation and repeated assessment were verified in MongoDB. |
| Counsellor workflow | PASS | Counsellor task retrieval and persisted valid/false-flag feedback were verified; parent access was denied. |
| Dashboard aggregation | PASS | Financial totals were unchanged; active-student, refund, reminder, and per-student latest-risk metrics matched live MongoDB aggregations. Parents received 403 for the accounts-only dashboard route. |
| MongoDB transactions | PASS | Safe insert/delete transaction on a unique test identity succeeded; payment recording and mock settlement use transactions. |

## Current Database Evidence

| Metric | Verified value |
|---|---:|
| Demo users | 4 |
| Demo students | 4 |
| Demo fee plans | 4 |
| Demo completed payments | 2 |
| Seed-keyed reminder examples | 1 |
| Seed-keyed refunds | 1 |
| Seed-keyed counsellor tasks | 0 |
| Isolated risk assessment records | 4 created and deleted during the live workflow test |
| Active students | 4 |
| Total fees billed | 48,000,000 paise |
| Net fees | 47,400,000 paise |
| Collected fees | 4,500,000 paise |
| Outstanding dues | 42,900,000 paise |
| Overdue dues | 4,350,000 paise |

The database also contained 31 scheduled reminders at the post-run check; one matched the named seed example. The other 30 were preserved, and their provenance was not verified. No audit-event collection/model was found; reminder audit callbacks are in-process only.

## Test Data and Cleanup

- Tests created two isolated students, two fee plans, five temporary users, two mock payment orders, one payment, ten reminders, two refund records, and one counsellor task.
- Every isolated QA record was deleted during cleanup; the post-run check found zero test-prefixed users, students, fee plans, payments, orders, reminders, refunds, counsellor tasks, or risk assessments.
- A transaction probe document was inserted and deleted inside the transaction; no record remained.
- No seeded student, fee plan, payment, refund, or reminder was intentionally modified or deleted. No real payment gateway or message provider was used.

## Test Evidence

- Command: `npm test --workspace backend -- --test-concurrency=1`
- Final result: 71 passed, 0 failed, 2 optional integrations skipped; exit code 0. The live MongoDB auth/isolation, payment/refund/transaction, and reminder/risk/dashboard workflows all passed.
- Risk fix regression: the first Express assessment created one MongoDB counsellor task; repeated assessments returned the same task and preserved its creation time and feedback history.
- Risk dashboard regression: every successful assessment, including low-risk results, was persisted; repeated assessments remained one current risk category per active student. Four isolated assessment documents were deleted during cleanup.
- Dashboard integration comparison: finance, status counts, and risk distribution matched live MongoDB query results while six active students (including two isolated test fixtures) were present. All fixture records were removed afterward.
- Frontend production build: `npm run build --workspace frontend` — passed.
- Node.js `v24.11.0`; Docker CLI unavailable. Browser rendering was not exercised; the responsive dashboard was validated by the successful production build and backend integration checks.

## Issues Found

| # | Severity | Description |
|---|---|---|
| 1 | Resolved (High) | [student-risk.js](./backend/src/services/student-risk.js) originally included `studentId` in both `$set` and `$setOnInsert`; it is now only in `$set`, and first-task creation passed against MongoDB. |
| 2 | Resolved (Medium) | Dashboard operational metrics are now returned from MongoDB aggregations and rendered in the Accounts dashboard. Low-risk results are persisted in the new risk-assessment collection. Historical task records remain a fallback for students without a persisted assessment. |
| 3 | Medium | Reminder audit callbacks are not persisted to MongoDB; no audit-event model/collection exists. |
| 4 | Info | Thirty non-seed reminders were present in addition to the one seed-keyed example; their provenance was not verified and they were preserved. |

## Risk Task Fix Follow-up

**Verified**: 2026-11-06T09:16:33+05:30

The upsert now writes `status: 'open'` only via `$setOnInsert`; `studentId` and `openTaskStudentId` are each set once via `$set`. The existing unique sparse `openTaskStudentId` index remains unchanged.

The live test used isolated student fixtures and verified task creation, student association, risk score/explanation persistence, counsellor retrieval, valid and false-flag feedback, parent denial, and duplicate prevention on repeated assessments. Existing task ID, creation time, and feedback history remained intact. All test fixtures were removed; the final check found zero test-prefixed QA records. Demo counts remain unchanged at 4 users, 4 students, 4 fee plans, 2 payments, 1 seed reminder, 1 seed refund, and 0 seed counsellor tasks.

## Accounts Dashboard Metrics

The accounts-only dashboard response now includes `metrics.students` (`totalActive`, `assessedForRisk`), `metrics.refunds` (`total`, `pending`, `approved`, `rejected`), `metrics.reminders` (`total`, `scheduled`, `pending`, `sent`, `failed`, `cancelled`), and `metrics.riskDistribution` (`low`, `medium`, `high`). Reminder `pending` means `scheduled + sending`; the `scheduled` field is the exact scheduled state count.

Student, refund, and reminder aggregations are limited to valid active student IDs and recognized statuses. Risk results are grouped by student, sorted newest-first, and counted once per active student. New risk assessments are retained in `RiskAssessment`, including low-risk results; existing counsellor-task records supply a fallback only for students without a persisted assessment. The financial ledger calculations were not changed.

The Accounts dashboard now displays student and workflow summary cards, risk and reminder status charts, and the refund review summary. Mobile breakpoints collapse the charts and refund summary into a single column. Parent requests remain denied by the existing accounts-role route guard.

## Phase 4: Automated Regression Validation

**Validated**: 2026-11-06T09:56:14+05:30
**Scope**: Regression tests, live MongoDB integration, FastAPI, and browser validation. No production behavior was changed in Phase 4.

### Results

| Tier | Status | Exit code | Results |
|---|---|---:|---|
| Backend | PASS | 0 | `npm test --workspace backend -- --test-concurrency=1`: 73 passed, 0 failed, 2 skipped (75 total). |
| Configured MongoDB integration | PASS | 0 | Authentication/parent isolation, payment/refund/transactions, reminders, risk assessment/task workflow, and dashboard aggregation ran against `feeflow_ai`; isolated records were cleaned. |
| AI service | PASS | 0 | `.venv\Scripts\python.exe -m pytest -q .\tests` from `ai-service`: 6 passed. |
| Frontend browser tests | PASS | 0 | `npm run test:frontend`: 6 Playwright tests passed at desktop/mobile sizes. UI tests mock the API; real persistence is covered by backend integration tests. |
| Frontend production build | PASS | 0 | `npm run build --workspace frontend` completed successfully. |
| Secret ignore check | PASS | 0 | `.env` and `.env.*` ignore patterns and the `.env.example` exception are present; environment file contents were not read. |

### Coverage Executed

- Backend regression coverage includes login/OTP and JWT validation, invalid and expired JWT rejection, role authorization, parent/student isolation, fee ledgers, payment order/settlement/receipt paths, invalid signatures and duplicate settlement, refund review restrictions, reminder workflows, risk categories, duplicate task prevention, counsellor feedback, dashboard aggregation, and malformed input.
- Live MongoDB tests verified mock payment/refund workflows, transaction support, reminder persistence/retries/cancellation, risk assessment persistence and financial non-mutation, counsellor task/feedback persistence, and dashboard values against database queries.
- Added risk-level regression coverage for LOW, MEDIUM, and HIGH persistence. The live test asserted LOW creates no counsellor task and MEDIUM creates one; existing live coverage exercises HIGH and repeated-assessment idempotency.
- Playwright covered login errors and role navigation, dashboard cards/charts and mobile layout, dashboard API error state, parent mock payment and receipt flow, reminder/refund/risk/counsellor UI workflows, and counsellor financial-navigation denial.
- AI service tests cover health, prediction inputs, risk scoring/explanations, and invalid/missing features.

### Skips and Limitations

- Two optional backend tests were skipped by their explicit guards: configured seed verification requires `RUN_CONFIGURED_MONGO_SEED_TESTS=true`; the disposable-database integration suite requires `RUN_MONGODB_INTEGRATION_TESTS=true`. The configured `feeflow_ai` live MongoDB workflow tests ran separately and passed.
- Docker is unavailable. This did not prevent Playwright execution; Chromium was available and the browser suite ran.
- Browser tests use mocked API responses, not a live-browser-to-Express session. Express-to-FastAPI and MongoDB persistence were verified in the live backend integration suite.
- Reminder audit events are still callback-only and not persisted in MongoDB (previously identified limitation).
- `.git` metadata is absent, so whether any environment file is tracked could not be verified; ignore rules were checked without reading secrets.
- No actual payment gateway, refund disbursement, or external reminder delivery was used.

### Issues and Retries

- No Phase 4 production defect was found. New regression tests cover expired JWT rejection and persistence of all three risk categories.
- An initial backend run could not reach FastAPI because it was not running; after starting the local service, the complete backend suite passed.
- One live MongoDB attempt encountered a transient Atlas connection closure and cleaned its isolated records. A subsequent live workflow run and the final full backend run passed.
- The new live risk-level fixtures initially hit the login rate limit; the test was corrected to reuse the already authenticated Accounts Executive token, avoiding unnecessary logins.

**Overall Phase 4**: PASS for executed checks. Phase 5 was not started.
