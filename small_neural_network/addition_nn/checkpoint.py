"""Model persistence helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import torch

from .model import AdditionNet, ModelConfig

DEFAULT_MODEL_PATH = Path("artifacts/addition_model.pt")


def save_model(model: AdditionNet, path: str | Path = DEFAULT_MODEL_PATH) -> Path:
    """Save model weights and architecture metadata."""

    output_path = Path(path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "model_config": model.config.to_dict(),
        "state_dict": model.state_dict(),
    }
    torch.save(payload, output_path)
    return output_path


def load_model(path: str | Path = DEFAULT_MODEL_PATH, *, map_location: str | torch.device = "cpu") -> AdditionNet:
    """Load a saved model artifact for inference or evaluation."""

    checkpoint_path = Path(path)
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"model artifact not found: {checkpoint_path}")
    try:
        payload = torch.load(checkpoint_path, map_location=map_location, weights_only=True)
    except TypeError:
        payload = torch.load(checkpoint_path, map_location=map_location)
    config = ModelConfig.from_dict(payload.get("model_config"))
    model = AdditionNet(config)
    model.load_state_dict(payload["state_dict"])
    model.eval()
    return model
