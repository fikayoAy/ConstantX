import json
import tempfile
import unittest
from pathlib import Path

import torch

from mnist_pipeline import (
    MNISTClassifier,
    MNISTSplit,
    ModelConfig,
    TrainingConfig,
    create_mnist_classifier,
    evaluate_mnist_classifier,
    load_mnist_classifier,
    preprocess_images,
    preprocess_labels,
    train_mnist_classifier,
)


class MnistModelTests(unittest.TestCase):
    def test_classifier_outputs_logits_and_probabilities_for_mnist_batches(self) -> None:
        model = create_mnist_classifier(ModelConfig(dropout=0.0))
        images = _synthetic_split().images

        logits = model(images)
        probabilities = model.probabilities(images)

        self.assertEqual(tuple(logits.shape), (8, 10))
        self.assertEqual(tuple(probabilities.shape), (8, 10))
        torch.testing.assert_close(probabilities.sum(dim=1), torch.ones(8), atol=1e-6, rtol=1e-6)

    def test_train_tracks_metrics_and_saves_reusable_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            train_split = _synthetic_split()
            validation_split = _synthetic_split()

            result = train_mnist_classifier(
                train_split,
                validation_split=validation_split,
                model_config=ModelConfig(dropout=0.0),
                training_config=TrainingConfig(
                    epochs=2,
                    batch_size=4,
                    learning_rate=0.001,
                    seed=7,
                    shuffle=False,
                    output_dir=output_dir,
                ),
            )

            self.assertEqual(len(result.history), 2)
            self.assertTrue(result.model_path and result.model_path.exists())
            self.assertTrue(result.history_path and result.history_path.exists())
            for metrics in result.history:
                self.assertTrue(torch.isfinite(torch.tensor(metrics.training_loss)))
                self.assertGreaterEqual(metrics.training_accuracy, 0.0)
                self.assertLessEqual(metrics.training_accuracy, 1.0)
                self.assertIsNotNone(metrics.validation_loss)
                self.assertIsNotNone(metrics.validation_accuracy)

            saved_history = json.loads(result.history_path.read_text(encoding="utf-8"))
            self.assertEqual(len(saved_history), 2)
            loaded = load_mnist_classifier(result.model_path)
            self.assertIsInstance(loaded, MNISTClassifier)
            self.assertEqual(tuple(loaded(_synthetic_split().images).shape), (8, 10))

    def test_training_accepts_one_hot_labels_from_b001(self) -> None:
        split = _synthetic_split(label_format="one_hot")

        result = train_mnist_classifier(
            split,
            model_config=ModelConfig(dropout=0.0),
            training_config=TrainingConfig(epochs=1, batch_size=4, seed=11, shuffle=False),
        )

        loss, accuracy = evaluate_mnist_classifier(result.model, split)
        self.assertEqual(len(result.history), 1)
        self.assertTrue(torch.isfinite(torch.tensor(loss)))
        self.assertGreaterEqual(accuracy, 0.0)
        self.assertLessEqual(accuracy, 1.0)

    def test_rejects_incompatible_shapes_and_invalid_configuration(self) -> None:
        model = create_mnist_classifier()

        with self.assertRaisesRegex(ValueError, "Expected images shaped"):
            model(torch.zeros(2, 28, 28, 1))
        with self.assertRaisesRegex(ValueError, "dropout"):
            create_mnist_classifier(ModelConfig(dropout=1.0))
        with self.assertRaisesRegex(ValueError, "epochs"):
            train_mnist_classifier(_synthetic_split(), training_config=TrainingConfig(epochs=0))


def _synthetic_split(label_format: str = "integer") -> MNISTSplit:
    count = 8
    raw = torch.zeros(count, 28, 28, dtype=torch.uint8)
    labels = torch.tensor([0, 1, 2, 3, 4, 5, 6, 7], dtype=torch.long)
    for index, label in enumerate(labels.tolist()):
        row = 2 + label * 2
        raw[index, row : row + 3, 4:24] = 255
        raw[index, 4:24, row : row + 3] = 128

    return MNISTSplit(
        images=preprocess_images(raw),
        labels=preprocess_labels(labels, label_format=label_format),  # type: ignore[arg-type]
        image_shape=(1, 28, 28),
        channel_order="channels_first",
        label_format=label_format,  # type: ignore[arg-type]
    )


if __name__ == "__main__":
    unittest.main()
