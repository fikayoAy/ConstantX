from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import torch
from torch import Tensor, nn
from torch.utils.data import DataLoader, TensorDataset

from .data import MNIST_CLASS_COUNT, MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH, MNISTSplit


@dataclass(frozen=True)
class ModelConfig:
    input_channels: int = 1
    conv1_channels: int = 32
    conv2_channels: int = 64
    hidden_units: int = 128
    dropout: float = 0.25
    num_classes: int = MNIST_CLASS_COUNT


@dataclass(frozen=True)
class TrainingConfig:
    epochs: int = 1
    batch_size: int = 64
    learning_rate: float = 0.001
    beta1: float = 0.9
    beta2: float = 0.999
    eps: float = 1e-8
    device: str = "cpu"
    seed: Optional[int] = None
    shuffle: bool = True
    output_dir: Optional[Union[str, Path]] = None
    model_filename: str = "mnist_cnn.pt"
    history_filename: str = "training_history.json"


@dataclass(frozen=True)
class EpochMetrics:
    epoch: int
    training_loss: float
    training_accuracy: float
    validation_loss: Optional[float] = None
    validation_accuracy: Optional[float] = None


@dataclass(frozen=True)
class TrainingResult:
    model: "MNISTClassifier"
    history: List[EpochMetrics]
    model_path: Optional[Path]
    history_path: Optional[Path]


