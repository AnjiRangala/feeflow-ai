from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict, Field

app = FastAPI(
    title="FeeFlow Student Support Risk Service",
    version="1.0.0",
    description="Local, explainable rules baseline. Synthetic ML experiments are not used for predictions.",
)


class RiskFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    studentId: Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]
    missedInstallments: Annotated[int | None, Field(default=None, ge=0, le=100)]
    overdueDays: Annotated[int | None, Field(default=None, ge=0, le=36500)]
    attendancePercentage: Annotated[float | None, Field(default=None, ge=0, le=100)]
    testPerformanceTrend: Annotated[float | None, Field(default=None, ge=-100, le=100)]
    brokenPaymentPromises: Annotated[int | None, Field(default=None, ge=0, le=100)]


def assess_risk(features: RiskFeatures) -> dict:
    frame = pd.DataFrame([{
        "missedInstallments": features.missedInstallments,
        "overdueDays": features.overdueDays,
        "attendancePercentage": features.attendancePercentage,
        "testPerformanceTrend": features.testPerformanceTrend,
        "brokenPaymentPromises": features.brokenPaymentPromises,
    }])
    row = frame.iloc[0]
    score = 0
    score_breakdown: dict[str, int] = {}
    reasons: list[str] = []
    missing_features: list[str] = []

    def add_points(feature: str, points: int) -> None:
        nonlocal score
        applied = min(points, 100 - score)
        score += applied
        score_breakdown[feature] = applied

    missed = row["missedInstallments"]
    if pd.isna(missed):
        missing_features.append("missedInstallments")
    elif missed > 0:
        points = min(30, int(missed) * 15)
        add_points("missedInstallments", points)
        reasons.append(f"{int(missed)} missed instalment{'s' if missed != 1 else ''} recorded")
    else:
        score_breakdown["missedInstallments"] = 0

    overdue = row["overdueDays"]
    if pd.isna(overdue):
        missing_features.append("overdueDays")
    elif overdue > 0:
        points = 5 if overdue <= 7 else 10 if overdue <= 14 else 20
        add_points("overdueDays", points)
        reasons.append(f"Instalment overdue by {int(overdue)} day{'s' if overdue != 1 else ''}")
    else:
        score_breakdown["overdueDays"] = 0

    attendance = row["attendancePercentage"]
    if pd.isna(attendance):
        missing_features.append("attendancePercentage")
    elif attendance < 70:
        add_points("attendancePercentage", 20)
        reasons.append("Attendance below 70%")
    elif attendance < 80:
        add_points("attendancePercentage", 10)
        reasons.append("Attendance below 80%")
    else:
        score_breakdown["attendancePercentage"] = 0

    trend = row["testPerformanceTrend"]
    if pd.isna(trend):
        missing_features.append("testPerformanceTrend")
    elif trend <= -5:
        add_points("testPerformanceTrend", 15)
        reasons.append("Test performance declining")
    elif trend < -2:
        add_points("testPerformanceTrend", 8)
        reasons.append("Test performance has decreased")
    else:
        score_breakdown["testPerformanceTrend"] = 0

    broken = row["brokenPaymentPromises"]
    if pd.isna(broken):
        missing_features.append("brokenPaymentPromises")
    elif broken > 0:
        points = min(24, int(broken) * 12)
        add_points("brokenPaymentPromises", points)
        reasons.append(f"{int(broken)} broken payment promise{'s' if broken != 1 else ''} recorded")
    else:
        score_breakdown["brokenPaymentPromises"] = 0

    risk_score = min(100, score)
    risk_level = "HIGH" if risk_score >= 60 else "MEDIUM" if risk_score >= 30 else "LOW"
    recommended_action = (
        "Create counsellor follow-up task"
        if risk_level in {"HIGH", "MEDIUM"}
        else "Continue routine monitoring"
    )
    if missing_features:
        reasons.append("Some feature data is unavailable; interpret this score cautiously")

    return {
        "studentId": features.studentId,
        "riskLevel": risk_level,
        "riskScore": risk_score,
        "reasons": reasons,
        "recommendedAction": recommended_action,
        "scoreBreakdown": score_breakdown,
        "missingFeatures": missing_features,
        "assessmentMethod": "explainable_rules_baseline",
        "modelVersion": "rules-baseline-v1",
        "limitations": [
            "This rules baseline is not a trained or clinically validated model.",
            "A risk flag is a prompt for supportive human review, not a finding about intent or ability.",
        ],
    }


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "student-support-risk",
        "predictionMethod": "explainable_rules_baseline",
        "syntheticMlExperimentOnly": True,
    }


@app.post("/predict-risk")
def predict_risk(features: RiskFeatures) -> dict:
    return assess_risk(features)
