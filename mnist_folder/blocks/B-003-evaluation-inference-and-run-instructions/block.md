---
{
  "id": "B-003",
  "title": "Evaluation, Inference, and Run Instructions",
  "slug": "evaluation-inference-and-run-instructions",
  "dir": "blocks/B-003-evaluation-inference-and-run-instructions",
  "status": "spec_approved",
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
  "updated_at": "2026-07-22T18:49:37.798Z",
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
