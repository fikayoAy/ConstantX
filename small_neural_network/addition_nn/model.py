"""Feed-forward PyTorch model for scalar addition regression."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import torch
from torch import nn

from .data import INPUT_DIM


@dataclass(frozen=True)
class ModelConfig:
    input_dim: int = INPUT_DIM
    output_dim: int = 1

    def to_dict(self) -> dict[str, int]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> "ModelConfig":
        if raw is None:
            return cls()
        return cls(input_dim=int(raw.get("input_dim", INPUT_DIM)), output_dim=int(raw.get("output_dim", 1)))


class AdditionNet(nn.Module):
    """Small feed-forward neural network with one trainable linear head."""

    def __init__(self, config: ModelConfig | None = None) -> None:
        super().__init__()
        self.config = config or ModelConfig()
        self.linear = nn.Linear(self.config.input_dim, self.config.output_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if x.shape[-1] != self.config.input_dim:
            raise ValueError(f"expected input last dimension {self.config.input_dim}, got {x.shape[-1]}")
        return self.linear(x.float())
