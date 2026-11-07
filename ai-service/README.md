# FeeFlow AI service

The existing fee assistant remains a private, deterministic feature in the Express API. The student-support risk service is a separate local FastAPI application. Neither feature calls an external AI provider or sends student/payment data to a third party.

## Risk assessment

Run the service from the repository root with:

```powershell
ai-service\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Set `AI_SERVICE_URL` (default `http://127.0.0.1:8000`) and `AI_SERVICE_TIMEOUT_MS` in the backend environment. The Express service calls this local service only for accounts-authorized `POST /api/risks/assess`. Counsellors can read tasks and record one valid/false-flag decision. Parents cannot access risk records. The Node API—not the browser—derives the input features from fee, attendance, test, and recorded promise data.

The safe demo seed provisions `counsellor@feeflow.demo` only when `DEMO_COUNSELLOR_PASSWORD` is set to a 12–128 character value. Re-running the seed is insert-only for that account; a conflicting or changed seed-managed identity/password is reported rather than overwritten.

FastAPI exposes:

- `GET /health` — reports the active prediction method.
- `POST /predict-risk` — validates feature ranges and returns an explainable assessment.

The active method is explicitly `explainable_rules_baseline`, not a trained model. Each feature contributes the following points:

| Feature | Points |
|---|---:|
| Each missed instalment | 15, capped at 30 |
| Overdue days | 5 for 1–7 days; 10 for 8–14; 20 for 15+ |
| Attendance | 20 below 70%; 10 below 80% |
| Test score change | 15 at −5 percentage points or lower; 8 below −2 |
| Each broken payment promise | 12, capped at 24 |

Contributions are capped at 100. Risk levels are LOW (0–29), MEDIUM (30–59), and HIGH (60–100). Missing input features are excluded rather than treated as zero and are returned in `missingFeatures`, with a caution in the reasons. An absent fee plan, short test history, or absent payment-promise history is represented as unavailable where applicable. Overdue days are the maximum elapsed whole days among unpaid overdue instalments, calculated relative to UTC day boundaries. Test trend is the latest test score minus the preceding test score, in percentage points.

Medium/high assessments create or update one open counsellor task per student. Low assessments do not create a task. The uniqueness constraint prevents concurrent duplicate open tasks. The API never writes fees, payments, reminders, enrolment status, or penalties. Feedback records the counsellor, time, decision, and optional note; a false flag is dismissed and a valid flag remains in progress for human follow-up.

## Synthetic ML comparison

`app/experiment.py` creates a reproducible synthetic dataset and compares:

1. The documented rules baseline.
2. A scikit-learn StandardScaler + LogisticRegression pipeline.

The synthetic high-risk labels are derived from the rules score threshold and flipped with 8% random noise. The split is stratified 75/25 with a fixed seed; scaling and model fitting occur only on the training partition. Accuracy, balanced accuracy, high-risk precision/recall/F1, and ROC-AUC are reported on the held-out synthetic test set.

Run it with:

```powershell
ai-service\.venv\Scripts\python.exe -m app.experiment
```

These metrics measure recovery of artificial labels only. They are not real dropout outcomes, do not establish real-world predictive accuracy, and the sklearn model is not used by `/predict-risk`.

The recorded run (`sample_count=5000`, seed `2026`, 3,750 train / 1,250 test) produced:

| Synthetic test metric | Rules baseline | Logistic regression |
|---|---:|---:|
| Accuracy | 0.9168 | 0.8120 |
| Balanced accuracy | 0.8877 | 0.8168 |
| High-risk precision | 0.9101 | 0.6551 |
| High-risk recall | 0.8114 | 0.8295 |
| High-risk F1 | 0.8579 | 0.7320 |
| ROC-AUC | 0.9006 | 0.8698 |

These are reproducible implementation checks against the generated labels only. They must not be interpreted as expected accuracy on FeeFlow students or real dropout behavior.

## Features, limitations, and human oversight

Inputs are missed instalment count, overdue days, attendance percentage, latest test score change, and broken promise count. The backend derives these values from FeeFlow records; the AI service rejects unknown fields, invalid ranges, and malformed student IDs.

There is no verified, labelled historical dropout dataset in this project. The rules are a small demonstrator, not a validated prediction instrument. They can create false positives because financial delay or attendance changes may have many causes; missing or stale records can also distort an assessment. A risk score is not a probability of dropout and must not be used to judge intent, ability, or eligibility.

Only a counsellor can mark a task valid or a false flag. Review is a supportive follow-up workflow; risk outputs cannot send reminders, alter financial records, suspend a student, or apply a penalty. Accounts staff can request an assessment but cannot submit counsellor feedback.

## Tests

From `ai-service`:

```powershell
.venv\Scripts\python.exe -m pytest
```

The Python tests cover health, low/high rules assessments, missing features, invalid input, and reproducibility of the synthetic experiment. Node API tests cover role restrictions, AI-service unavailability, task creation/deduplication, counsellor feedback, and fee/reminder non-mutation.
