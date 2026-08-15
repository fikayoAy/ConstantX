from addition_nn.train import TrainingResult


def test_training_runs_and_reports_metrics(trained_model_result: TrainingResult):
    assert trained_model_result.model_path.exists()
    assert trained_model_result.train_loss >= 0
    assert trained_model_result.eval_metrics["mse"] < 0.05
    assert trained_model_result.eval_metrics["mae"] < 0.2
