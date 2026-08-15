"""Training helpers and command for the addition model."""

from __future__ import annotations

import argparse
import random
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import nn

from .checkpoint import DEFAULT_MODEL_PATH, save_model
from .data import create_dataloaders
from .evaluate import evaluate_model
from .model import AdditionNet, ModelConfig


@dataclass(frozen=True)
class TrainingConfig:
    epochs: int = 250
    batch_size: int = 256
    learning_rate: float = 0.01
    eval_fraction: float = 0.2
    seed: int = 0
    model_path: Path = DEFAULT_MODEL_PATH


@dataclass(frozen=True)
class TrainingResult:
    model: AdditionNet
    train_loss: float
    eval_metrics: dict[str, float]
    model_path: Path


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def train_model(config: TrainingConfig | None = None) -> TrainingResult:
    """Train the addition model with real optimizer-backed updates."""

    config = config or TrainingConfig()
    if config.epochs <= 0:
        raise ValueError("epochs must be positive")
    if config.learning_rate <= 0:
        raise ValueError("learning_rate must be positive")

    set_seed(config.seed)
    train_loader, eval_loader = create_dataloaders(
        batch_size=config.batch_size,
        eval_fraction=config.eval_fraction,
        seed=config.seed,
    )

    model = AdditionNet(ModelConfig())
    loss_fn = nn.MSELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)

    last_loss = 0.0
    model.train()
    for _ in range(config.epochs):
        for features, targets in train_loader:
            predictions = model(features)
            loss = loss_fn(predictions, targets.view(-1, 1))
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            last_loss = float(loss.item())

    eval_metrics = evaluate_model(model, eval_loader)
    saved_path = save_model(model, config.model_path)
    return TrainingResult(model=model, train_loss=last_loss, eval_metrics=eval_metrics, model_path=saved_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train the addition neural network.")
    parser.add_argument("--epochs", type=int, default=TrainingConfig.epochs)
    parser.add_argument("--batch-size", type=int, default=TrainingConfig.batch_size)
    parser.add_argument("--learning-rate", type=float, default=TrainingConfig.learning_rate)
    parser.add_argument("--eval-fraction", type=float, default=TrainingConfig.eval_fraction)
    parser.add_argument("--seed", type=int, default=TrainingConfig.seed)
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = train_model(
        TrainingConfig(
            epochs=args.epochs,
            batch_size=args.batch_size,
            learning_rate=args.learning_rate,
            eval_fraction=args.eval_fraction,
            seed=args.seed,
            model_path=args.model_path,
        )
    )
    print(
        f"saved={result.model_path} "
        f"train_loss={result.train_loss:.6f} "
        f"eval_mse={result.eval_metrics['mse']:.6f} "
        f"eval_mae={result.eval_metrics['mae']:.6f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