class MNISTClassifier(nn.Module):
    def __init__(self, config: ModelConfig = ModelConfig()) -> None:
        super().__init__()
        _validate_model_config(config)
        self.config = config
        self.features = nn.Sequential(
            nn.Conv2d(config.input_channels, config.conv1_channels, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2),
            nn.Conv2d(config.conv1_channels, config.conv2_channels, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(kernel_size=2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(config.conv2_channels * 7 * 7, config.hidden_units),
            nn.ReLU(inplace=True),
            nn.Dropout(config.dropout),
            nn.Linear(config.hidden_units, config.num_classes),
        )

    def forward(self, images: Tensor) -> Tensor:
        _assert_mnist_batch(images)
        return self.classifier(self.features(images))

    def probabilities(self, images: Tensor) -> Tensor:
        self.eval()
        with torch.no_grad():
            return torch.softmax(self(images), dim=1)


def create_mnist_classifier(config: ModelConfig = ModelConfig()) -> MNISTClassifier:
    return MNISTClassifier(config)


def train_mnist_classifier(
    train_split: MNISTSplit,
    *,
    validation_split: Optional[MNISTSplit] = None,
    model_config: ModelConfig = ModelConfig(),
    training_config: TrainingConfig = TrainingConfig(),
) -> TrainingResult:
    _validate_training_config(training_config)
    if training_config.seed is not None:
        torch.manual_seed(training_config.seed)

    device = torch.device(training_config.device)
    model = create_mnist_classifier(model_config).to(device)
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=training_config.learning_rate,
        betas=(training_config.beta1, training_config.beta2),
        eps=training_config.eps,
    )
    loss_fn = nn.CrossEntropyLoss()
    train_loader = _split_loader(train_split, training_config.batch_size, training_config.shuffle)
    validation_loader = _split_loader(validation_split, training_config.batch_size, False) if validation_split else None

    history: List[EpochMetrics] = []
    for epoch in range(1, training_config.epochs + 1):
        training_loss, training_accuracy = _train_one_epoch(model, train_loader, loss_fn, optimizer, device)
        validation_loss: Optional[float] = None
        validation_accuracy: Optional[float] = None
        if validation_loader is not None:
            validation_loss, validation_accuracy = evaluate_mnist_classifier(model, validation_loader, device=device)
        history.append(
            EpochMetrics(
                epoch=epoch,
                training_loss=training_loss,
                training_accuracy=training_accuracy,
                validation_loss=validation_loss,
                validation_accuracy=validation_accuracy,
            )
        )

    model_path: Optional[Path] = None
    history_path: Optional[Path] = None
    if training_config.output_dir is not None:
        output_dir = Path(training_config.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        model_path = output_dir / training_config.model_filename
        history_path = output_dir / training_config.history_filename
        save_mnist_classifier(
            model,
            model_path,
            model_config=model_config,
            training_config=training_config,
            history=history,
        )
        save_training_history(history, history_path)

    return TrainingResult(model=model, history=history, model_path=model_path, history_path=history_path)


def evaluate_mnist_classifier(
    model: MNISTClassifier,
    data: Union[MNISTSplit, DataLoader],
    *,
    device: Union[str, torch.device] = "cpu",
) -> Tuple[float, float]:
    loader = _split_loader(data, batch_size=256, shuffle=False) if isinstance(data, MNISTSplit) else data
    device = torch.device(device)
    model.to(device)
    model.eval()
    loss_fn = nn.CrossEntropyLoss()
    total_loss = 0.0
    total_correct = 0
    total_examples = 0

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device=device, dtype=torch.float32)
            labels = _labels_to_indices(labels).to(device=device)
            logits = model(images)
            loss = loss_fn(logits, labels)
            batch_size = int(images.shape[0])
            total_loss += float(loss.item()) * batch_size
            total_correct += int((torch.argmax(logits, dim=1) == labels).sum().item())
            total_examples += batch_size

    if total_examples == 0:
        raise ValueError("Cannot evaluate on an empty dataset.")
    return total_loss / total_examples, total_correct / total_examples


def save_mnist_classifier(
    model: MNISTClassifier,
    path: Union[str, Path],
    *,
    model_config: Optional[ModelConfig] = None,
    training_config: Optional[TrainingConfig] = None,
    history: Optional[List[EpochMetrics]] = None,
) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    config = model_config or model.config
    torch.save(
        {
            "format": "mnist_pipeline.pytorch_classifier",
            "format_version": 1,
            "model_config": asdict(config),
            "training_config": _training_config_dict(training_config),
            "history": [asdict(item) for item in history] if history is not None else None,
            "preprocessing": {
                "input_shape": [1, MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH],
                "channel_order": "channels_first",
                "pixel_range": [0.0, 1.0],
                "label_format": "integer_or_one_hot",
            },
            "state_dict": model.cpu().state_dict(),
        },
        target,
    )


def load_mnist_classifier(path: Union[str, Path], *, map_location: Union[str, torch.device] = "cpu") -> MNISTClassifier:
    artifact = torch.load(Path(path), map_location=map_location)
    if artifact.get("format") != "mnist_pipeline.pytorch_classifier" or artifact.get("format_version") != 1:
        raise ValueError("Unsupported MNIST classifier artifact.")
    model = create_mnist_classifier(ModelConfig(**artifact["model_config"]))
    model.load_state_dict(artifact["state_dict"])
    model.eval()
    return model


def save_training_history(history: List[EpochMetrics], path: Union[str, Path]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps([asdict(item) for item in history], indent=2) + "\n", encoding="utf-8")


def _train_one_epoch(
    model: MNISTClassifier,
    loader: DataLoader,
    loss_fn: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> Tuple[float, float]:
    model.train()
    total_loss = 0.0
    total_correct = 0
    total_examples = 0

    for images, labels in loader:
        images = images.to(device=device, dtype=torch.float32)
        labels = _labels_to_indices(labels).to(device=device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = loss_fn(logits, labels)
        loss.backward()
        optimizer.step()

        batch_size = int(images.shape[0])
        total_loss += float(loss.item()) * batch_size
        total_correct += int((torch.argmax(logits, dim=1) == labels).sum().item())
        total_examples += batch_size

    if total_examples == 0:
        raise ValueError("Cannot train on an empty dataset.")
    return total_loss / total_examples, total_correct / total_examples


def _split_loader(split: MNISTSplit, batch_size: int, shuffle: bool) -> DataLoader:
    _assert_mnist_batch(split.images)
    labels = _labels_to_indices(split.labels)
    return DataLoader(TensorDataset(split.images, labels), batch_size=batch_size, shuffle=shuffle)


def _labels_to_indices(labels: Tensor) -> Tensor:
    if labels.ndim == 2:
        if labels.shape[1] != MNIST_CLASS_COUNT:
            raise ValueError(f"Expected one-hot labels with {MNIST_CLASS_COUNT} classes.")
        return torch.argmax(labels, dim=1).to(dtype=torch.long)
    if labels.ndim != 1:
        raise ValueError("Expected integer labels shaped [N] or one-hot labels shaped [N,10].")
    return labels.to(dtype=torch.long)


def _assert_mnist_batch(images: Tensor) -> None:
    if images.ndim != 4 or images.shape[1:] != (1, MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH):
        raise ValueError(f"Expected images shaped [N,1,{MNIST_IMAGE_HEIGHT},{MNIST_IMAGE_WIDTH}].")


def _validate_model_config(config: ModelConfig) -> None:
    if config.input_channels != 1:
        raise ValueError("MNISTClassifier expects one grayscale input channel.")
    if config.num_classes != MNIST_CLASS_COUNT:
        raise ValueError(f"MNISTClassifier must output {MNIST_CLASS_COUNT} classes.")
    if config.conv1_channels <= 0 or config.conv2_channels <= 0 or config.hidden_units <= 0:
        raise ValueError("Model channel and hidden-unit counts must be positive.")
    if not 0.0 <= config.dropout < 1.0:
        raise ValueError("dropout must be in range [0.0, 1.0).")


def _validate_training_config(config: TrainingConfig) -> None:
    if config.epochs <= 0:
        raise ValueError("epochs must be positive.")
    if config.batch_size <= 0:
        raise ValueError("batch_size must be positive.")
    if config.learning_rate <= 0:
        raise ValueError("learning_rate must be positive.")
    if not 0.0 <= config.beta1 < 1.0 or not 0.0 <= config.beta2 < 1.0:
        raise ValueError("Adam beta values must be in range [0.0, 1.0).")
    if config.eps <= 0:
        raise ValueError("Adam eps must be positive.")


def _training_config_dict(config: Optional[TrainingConfig]) -> Optional[Dict[str, object]]:
    if config is None:
        return None
    data = asdict(config)
    if data["output_dir"] is not None:
        data["output_dir"] = str(data["output_dir"])
    return data
