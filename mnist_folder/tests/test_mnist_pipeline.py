import struct
import tempfile
import unittest
from pathlib import Path

import torch

from mnist_pipeline import (
    MNIST_CLASS_COUNT,
    MnistTensorDataset,
    load_mnist_from_idx_dir,
    load_mnist_split,
    parse_idx_images,
    parse_idx_labels,
    preprocess_image,
    preprocess_images,
    preprocess_labels,
)


class MnistPipelineTests(unittest.TestCase):
    def test_parse_idx_and_load_split_as_channels_first_tensors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images_path = root / "train-images-idx3-ubyte"
            labels_path = root / "train-labels-idx1-ubyte"
            images_path.write_bytes(_idx_images(2, 2, 2, [0, 127, 255, 64, 10, 20, 30, 40]))
            labels_path.write_bytes(_idx_labels([3, 9]))

            split = load_mnist_split(images_path, labels_path)

            self.assertEqual(tuple(split.images.shape), (2, 1, 2, 2))
            self.assertEqual(tuple(split.labels.shape), (2,))
            self.assertEqual(split.channel_order, "channels_first")
            self.assertEqual(split.label_format, "integer")
            self.assertEqual(split.count, 2)
            self.assertAlmostEqual(float(split.images[0, 0, 0, 1]), 127 / 255)
            self.assertEqual(split.images.dtype, torch.float32)
            self.assertEqual(split.labels.dtype, torch.long)

    def test_loads_canonical_train_test_files_and_one_hot_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "train-images-idx3-ubyte").write_bytes(_idx_images(1, 2, 2, [0, 1, 2, 3]))
            (root / "train-labels-idx1-ubyte").write_bytes(_idx_labels([1]))
            (root / "t10k-images-idx3-ubyte").write_bytes(_idx_images(1, 2, 2, [4, 5, 6, 7]))
            (root / "t10k-labels-idx1-ubyte").write_bytes(_idx_labels([2]))

            dataset = load_mnist_from_idx_dir(root, channel_order="channels_last", label_format="one_hot")

            self.assertEqual(tuple(dataset["train"].images.shape), (1, 2, 2, 1))
            self.assertEqual(tuple(dataset["test"].images.shape), (1, 2, 2, 1))
            self.assertEqual(tuple(dataset["train"].labels.shape), (1, MNIST_CLASS_COUNT))
            self.assertEqual(float(dataset["train"].labels[0, 1]), 1.0)
            self.assertEqual(float(dataset["test"].labels[0, 2]), 1.0)

    def test_preprocess_image_uses_training_preprocessing_contract(self) -> None:
        image = preprocess_image(torch.full((28, 28), 255, dtype=torch.uint8))

        self.assertEqual(tuple(image.shape), (1, 1, 28, 28))
        self.assertEqual(image.dtype, torch.float32)
        self.assertEqual(float(image.min()), 1.0)
        self.assertEqual(float(image.max()), 1.0)

    def test_dataset_wrapper_returns_image_label_pairs(self) -> None:
        split = load_mnist_split(
            _idx_images(2, 2, 2, [0, 0, 0, 0, 255, 255, 255, 255]),
            _idx_labels([0, 1]),
        )
        dataset = MnistTensorDataset(split)

        image, label = dataset[1]

        self.assertEqual(len(dataset), 2)
        self.assertEqual(tuple(image.shape), (1, 2, 2))
        self.assertEqual(int(label), 1)

    def test_validates_idx_headers_labels_and_shapes(self) -> None:
        bad_images = bytearray(_idx_images(1, 1, 1, [0]))
        struct.pack_into(">I", bad_images, 0, 9999)
        bad_labels = bytearray(_idx_labels([1]))
        struct.pack_into(">I", bad_labels, 0, 9999)

        with self.assertRaisesRegex(ValueError, "Invalid IDX image magic"):
            parse_idx_images(bad_images)
        with self.assertRaisesRegex(ValueError, "Invalid IDX label magic"):
            parse_idx_labels(bad_labels)
        with self.assertRaisesRegex(ValueError, "range 0..9"):
            preprocess_labels([10])
        with self.assertRaisesRegex(ValueError, "Expected images shaped"):
            preprocess_images(torch.zeros(1, 2, 2, 2))
        with self.assertRaisesRegex(ValueError, "Expected 784 pixels"):
            preprocess_image([0, 1, 2])


def _idx_images(count: int, rows: int, cols: int, pixels: list[int]) -> bytes:
    return struct.pack(">IIII", 2051, count, rows, cols) + bytes(pixels)


def _idx_labels(labels: list[int]) -> bytes:
    return struct.pack(">II", 2049, len(labels)) + bytes(labels)


if __name__ == "__main__":
    unittest.main()
