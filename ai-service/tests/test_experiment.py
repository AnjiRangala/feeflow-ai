from app.experiment import run_experiment


def test_synthetic_experiment_is_reproducible_and_reports_separated_metrics():
    first = run_experiment(sample_count=800, seed=10)
    second = run_experiment(sample_count=800, seed=10)
    assert first == second
    assert first["dataset"] == "synthetic"
    assert first["trainSamples"] == 600
    assert first["testSamples"] == 200
    assert set(first["metrics"]) == {"rulesBaseline", "logisticRegression"}
    for metrics in first["metrics"].values():
        assert 0 <= metrics["precisionHighRisk"] <= 1
        assert 0 <= metrics["recallHighRisk"] <= 1
        assert 0 <= metrics["f1HighRisk"] <= 1
