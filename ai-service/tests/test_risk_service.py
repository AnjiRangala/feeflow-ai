import asyncio

import httpx

from app.main import app

def request(method, path, **kwargs):
    async def send():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def complete_features(**overrides):
    values = {
        "studentId": "STU-0587",
        "missedInstallments": 0,
        "overdueDays": 0,
        "attendancePercentage": 92,
        "testPerformanceTrend": 2,
        "brokenPaymentPromises": 0,
    }
    values.update(overrides)
    return values


def test_health_discloses_rules_engine_and_synthetic_experiment():
    response = request("GET", "/health")
    assert response.status_code == 200
    assert response.json()["predictionMethod"] == "explainable_rules_baseline"
    assert response.json()["syntheticMlExperimentOnly"] is True


def test_low_risk_prediction_explains_score_and_recommends_monitoring():
    response = request("POST", "/predict-risk", json=complete_features())
    assert response.status_code == 200
    result = response.json()
    assert result["studentId"] == "STU-0587"
    assert result["riskLevel"] == "LOW"
    assert result["riskScore"] == 0
    assert result["reasons"] == []
    assert result["recommendedAction"] == "Continue routine monitoring"
    assert result["assessmentMethod"] == "explainable_rules_baseline"


def test_high_risk_prediction_returns_explainable_score_breakdown():
    response = request("POST", "/predict-risk", json=complete_features(
        missedInstallments=1,
        overdueDays=21,
        attendancePercentage=65,
        testPerformanceTrend=-10,
        brokenPaymentPromises=1,
    ))
    result = response.json()
    assert result["riskLevel"] == "HIGH"
    assert result["riskScore"] == 82
    assert result["recommendedAction"] == "Create counsellor follow-up task"
    assert "Attendance below 70%" in result["reasons"]
    assert "Test performance declining" in result["reasons"]
    assert sum(result["scoreBreakdown"].values()) == result["riskScore"]


def test_missing_features_are_marked_and_excluded_from_score():
    response = request("POST", "/predict-risk", json=complete_features(
        testPerformanceTrend=None,
        brokenPaymentPromises=None,
    ))
    result = response.json()
    assert response.status_code == 200
    assert result["missingFeatures"] == ["testPerformanceTrend", "brokenPaymentPromises"]
    assert "Some feature data is unavailable; interpret this score cautiously" in result["reasons"]
    assert result["riskScore"] == 0


def test_missing_student_identifier_and_out_of_range_features_are_rejected():
    missing = complete_features()
    del missing["studentId"]
    assert request("POST", "/predict-risk", json=missing).status_code == 422
    assert request("POST", "/predict-risk", json=complete_features(attendancePercentage=140)).status_code == 422
    assert request("POST", "/predict-risk", json=complete_features(unexpectedField=1)).status_code == 422
