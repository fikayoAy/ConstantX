"""Inference helpers and command for the addition model."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from .checkpoint import DEFAULT_MODEL_PATH, load_model
from .data import validate_operand
from .model import AdditionNet


def predict_sum(
    a: int,
    b: int,
    *,
    model: AdditionNet | None = None,
    model_path: str | Path | None = DEFAULT_MODEL_PATH,
) -> float:
    """Predict `a + b` with a trained neural network."""

    a = validate_operand(a, "a")
    b = validate_operand(b, "b")
    if model is None:
        if model_path is None:
            raise ValueError("model_path is required when model is not provided")
        model = load_model(model_path)
    model.eval()
    with torch.no_grad():
        features = torch.tensor([[a, b]], dtype=torch.float32)
        prediction = model(features)
    return float(prediction.view(-1)[0].item())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run addition neural network inference.")
    parser.add_argument("a", type=int)
    parser.add_argument("b", type=int)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    prediction = predict_sum(args.a, args.b, model_path=args.model_path)
    print(f"{prediction:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
