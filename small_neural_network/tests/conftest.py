from pathlib import Path

import pytest

from addition_nn.train import TrainingConfig, TrainingResult, train_model


@pytest.fixture(scope="session")
def trained_model_result(tmp_path_factory: pytest.TempPathFactory) -> TrainingResult:
    model_path = tmp_path_factory.mktemp("models") / "addition_model.pt"
    return train_model(
        TrainingConfig(
            epochs=220,
            batch_size=512,
            learning_rate=0.02,
            eval_fraction=0.2,
            seed=7,
            model_path=model_path,
        )
    )


@pytest.fixture(scope="session")
def trained_model_path(trained_model_result: TrainingResult) -> Path:
    return trained_model_result.model_path
