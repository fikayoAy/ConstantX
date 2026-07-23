from __future__ import annotations

import gzip
import shutil
import struct
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Literal, Mapping, Optional, Tuple, Union

import torch
from torch import Tensor
from torch.utils.data import Dataset

MNIST_IMAGE_MAGIC = 2051
MNIST_LABEL_MAGIC = 2049
MNIST_IMAGE_HEIGHT = 28
MNIST_IMAGE_WIDTH = 28
MNIST_CLASS_COUNT = 10

ChannelOrder = Literal["channels_first", "channels_last"]
LabelFormat = Literal["integer", "one_hot"]

CANONICAL_FILES: Mapping[str, str] = {
    "train_images": "train-images-idx3-ubyte",
    "train_labels": "train-labels-idx1-ubyte",
    "test_images": "t10k-images-idx3-ubyte",
    "test_labels": "t10k-labels-idx1-ubyte",
}

OFFICIAL_MNIST_URLS: Mapping[str, str] = {
    "train-images-idx3-ubyte.gz": "https://yann.lecun.com/exdb/mnist/train-images-idx3-ubyte.gz",
    "train-labels-idx1-ubyte.gz": "https://yann.lecun.com/exdb/mnist/train-labels-idx1-ubyte.gz",
    "t10k-images-idx3-ubyte.gz": "https://yann.lecun.com/exdb/mnist/t10k-images-idx3-ubyte.gz",
    "t10k-labels-idx1-ubyte.gz": "https://yann.lecun.com/exdb/mnist/t10k-labels-idx1-ubyte.gz",
}


@dataclass(frozen=True)
class MNISTSplit:
    images: Tensor
    labels: Tensor
    image_shape: Tuple[int, int, int]
    channel_order: ChannelOrder
    label_format: LabelFormat
    pixel_range: Tuple[float, float] = (0.0, 1.0)

    @property
    def count(self) -> int:
        return int(self.images.shape[0])


class MnistTensorDataset(Dataset):
    def __init__(self, split: MNISTSplit) -> None:
        if split.images.shape[0] != split.labels.shape[0]:
            raise ValueError("Image and label counts must match.")
        self.split = split

    def __len__(self) -> int:
        return self.split.count

    def __getitem__(self, index: int) -> Tuple[Tensor, Tensor]:
        return self.split.images[index], self.split.labels[index]


def parse_idx_images(source: Union[str, Path, bytes, bytearray, memoryview]) -> Tensor:
    data = _read_source(source)
    if len(data) < 16:
        raise ValueError("IDX image file is too short.")

    magic, count, rows, cols = struct.unpack(">IIII", data[:16])
    if magic != MNIST_IMAGE_MAGIC:
        raise ValueError(f"Invalid IDX image magic: {magic}.")
    if count <= 0 or rows <= 0 or cols <= 0:
        raise ValueError("IDX image dimensions must be positive.")

    expected = count * rows * cols
    pixels = data[16:]
    if len(pixels) != expected:
        raise ValueError(f"Invalid IDX image pixel count: expected {expected}, got {len(pixels)}.")

    tensor = torch.frombuffer(bytearray(pixels), dtype=torch.uint8)
    return tensor.reshape(count, rows, cols)


def parse_idx_labels(source: Union[str, Path, bytes, bytearray, memoryview]) -> Tensor:
    data = _read_source(source)
    if len(data) < 8:
        raise ValueError("IDX label file is too short.")

    magic, count = struct.unpack(">II", data[:8])
    if magic != MNIST_LABEL_MAGIC:
        raise ValueError(f"Invalid IDX label magic: {magic}.")

    labels = data[8:]
    if len(labels) != count:
        raise ValueError(f"Invalid IDX label count: expected {count}, got {len(labels)}.")

    tensor = torch.frombuffer(bytearray(labels), dtype=torch.uint8).to(dtype=torch.long)
    _validate_labels(tensor)
    return tensor


def preprocess_images(
    images: Union[Tensor, Iterable[float]],
    *,
    channel_order: ChannelOrder = "channels_first",
    dtype: torch.dtype = torch.float32,
) -> Tensor:
    tensor = torch.as_tensor(images)
    if tensor.ndim == 2:
        tensor = tensor.unsqueeze(0)
    if tensor.ndim == 4 and channel_order == "channels_first" and tensor.shape[1] == 1:
        normalized = _normalize_pixels(tensor, dtype)
        return normalized.contiguous()
    if tensor.ndim == 4 and channel_order == "channels_last" and tensor.shape[-1] == 1:
        normalized = _normalize_pixels(tensor, dtype)
        return normalized.contiguous()
    if tensor.ndim != 3:
        raise ValueError("Expected images shaped [N,H,W], [H,W], [N,1,H,W], or [N,H,W,1].")

    normalized = _normalize_pixels(tensor, dtype)
    if channel_order == "channels_first":
        return normalized.unsqueeze(1).contiguous()
    if channel_order == "channels_last":
        return normalized.unsqueeze(-1).contiguous()
    raise ValueError(f"Unsupported channel_order: {channel_order}.")


