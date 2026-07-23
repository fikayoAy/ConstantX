# Extracted Research For B-003 Evaluation, Inference, and Run Instructions

## Attached Papers
- P-001: The MNIST Database of Handwritten Digits. Source: https://yann.lecun.org/exdb/mnist/index.html
- P-002: Gradient Based Learning Applied to Document Recognition. Source: https://leon.bottou.org/papers/lecun-98h
- P-005: On Calibration of Modern Neural Networks. Source: https://proceedings.mlr.press/v70/guo17a.html

## Relevant Claims
- Evaluation should use the canonical MNIST test set rather than a newly sampled split, because MNIST defines a standard 60,000-example training set and 10,000-example test set. Evidence: P-001.
- Test accuracy and test loss are the minimum evaluation outputs required by the source plan and are consistent with reporting performance on a standard handwritten digit recognition benchmark. Evidence: P-001, P-002, source plan.
- A confusion matrix is useful as an optional diagnostic because MNIST is a 10-class digit classification task; it can show which predicted digits are confused with which true digits. Evidence: source plan and P-002 benchmark context.
- Inference must reuse the same preprocessing contract as training: 28x28 grayscale input, normalized pixel values, and the same channel order and label mapping established by B-001/B-002. Evidence: P-001, B-001 extraction, B-002 extraction.
- A returned confidence score should be treated as the model's prediction score, not automatically as a calibrated probability. Modern neural networks can be miscalibrated, so documentation should avoid promising that confidence equals true correctness likelihood. Evidence: P-005.
- If calibrated probabilities are required later, temperature scaling is a possible post-processing method, but this is not required for the baseline B-003 inference path. Evidence: P-005.

## Methods To Use
- Load the trained model artifact produced by B-002.
- Load the canonical MNIST test dataset from B-001 or through the same dataset loader/preprocessing module used by B-001.
- Evaluate the model on the 10,000-example MNIST test split and report test loss plus test accuracy.
- Optionally compute a 10x10 confusion matrix using true labels and predicted class IDs.
- Implement a single-image prediction function or script that loads an image, converts it to grayscale, resizes or pads it to the B-001-compatible 28x28 format, normalizes it, adds the required batch/channel dimensions, runs the model, and returns the top class and score.
- Document the commands or function calls for training, evaluation, and prediction, but do not duplicate training implementation inside B-003.

## Algorithms / Equations
- Predicted class: predicted_digit = argmax(model_output).
- Confidence score: confidence = max(model_output_after_softmax) when B-002 exposes probabilities, or max(softmax(logits)) when B-002 exposes logits.
- Accuracy: correct_predictions / total_test_examples.
- Confusion matrix entry C[i, j]: count of examples with true digit i and predicted digit j.
- Loss computation must match the B-002 output/loss contract: logits-aware cross-entropy for logits, probability-compatible cross-entropy for softmax probabilities.

## Parameters / Thresholds
- Test examples: 10,000. Evidence: P-001.
- Classes: 10 digits, 0 through 9. Evidence: P-001 and source plan.
- Expected single-image inference input after preprocessing: one 28x28 grayscale tensor with the same channel order used during training.
- Output contract for inference: predicted digit plus confidence score.
- Optional confusion matrix shape: 10x10.

## Constraints
- B-003 depends on completed B-001 and B-002 contracts. It must not introduce a different preprocessing path, input shape, label mapping, or model-output interpretation.
- Do not evaluate on training data as the final reported performance. Use the canonical MNIST test split for test metrics.
- Do not retrain the model during evaluation or inference.
- Do not present softmax confidence as calibrated probability unless calibration is explicitly implemented and validated.
- External image handling must be deterministic and documented, because user-provided images may have different backgrounds, sizes, aspect ratios, or polarity from MNIST.

## Risks
- Inference can fail silently if external images are not converted to the same polarity, scale, channel order, and normalization as MNIST training data.
- If B-002 saves only weights without architecture or preprocessing metadata, B-003 may not be able to load the model reliably.
- Confidence scores can be overconfident even when predictions are wrong. B-003 documentation should call the score a model confidence or softmax score unless calibration is added.
- Confusion matrix labels can be misleading if the class-index-to-digit mapping is not fixed as 0 through 9.
- Using a validation split or training split in place of the MNIST test split would make final metrics nonstandard.

## Conflicts Between Papers
- No direct conflict for B-003. P-001 defines the dataset/test split, P-002 supports benchmark-style digit classifier evaluation, and P-005 adds caution about interpreting confidence values.
- P-005 does not require implementing calibration in the baseline. It only constrains how confidence scores should be described and leaves calibration as an optional extension.

## Implementation Guidance
- B-003 should expose at least two user-facing actions: evaluate a saved model and predict one image.
- Evaluation should return or save a structured metrics object containing test_loss, test_accuracy, and optionally confusion_matrix.
- The prediction function should return a structured result such as predicted_digit, confidence, and raw_scores or probabilities when useful.
- Documentation should show the correct order: run B-001/B-002 training first, then evaluate, then predict.
- If using a CLI or script in the final application, commands should be thin wrappers around reusable functions, not separate duplicated logic.
- Record the exact model path expected from B-002 and the exact preprocessing function expected from B-001 in spec.md.

## Evidence Map
- P-001 -> canonical MNIST test set, class count, image/label format used by evaluation.
- P-002 -> standard handwritten digit recognition benchmark context and classifier reporting motivation.
- P-005 -> confidence calibration risk and guidance to avoid overstating softmax confidence as true correctness probability.

## Approval
Approved at: 2026-07-22T18:40:21.597Z
Approved by: fikayo
Notes: None
