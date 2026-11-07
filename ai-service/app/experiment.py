"""Reproducible, synthetic-only comparison; never used by the prediction API."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURE_COLUMNS = [
    "missedInstallments",
    "overdueDays",
    "attendancePercentage",
    "testPerformanceTrend",
    "brokenPaymentPromises",
]


def synthetic_risk_score(frame: pd.DataFrame) -> np.ndarray:
    missed = np.minimum(frame["missedInstallments"].to_numpy() * 15, 30)
    overdue_days = frame["overdueDays"].to_numpy()
    overdue = np.where(overdue_days == 0, 0, np.where(overdue_days <= 7, 5, np.where(overdue_days <= 14, 10, 20)))
    attendance_values = frame["attendancePercentage"].to_numpy()
    attendance = np.where(attendance_values < 70, 20, np.where(attendance_values < 80, 10, 0))
    trend_values = frame["testPerformanceTrend"].to_numpy()
    trend = np.where(trend_values <= -5, 15, np.where(trend_values < -2, 8, 0))
    promises = np.minimum(frame["brokenPaymentPromises"].to_numpy() * 12, 24)
    return np.minimum(missed + overdue + attendance + trend + promises, 100)


def classification_metrics(y_true: np.ndarray, predicted: np.ndarray, score: np.ndarray) -> dict:
    return {
        "accuracy": round(float(accuracy_score(y_true, predicted)), 4),
        "balancedAccuracy": round(float(balanced_accuracy_score(y_true, predicted)), 4),
        "precisionHighRisk": round(float(precision_score(y_true, predicted, zero_division=0)), 4),
        "recallHighRisk": round(float(recall_score(y_true, predicted, zero_division=0)), 4),
        "f1HighRisk": round(float(f1_score(y_true, predicted, zero_division=0)), 4),
        "rocAuc": round(float(roc_auc_score(y_true, score)), 4),
    }


def run_experiment(sample_count: int = 5000, seed: int = 2026) -> dict:
    rng = np.random.default_rng(seed)
    features = pd.DataFrame({
        "missedInstallments": rng.poisson(0.7, sample_count).clip(0, 5),
        "overdueDays": rng.integers(0, 91, sample_count),
        "attendancePercentage": rng.uniform(35, 100, sample_count),
        "testPerformanceTrend": rng.normal(-1, 8, sample_count).clip(-30, 30),
        "brokenPaymentPromises": rng.poisson(0.25, sample_count).clip(0, 4),
    }, columns=FEATURE_COLUMNS)

    baseline_score = synthetic_risk_score(features)
    deterministic_label = (baseline_score >= 60).astype(int)
    noise = rng.random(sample_count) < 0.08
    labels = np.where(noise, 1 - deterministic_label, deterministic_label)
    x_train, x_test, y_train, y_test = train_test_split(
        features, labels, test_size=0.25, random_state=seed, stratify=labels
    )
    baseline_test_score = synthetic_risk_score(x_test)
    baseline_predictions = (baseline_test_score >= 60).astype(int)

    pipeline = make_pipeline(
        StandardScaler(),
        LogisticRegression(max_iter=1000, class_weight="balanced", random_state=seed),
    )
    pipeline.fit(x_train, y_train)
    ml_probabilities = pipeline.predict_proba(x_test)[:, 1]
    ml_predictions = (ml_probabilities >= 0.5).astype(int)

    return {
        "dataset": "synthetic",
        "samples": sample_count,
        "seed": seed,
        "trainSamples": len(x_train),
        "testSamples": len(x_test),
        "labelAssumption": "Synthetic high-risk label is generated from the documented rules score threshold and flipped with 8% random label noise.",
        "split": "75/25 stratified train/test; scaler and logistic regression are fit only on training data.",
        "metrics": {
            "rulesBaseline": classification_metrics(y_test, baseline_predictions, baseline_test_score),
            "logisticRegression": classification_metrics(y_test, ml_predictions, ml_probabilities),
        },
        "warning": "Metrics evaluate recovery of synthetic labels only; they are not estimates of real-world dropout performance.",
    }


if __name__ == "__main__":
    print(json.dumps(run_experiment(), indent=2))