def preprocess_image(
    image: Union[Tensor, Iterable[float]],
    *,
    channel_order: ChannelOrder = "channels_first",
    dtype: torch.dtype = torch.float32,
) -> Tensor:
    tensor = torch.as_tensor(image)
    if tensor.numel() != MNIST_IMAGE_HEIGHT * MNIST_IMAGE_WIDTH:
        raise ValueError(f"Expected {MNIST_IMAGE_HEIGHT * MNIST_IMAGE_WIDTH} pixels for one MNIST image.")
    return preprocess_images(
        tensor.reshape(MNIST_IMAGE_HEIGHT, MNIST_IMAGE_WIDTH),
        channel_order=channel_order,
        dtype=dtype,
    )


def preprocess_labels(labels: Union[Tensor, Iterable[int]], *, label_format: LabelFormat = "integer") -> Tensor:
    tensor = torch.as_tensor(labels, dtype=torch.long).reshape(-1)
    _validate_labels(tensor)
    if label_format == "integer":
        return tensor.contiguous()
    if label_format == "one_hot":
        return torch.nn.functional.one_hot(tensor, num_classes=MNIST_CLASS_COUNT).to(dtype=torch.float32)
    raise ValueError(f"Unsupported label_format: {label_format}.")


def load_mnist_split(
    images_path: Union[str, Path],
    labels_path: Union[str, Path],
    *,
    channel_order: ChannelOrder = "channels_first",
    label_format: LabelFormat = "integer",
) -> MNISTSplit:
    raw_images = parse_idx_images(images_path)
    raw_labels = parse_idx_labels(labels_path)
    if raw_images.shape[0] != raw_labels.shape[0]:
        raise ValueError(f"Image count {raw_images.shape[0]} does not match label count {raw_labels.shape[0]}.")

    images = preprocess_images(raw_images, channel_order=channel_order)
    labels = preprocess_labels(raw_labels, label_format=label_format)
    image_shape = _image_shape(images, channel_order)
    return MNISTSplit(
        images=images,
        labels=labels,
        image_shape=image_shape,
        channel_order=channel_order,
        label_format=label_format,
    )


def load_mnist_from_idx_dir(
    directory: Union[str, Path],
    *,
    channel_order: ChannelOrder = "channels_first",
    label_format: LabelFormat = "integer",
) -> Dict[str, MNISTSplit]:
    root = Path(directory)
    return {
        "train": load_mnist_split(
            root / CANONICAL_FILES["train_images"],
            root / CANONICAL_FILES["train_labels"],
            channel_order=channel_order,
            label_format=label_format,
        ),
        "test": load_mnist_split(
            root / CANONICAL_FILES["test_images"],
            root / CANONICAL_FILES["test_labels"],
            channel_order=channel_order,
            label_format=label_format,
        ),
    }


def load_mnist(
    directory: Union[str, Path],
    *,
    download: bool = False,
    channel_order: ChannelOrder = "channels_first",
    label_format: LabelFormat = "integer",
) -> Dict[str, MNISTSplit]:
    root = Path(directory)
    if download:
        download_mnist(root)
    _require_canonical_files(root)
    return load_mnist_from_idx_dir(root, channel_order=channel_order, label_format=label_format)


def download_mnist(directory: Union[str, Path], *, urls: Optional[Mapping[str, str]] = None) -> None:
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    for gz_name, url in (urls or OFFICIAL_MNIST_URLS).items():
        target_name = gz_name.removesuffix(".gz")
        target_path = root / target_name
        if target_path.exists():
            continue

        gz_path = root / gz_name
        urllib.request.urlretrieve(url, gz_path)
        with gzip.open(gz_path, "rb") as compressed, target_path.open("wb") as output:
            shutil.copyfileobj(compressed, output)


def _read_source(source: Union[str, Path, bytes, bytearray, memoryview]) -> bytes:
    if isinstance(source, (str, Path)):
        path = Path(source)
        if path.suffix == ".gz":
            with gzip.open(path, "rb") as handle:
                return handle.read()
        return path.read_bytes()
    return bytes(source)


def _normalize_pixels(tensor: Tensor, dtype: torch.dtype) -> Tensor:
    if not tensor.is_floating_point():
        tensor = tensor.to(dtype=dtype) / 255.0
    else:
        tensor = tensor.to(dtype=dtype)
        if tensor.numel() > 0 and (torch.max(tensor) > 1.0 or torch.min(tensor) < 0.0):
            tensor = tensor / 255.0
    if tensor.numel() > 0 and (torch.min(tensor) < 0.0 or torch.max(tensor) > 1.0):
        raise ValueError("Normalized pixel values must be in range [0.0, 1.0].")
    return tensor


def _validate_labels(labels: Tensor) -> None:
    if labels.numel() == 0:
        raise ValueError("MNIST labels cannot be empty.")
    if torch.any(labels < 0) or torch.any(labels >= MNIST_CLASS_COUNT):
        raise ValueError("MNIST labels must be integers in range 0..9.")


def _image_shape(images: Tensor, channel_order: ChannelOrder) -> Tuple[int, int, int]:
    if channel_order == "channels_first":
        return int(images.shape[1]), int(images.shape[2]), int(images.shape[3])
    return int(images.shape[1]), int(images.shape[2]), int(images.shape[3])


def _require_canonical_files(root: Path) -> None:
    missing = [name for name in CANONICAL_FILES.values() if not (root / name).exists()]
    if missing:
        raise FileNotFoundError(f"Missing MNIST IDX files in {root}: {', '.join(missing)}.")
