from pathlib import Path

import pytest

from addition_nn.checkpoint import load_model
from addition_nn.infer import predict_sum


def test_predict_sum_uses_trained_model(trained_model_path: Path):
    loaded = load_model(trained_model_path)

    assert abs(predict_sum(20, 22, model=loaded) - 42.0) < 0.5
    assert abs(predict_sum(100, 100, model=loaded) - 200.0) < 0.5


def test_predict_sum_requires_model_or_model_path():
    with pytest.raises(ValueError):
        predict_sum(1, 2, model=None, model_path=None)
