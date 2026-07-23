# Implementation Spec For B-003 Evaluation, Inference, and Run Instructions

## Implementation Target
Language: Python
Framework: PyTorch

## Source Block
---
{
  "id": "B-003",
  "title": "Evaluation, Inference, and Run Instructions",
  "slug": "evaluation-inference-and-run-instructions",
  "dir": "blocks/B-003-evaluation-inference-and-run-instructions",
  "status": "research_approved",
  "depends_on": [
    "B-001",
    "B-002"
  ],
  "related_blocks": [
    "B-001",
    "B-002"
  ],
  "source_plan_refs": [
    "Evaluation",
    "Inference",
    "Outputs"
  ],
  "paper_ids": [
    "P-001",
    "P-002",
    "P-005"
  ],
  "created_at": "2026-07-21T17:57:47.898Z",
  "updated_at": "2026-07-22T18:40:21.597Z",
  "source_excerpt": "Evaluation: report test accuracy, loss, and optionally a confusion matrix.\nInference: accept a single handwritten digit image, preprocess it like training data, run the model, return predicted digit and confidence.\nOutputs: trained model, metrics, inference function, and clear run instructions."
}
---



# Evaluation, Inference, and Run Instructions

## Purpose
Evaluate the trained model and expose a reusable prediction path for new digit images.

## Source From Original Plan
Evaluation: report test accuracy, loss, and optionally a confusion matrix.
Inference: accept a single handwritten digit image, preprocess it like training data, run the model, return predicted digit and confidence.
Outputs: trained model, metrics, inference function, and clear run instructions.

## Responsibilities
- Evaluate the trained model on the MNIST test set.
- Report test accuracy and loss.
- Optionally generate a confusion matrix.
- Provide a single-image inference function or script.
- Return predicted digit and confidence score.
- Document commands or steps for training, evaluation, and prediction.

## Inputs
- Trained model from B-002.
- Test dataset from B-001.
- User-provided handwritten digit image.

## Outputs
- Test accuracy and loss.
- Optional confusion matrix.
- Predicted digit for a single image.
- Confidence score.
- Clear run instructions.

## Dependencies
- [B-001](../../blocks/B-001-data-pipeline-and-preprocessing/block.md)
- [B-002](../../blocks/B-002-cnn-model-training/block.md)

## Related Blocks
- [B-001](../../blocks/B-001-data-pipeline-and-preprocessing/block.md)
- [B-002](../../blocks/B-002-cnn-model-training/block.md)

## Research Questions
- What metrics are standard for MNIST evaluation?
- When is a confusion matrix useful for digit classification?
- How should external digit images be transformed to match MNIST preprocessing?

## Implementation Criteria
- Evaluation reports test accuracy and loss on the MNIST test set.
- Inference uses the same preprocessing rules as training.
- Prediction returns both digit class and confidence score.
- Documentation clearly explains how to run training, evaluation, and prediction.

## Open Questions
TBD

## Curated Papers
# Papers For B-003 Evaluation, Inference, and Run Instructions

## P-001 The MNIST Database of Handwritten Digits

Citation: LeCun, Y., Cortes, C., and Burges, C. J. C. The MNIST Database of Handwritten Digits.
Discovery source: codex_online
Source URL: https://yann.lecun.org/exdb/mnist/index.html
Stored path: Reference only
Source path: N/A
Authors: Yann LeCun, Corinna Cortes, Christopher J. C. Burges
Year: 1998
Venue: Official MNIST dataset page
DOI: N/A
arXiv: N/A
Relevance score: 1

### Abstract
Official dataset description for MNIST handwritten digits, including file names, dataset sizes, image normalization/centering history, and binary IDX storage format.

### Relevance Notes
Primary dataset source for MNIST. It defines the standard MNIST training/test files, 60,000 training examples, 10,000 test examples, 28x28 centered grayscale images, IDX file format, and the origin of the split from NIST SD-1 and SD-3. Useful for B-003 because evaluation should use the canonical 10,000-example test set.

### Relevant Sections
- Test-set file and 10,000-example test split
- 28x28 image and label format
- Standard benchmark dataset definition

## P-002 Gradient Based Learning Applied to Document Recognition

Citation: LeCun, Y., Bottou, L., Bengio, Y., and Haffner, P. Gradient Based Learning Applied to Document Recognition. Proceedings of the IEEE, 86(11):2278-2324, 1998.
Discovery source: codex_online
Source URL: https://leon.bottou.org/papers/lecun-98h
Stored path: Reference only
Source path: N/A
Authors: Yann LeCun, Leon Bottou, Yoshua Bengio, Patrick Haffner
Year: 1998
Venue: Proceedings of the IEEE
DOI: N/A
arXiv: N/A
Relevance score: 0.95

### Abstract
The paper reviews gradient-based learning methods for handwritten character recognition and compares methods on a standard handwritten digit recognition task.

### Relevance Notes
Primary paper supporting the MNIST benchmark context, LeNet-style convolutional architecture, gradient-based training, and handwritten digit recognition evaluation. Useful for B-003 because it grounds test-set reporting for the trained digit classifier.

### Relevant Sections
- Standard handwritten digit recognition task
- Evaluation/reporting context for digit classifiers
- End-to-end trained document-recognition system context

## P-005 On Calibration of Modern Neural Networks

Citation: Guo, C., Pleiss, G., Sun, Y., and Weinberger, K. Q. On Calibration of Modern Neural Networks. Proceedings of the 34th International Conference on Machine Learning, PMLR 70:1321-1330, 2017.
Discovery source: codex_online
Source URL: https://proceedings.mlr.press/v70/guo17a.html
Stored path: Reference only
Source path: N/A
Authors: Chuan Guo, Geoff Pleiss, Yu Sun, Kilian Q. Weinberger
Year: 2017
Venue: International Conference on Machine Learning
DOI: N/A
arXiv: N/A
Relevance score: 0.78

### Abstract
Studies confidence calibration in modern neural networks, showing that predicted probability estimates may not match true correctness likelihoods and that temperature scaling is a simple post-processing calibration method.

### Relevance Notes
Primary calibration paper for B-003. It supports treating a model's confidence score as a prediction score that may not be a calibrated probability, and it motivates reporting confidence carefully during inference.

### Relevant Sections
- Confidence calibration definition
- Modern neural network calibration risk
- Temperature scaling as a post-processing calibration method
- Image and document classification relevance

## Approved Research
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

## Implementation Objective
TBD

## Interfaces And Data Contracts
TBD

## Algorithms And Methods To Implement
TBD

## Files And Modules To Change
TBD

## Verification Plan
TBD

## Risks And Constraints
TBD

## Implementation Steps
TBD

## Spec Approval
Approved at: 2026-07-22T18:49:37.798Z
Approved by: fikayo
Notes: None
