"""Dataset generation for bounded integer addition examples."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import torch
from torch.utils.data import DataLoader, Dataset, random_split

MIN_VALUE = 0
MAX_VALUE = 100
INPUT_DIM = 2


@dataclass(frozen=True)
class AdditionExample:
    """One supervised addition example."""

    a: int
    b: int
    target: int


def validate_operand(value: int, name: str) -> int:
    """Validate a public addition operand."""

    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer")
    if value < MIN_VALUE or value > MAX_VALUE:
        raise ValueError(f"{name} must satisfy {MIN_VALUE} <= {name} <= {MAX_VALUE}")
    return value


def generate_examples(min_value: int = MIN_VALUE, max_value: int = MAX_VALUE) -> list[AdditionExample]:
    """Generate the complete finite-domain addition dataset."""

    if min_value < 0 or max_value < min_value:
        raise ValueError("expected 0 <= min_value <= max_value")
    return [
        AdditionExample(a=a, b=b, target=a + b)
        for a in range(min_value, max_value + 1)
        for b in range(min_value, max_value + 1)
    ]


class AdditionDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    """PyTorch dataset of two-input integer addition examples."""

    def __init__(self, examples: Iterable[AdditionExample] | None = None) -> None:
        self.examples: list[AdditionExample] = list(examples) if examples is not None else generate_examples()
        if not self.examples:
            raise ValueError("AdditionDataset requires at least one example")

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        example = self.examples[index]
        features = torch.tensor([example.a, example.b], dtype=torch.float32)
        target = torch.tensor([example.target], dtype=torch.float32)
        return features, target


def create_dataloaders(
    examples: Sequence[AdditionExample] | None = None,
    *,
    batch_size: int = 128,
    eval_fraction: float = 0.2,
    seed: int = 0,
    shuffle_train: bool = True,
) -> tuple[DataLoader[tuple[torch.Tensor, torch.Tensor]], DataLoader[tuple[torch.Tensor, torch.Tensor]]]:
    """Create deterministic train/evaluation DataLoaders."""

    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    if not 0 < eval_fraction < 1:
        raise ValueError("eval_fraction must be between 0 and 1")

    dataset = AdditionDataset(examples)
    eval_size = max(1, int(round(len(dataset) * eval_fraction)))
    train_size = len(dataset) - eval_size
    if train_size <= 0:
        raise ValueError("eval_fraction leaves no training examples")

    generator = torch.Generator().manual_seed(seed)
    train_dataset, eval_dataset = random_split(dataset, [train_size, eval_size], generator=generator)

    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=shuffle_train,
        generator=torch.Generator().manual_seed(seed + 1),
    )
    eval_loader = DataLoader(eval_dataset, batch_size=batch_size, shuffle=False)
    return train_loader, eval_loader
