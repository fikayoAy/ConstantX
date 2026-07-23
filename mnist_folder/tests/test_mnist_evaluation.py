import json
import tempfile
import unittest
from pathlib import Path

import torch
from PIL import Image

from mnist_pipeline import (
    EvaluationMetrics,
    MNISTSplit,
    ModelConfig,
    TrainingConfig,
    evaluate_model,
    evaluate_saved_model,
    image_to_mnist_tensor,
    predict_digit,
    preprocess_images,
    preprocess_labels,
    save_evaluation_metrics,
    save_prediction_result,
    train_mnist_classifier,
)


class MnistEvaluationTests(unittest.TestCase):
    def test_evaluate_model_reports_loss_accuracy_and_confusion_matrix(self) -> None:
        split = _synthetic_split()
        result = train_mnist_classifier(
            split,
            validation_split=split,
            model_config=ModelConfig(dropout=0.0),
            training_config=TrainingConfig(epochs=1, batch_size=4, seed=3, shuffle=False),
        )

        metrics = evaluate_model(result.model, split, batch_size=4, include_confusion_matrix=True)

        self.assertIsInstance(metrics, EvaluationMetrics)
        self.assertTrue(torch.isfinite(torch.tensor(metrics.test_loss)))
        self.assertGreaterEqual(metrics.test_accuracy, 0.0)
        self.assertLessEqual(metrics.test_accuracy, 1.0)
        self.assertEqual(metrics.total_examples, split.count)
        self.assertIsNotNone(metrics.confusion_matrix)
        self.assertEqual(len(metrics.confusion_matrix), 10)
        self.assertEqual(len(metrics.confusion_matrix[0]), 10)
        self.assertEqual(sum(sum(row) for row in metrics.confusion_matrix), split.count)

    def test_evaluate_saved_model_loads_artifact_and_writes_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            split = _synthetic_split()
            training = train_mnist_classifier(
                split,
                model_config=ModelConfig(dropout=0.0),
                training_config=TrainingConfig(epochs=1, batch_size=4, seed=5, shuffle=False, output_dir=output_dir),
            )
            metrics_path = output_dir / "metrics.json"

            metrics = evaluate_saved_model(training.model_path, test_split=split, metrics_path=metrics_path)

            self.assertTrue(metrics_path.exists())
            saved = json.loads(metrics_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["total_examples"], split.count)
            self.assertAlmostEqual(saved["test_loss"], metrics.test_loss)

    def test_predict_digit_returns_digit_confidence_and_probability_vector(self) -> None:
        split = _synthetic_split()
        training = train_mnist_classifier(
            split,
            model_config=ModelConfig(dropout=0.0),
            training_config=TrainingConfig(epochs=1, batch_size=4, seed=7, shuffle=False),
        )
        image = (split.images[0, 0] * 255).to(dtype=torch.uint8)

        prediction = predict_digit(training.model, image)

        self.assertGreaterEqual(prediction.predicted_digit, 0)
        self.assertLessEqual(prediction.predicted_digit, 9)
        self.assertGreaterEqual(prediction.confidence, 0.0)
        self.assertLessEqual(prediction.confidence, 1.0)
        self.assertEqual(len(prediction.probabilities), 10)
        self.assertIn("not a calibrated probability", prediction.confidence_note)

    def test_image_path_preprocessing_and_prediction_json_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp)
            image_path = output_dir / "digit.png"
            Image.new("L", (32, 32), color=0).save(image_path)
            tensor = image_to_mnist_tensor(image_path)

            split = _synthetic_split()
            training = train_mnist_classifier(
                split,
                model_config=ModelConfig(dropout=0.0),
                training_config=TrainingConfig(epochs=1, batch_size=4, seed=13, shuffle=False),
            )
            prediction = predict_digit(training.model, image_path)
            prediction_path = output_dir / "prediction.json"
            save_prediction_result(prediction, prediction_path)

            self.assertEqual(tuple(tensor.shape), (1, 1, 28, 28))
            self.assertTrue(prediction_path.exists())
            saved = json.loads(prediction_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["predicted_digit"], prediction.predicted_digit)

    def test_rejects_invalid_evaluation_inputs(self) -> None:
        bad_split = MNISTSplit(
            images=torch.zeros(1, 28, 28, 1),
            labels=torch.tensor([0]),
            image_shape=(28, 28, 1),
            channel_order="channels_last",
            label_format="integer",
        )

        with self.assertRaisesRegex(ValueError, "Expected test images shaped"):
            evaluate_model(train_mnist_classifier(_synthetic_split()).model, bad_split)
        with self.assertRaisesRegex(ValueError, "batch_size"):
            evaluate_model(train_mnist_classifier(_synthetic_split()).model, _synthetic_split(), batch_size=0)

    def test_metrics_json_writer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            metrics_path = Path(tmp) / "metrics.json"
            metrics = EvaluationMetrics(test_loss=0.5, test_accuracy=0.75, total_examples=4, confusion_matrix=None)

            save_evaluation_metrics(metrics, metrics_path)

            saved = json.loads(metrics_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["test_accuracy"], 0.75)


def _synthetic_split() -> MNISTSplit:
    count = 8
    raw = torch.zeros(count, 28, 28, dtype=torch.uint8)
    labels = torch.tensor([0, 1, 2, 3, 4, 5, 6, 7], dtype=torch.long)
    for index, label in enumerate(labels.tolist()):
        row = 2 + label * 2
        raw[index, row : row + 3, 4:24] = 255
        raw[index, 4:24, row : row + 3] = 128

    return MNISTSplit(
        images=preprocess_images(raw),
        labels=preprocess_labels(labels),
        image_shape=(1, 28, 28),
        channel_order="channels_first",
        label_format="integer",
    )


if __name__ == "__main__":
    unittest.main()
