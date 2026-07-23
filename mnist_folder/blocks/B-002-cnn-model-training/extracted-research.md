# Extracted Research For B-002 CNN Model Training

## Attached Papers
- P-002: Gradient Based Learning Applied to Document Recognition. Source: https://leon.bottou.org/papers/lecun-98h
- P-003: Adam: A Method for Stochastic Optimization. Source: https://arxiv.org/abs/1412.6980
- P-004: Dropout: A Simple Way to Prevent Neural Networks from Overfitting. Source: https://www.jmlr.org/papers/v15/srivastava14a.html

## Relevant Claims
- A small convolutional neural network is appropriate for MNIST-style handwritten digit recognition because convolutional networks trained with gradient-based learning are a standard approach for document and digit recognition with minimal feature engineering. Evidence: P-002.
- The model should preserve spatial image structure from B-001 and accept the agreed MNIST tensor contract: 28x28 grayscale images with an explicit channel dimension in the selected framework's channel order. Evidence: P-002 plus B-001 extraction.
- The classifier output must represent 10 digit classes. For implementation, output either raw logits or softmax probabilities, but the chosen output must be compatible with the selected cross-entropy loss. Evidence: source plan and B-002 block requirements.
- Adam is a suitable default optimizer for this block because it is a computationally efficient first-order stochastic optimizer using adaptive moment estimates, with low memory requirements and hyperparameters that usually need little tuning. Evidence: P-003.
- Dropout is useful as an optional regularization layer because it reduces overfitting by randomly dropping units during training and using a single unthinned network at test time. Evidence: P-004.
- For a simple MNIST baseline, dropout should be used conservatively, typically after dense layers or between larger trainable layers, not as a substitute for correct dataset preprocessing or a valid CNN architecture. Evidence: P-004 and B-001 constraints.

## Methods To Use
- Define a compact CNN with a sequence of convolution, nonlinear activation, pooling, flattening, dense classification layers, optional dropout, and final 10-class output.
- Use B-001's preprocessed tensors directly. Do not duplicate data loading or introduce a separate preprocessing pathway in B-002.
- Use cross-entropy loss for multiclass digit classification.
- Use Adam as the default optimizer unless the implementation environment strongly favors another optimizer.
- Track at least training loss, training accuracy, validation loss, and validation accuracy per epoch.
- Save the trained model artifact in the framework's normal reusable format so B-003 can load it for evaluation and inference.

## Algorithms / Equations
- CNN feature extraction pattern: convolution over the 28x28 grayscale input, nonlinear activation, optional pooling, then dense classification.
- Adam update concept: maintain exponential moving averages of gradients and squared gradients, apply bias correction, and update parameters with an adaptive per-parameter step. Evidence: P-003.
- Cross-entropy contract:
  - Use sparse categorical cross-entropy when labels from B-001 are integer class IDs.
  - Use categorical cross-entropy when labels from B-001 are one-hot vectors.
- Output/loss contract:
  - If the model returns logits, configure the loss with the framework's logits-aware option.
  - If the model returns probabilities, include softmax in the model output and configure loss accordingly.

## Parameters / Thresholds
- Input shape: B-001-defined MNIST tensor shape, either 28x28x1 or 1x28x28 depending on the framework.
- Output classes: 10.
- Adam default starting point from the paper/framework convention: learning rate about 0.001, beta1 about 0.9, beta2 about 0.999, epsilon about 1e-8. Evidence: P-003.
- Dropout: optional regularization. Use a modest dropout probability only if overfitting appears or if the architecture includes a dense hidden layer. Evidence: P-004.
- Epoch count and batch size should be configurable because the plan requires training and metric tracking, not a hard-coded training duration.

## Constraints
- B-002 depends on B-001. Do not implement a second incompatible image normalization, channel order, or label encoding inside the training module.
- Do not move B-003 responsibilities into B-002: B-002 may track validation metrics during training, but full test-set reporting, confusion matrix, and user-facing inference belong to B-003.
- Keep the model small and clear. MNIST does not require a large modern architecture for this plan.
- Keep the saved model artifact format stable and documented so B-003 can load it without retraining.
- If dropout is included, ensure it is active only during training and inactive during evaluation/inference according to framework semantics.

## Risks
- Shape mismatch between B-001 and B-002 is the highest implementation risk. Explicitly assert or document input shape before training.
- Loss/output mismatch can silently degrade training or fail at runtime. The spec must choose logits-plus-logits-aware-loss or softmax-plus-probability-loss explicitly.
- Label encoding mismatch can break cross-entropy. The spec must align B-001 label format with B-002 loss selection.
- Overusing dropout on a very small MNIST CNN can slow convergence or reduce accuracy unnecessarily.
- Saving only weights without architecture or preprocessing metadata can make B-003 loading/inference fragile.

## Conflicts Between Papers
- No direct conflict for this block. P-002 supports the CNN training approach, P-003 supports the optimizer, and P-004 supports optional regularization.
- P-004 is not a requirement to always use dropout; it supports dropout as a regularization option. The implementation can omit dropout if the final spec chooses the simplest reliable baseline, but if the original plan expects dropout layers, include it conservatively.

## Implementation Guidance
- The B-002 spec should choose a single framework convention for input shape, loss, and model serialization.
- Recommended baseline architecture: Conv -> activation -> pooling -> Conv or Dense -> activation -> optional Dropout -> Dense(10). Exact layer sizes should be specified in spec.md, not guessed during implementation.
- Use Adam with paper/default hyperparameters as the initial optimizer configuration unless the selected framework has equivalent defaults.
- Save training history to a structured file or return it from the training function so B-003/reporting can consume metrics.
- Save the trained model after training completes and expose the path as part of B-002's output contract.

## Evidence Map
- P-002 -> convolutional/gradient-based handwritten digit recognition and suitability of small CNN-style architecture.
- P-003 -> Adam optimizer method, adaptive moment estimates, computational efficiency, default optimizer hyperparameters.
- P-004 -> dropout regularization behavior, training-time random unit dropping, test-time unthinned network behavior, overfitting reduction motivation.

## Approval
Approved at: 2026-07-22T18:45:17.923Z
Approved by: fikayo
Notes: None
