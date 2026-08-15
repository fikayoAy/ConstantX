from pathlib import Path

from addition_nn.checkpoint import load_model
from addition_nn.data import create_dataloaders
from addition_nn.evaluate import evaluate_model


def test_saved_model_loads_for_evaluation(trained_model_path: Path):
    loaded = load_model(trained_model_path)
    _, eval_loader = create_dataloaders(batch_size=512, eval_fraction=0.2, seed=7, shuffle_train=False)
    metrics = evaluate_model(loaded, eval_loader)

    assert metrics["mse"] < 0.05
    assert metrics["mae"] < 0.2
