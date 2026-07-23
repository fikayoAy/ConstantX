from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Union

import torch
from PIL import Image, ImageOps
from torch import Tensor
from torch.utils.data import DataLoader, TensorDataset

from .data import (
    MNIST_CLASS_COUNT,
    MNIST_IMAGE_HEIGHT,
    MNIST_IMAGE_WIDTH,
    MNISTSplit,
    load_mnist,
    preprocess_image,
)
from .model import MNISTClassifier, load_mnist_classifier


@dataclass(frozen=True)
class EvaluationMetrics:
    test_loss: float
    test_accuracy: float
    total_examples: int
    confusion_matrix: Optional[List[List[int]]] = None


@dataclass(frozen=True)
class PredictionResult:
    predicted_digit: int
    confidence: float
    probabilities: List[float]
    confidence_note: str


def evaluate_model(
    model: MNISTClassifier,
    test_split: MNISTSplit,
    *,
    batch_size: int = 256,
    include_confusion_matrix: bool = True,
    device: Union[str, torch.device] = "cpu",
) -> EvaluationMetrics:
    if batch_size <= 0:
        raise ValueError("batch_size must be positive.")
    _assert_test_split(test_split)

    device = torch.device(device)
    model.to(device)
    model.eval()
    loader = DataLoader(TensorDataset(test_split.images, _labels_to_indices(test_split.labels)), batch_size=batch_size)
    loss_fn = torch.nn.CrossEntropyLoss()
    total_loss = 0.0
    total_correct = 0
    total_examples = 0
    matrix = torch.zeros((MNIST_CLASS_COUNT, MNIST_CLASS_COUNT), dtype=torch.long) if include_confusion_matrix else None

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(device=device, dtype=torch.float32)
            labels = labels.to(device=device)
            logits = model(images)
            loss = loss_fn(logits, labels)
            predictions = torch.argmax(logits, dim=1)
            batch_size_actual = int(images.shape[0])
            total_loss += float(loss.item()) * batch_size_actual
            total_correct += int((predictions == labels).sum().item())
            total_examples += batch_size_actual
            if matrix is not None:
                for truth, prediction in zip(labels.cpu().tolist(), predictions.cpu().tolist()):
                    matrix[int(truth), int(prediction)] += 1

    if total_examples == 0:
        raise ValueError("Cannot evaluate an empty test split.")

    return EvaluationMetrics(
        test_loss=total_loss / total_examples,
        test_accuracy=total_correct / total_examples,
        total_examples=total_examples,
        confusion_matrix=matrix.tolist() if matrix is not None else None,
    )


def evaluate_saved_model(
    model_path: Union[str, Path],
    *,
    data_dir: Optional[Union[str, Path]] = None,
    test_split: Optional[MNISTSplit] = None,
    download: bool = False,
    batch_size: int = 256,
    include_confusion_matrix: bool = True,
    device: Union[str, torch.device] = "cpu",
    metrics_path: Optional[Union[str, Path]] = None,
) -> EvaluationMetrics:
    if test_split is None:
        if data_dir is None:
            raise ValueError("Provide either test_split or data_dir.")
        test_split = load_mnist(data_dir, download=download, channel_order="channels_first", label_format="integer")["test"]

    model = load_mnist_classifier(model_path, map_location=device)
    metrics = evaluate_model(
        model,
        test_split,
        batch_size=batch_size,
        include_confusion_matrix=include_confusion_matrix,
        device=device,
    )
    if metrics_path is not None:
        save_evaluation_metrics(metrics, metrics_path)
    return metrics


def predict_digit(
    model: Union[MNISTClassifier, str, Path],
    image: Union[str, Path, Image.Image, Tensor, Sequence[float]],
    *,
    invert: bool = False,
    device: Union[str, torch.device] = "cpu",
) -> PredictionResult:
    loaded_model = load_mnist_classifier(model, map_location=device) if isinstance(model, (str, Path)) else model
    tensor = image_to_mnist_tensor(image, invert=invert).to(device=torch.device(device), dtype=torch.float32)
    loaded_model.to(device)
    loaded_model.eval()

    with torch.no_grad():
        logits = loaded_model(tensor)
        probabilities_tensor = torch.softmax(logits, dim=1)[0].cpu()

    confidence, predicted_digit = torch.max(probabilities_tensor, dim=0)
    return PredictionResult(
        predicted_digit=int(predicted_digit.item()),
        confidence=float(confidence.item()),
        probabilities=[float(value) for value in probabilities_tensor.tolist()],
        confidence_note="Softmax confidence is a model score, not a calibrated probability unless calibration is added.",
    )


def image_to_mnist_tensor(
    image: Union[str, Path, Image.Image, Tensor, Sequence[float]],
    *,
    invert: bool = False,
) -> Tensor:
    if isinstance(image, Tensor):
        return preprocess_image(image)
    if isinstance(image, (str, Path, Image.Image)):
        pil_image = Image.open(image) if isinstance(image, (str, Path)) else image
        grayscale = pil_image.convert("L")
        if invert:
            grayscale = ImageOps.invert(grayscale)
        resized = grayscale.resize((MNIST_IMAGE_WIDTH, MNIST_IMAGE_HEIGHT), Image.Resampling.LANCZOS)
        pixels = torch.tensor(list(resized.getdata()), dtype=torch.uint8).reshape(MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH)
        return preprocess_image(pixels)
    return preprocess_image(image)


def save_evaluation_metrics(metrics: EvaluationMetrics, path: Union[str, Path]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(asdict(metrics), indent=2) + "\n", encoding="utf-8")


def save_prediction_result(result: PredictionResult, path: Union[str, Path]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(asdict(result), indent=2) + "\n", encoding="utf-8")


def _assert_test_split(split: MNISTSplit) -> None:
    if tuple(split.images.shape[1:]) != (1, MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH):
        raise ValueError(f"Expected test images shaped [N,1,{MNIST_IMAGE_HEIGHT},{MNIST_IMAGE_WIDTH}].")
    if split.count <= 0:
        raise ValueError("Test split cannot be empty.")


def _labels_to_indices(labels: Tensor) -> Tensor:
    if labels.ndim == 2:
        if labels.shape[1] != MNIST_CLASS_COUNT:
            raise ValueError(f"Expected one-hot labels with {MNIST_CLASS_COUNT} classes.")
        return torch.argmax(labels, dim=1).to(dtype=torch.long)
    if labels.ndim != 1:
        raise ValueError("Expected integer labels shaped [N] or one-hot labels shaped [N,10].")
    return labels.to(dtype=torch.long)
