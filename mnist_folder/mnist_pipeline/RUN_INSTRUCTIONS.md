# MNIST Pipeline Run Instructions

Run the workflow in this order: load data, train and save a model, evaluate the saved model, then predict a single image.

## Train

```python
from mnist_pipeline import TrainingConfig, load_mnist, train_mnist_classifier

dataset = load_mnist("data/mnist", download=True)
result = train_mnist_classifier(
    dataset["train"],
    validation_split=dataset["test"],
    training_config=TrainingConfig(epochs=5, batch_size=64, output_dir="artifacts"),
)
print(result.model_path)
```

## Evaluate

```python
from mnist_pipeline import evaluate_saved_model

metrics = evaluate_saved_model(
    "artifacts/mnist_cnn.pt",
    data_dir="data/mnist",
    metrics_path="artifacts/test_metrics.json",
)
print(metrics.test_loss, metrics.test_accuracy)
```

`metrics.confusion_matrix` is a 10x10 matrix where rows are true digits and columns are predicted digits.

## Predict One Image

```python
from mnist_pipeline import predict_digit, save_prediction_result

prediction = predict_digit("artifacts/mnist_cnn.pt", "my_digit.png", invert=False)
save_prediction_result(prediction, "artifacts/prediction.json")
print(prediction.predicted_digit, prediction.confidence)
```

The confidence is the model softmax score. It is not a calibrated probability unless a separate calibration step is implemented and validated.
