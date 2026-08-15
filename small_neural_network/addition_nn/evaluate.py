"""Evaluation helpers and command for the addition model."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from .checkpoint import DEFAULT_MODEL_PATH, load_model
from .data import create_dataloaders
from .model import AdditionNet


def evaluate_model(
    model: AdditionNet,
    dataloader: DataLoader[tuple[torch.Tensor, torch.Tensor]],
    *,
    device: str | torch.device = "cpu",
) -> dict[str, float]:
    """Report held-out scalar prediction error without updating weights."""

    model.to(device)
    model.eval()
    squared_error = 0.0
    absolute_error = 0.0
    sample_count = 0

    with torch.no_grad():
        for features, targets in dataloader:
            features = features.to(device)
            targets = targets.to(device).view(-1, 1)
            predictions = model(features)
            errors = predictions - targets
            squared_error += torch.sum(errors.pow(2)).item()
            absolute_error += torch.sum(errors.abs()).item()
            sample_count += targets.numel()

    if sample_count == 0:
        raise ValueError("cannot evaluate on an empty dataloader")
    return {"mse": squared_error / sample_count, "mae": absolute_error / sample_count}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate the addition neural network.")
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--eval-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    model = load_model(args.model_path)
    _, eval_loader = create_dataloaders(
        batch_size=args.batch_size,
        eval_fraction=args.eval_fraction,
        seed=args.seed,
        shuffle_train=False,
    )
    metrics = evaluate_model(model, eval_loader)
    print(f"mse={metrics['mse']:.6f} mae={metrics['mae']:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
