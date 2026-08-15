# Spec For B-001 Goal / Model Scope

## Status
Draft only. This spec is not approved and must not be implemented until ConstantX approval gates are satisfied.

## Implementation Target
Language: Python
Framework: pytorch
- Language: Python
- Framework: pytorch

## Source Inputs
- block.md: B-001 Goal / Model Scope
- pins.md: plan pins [1], [5] through [12], criteria pins [18] through [27], evidence pin [32], and attached-evidence pin [34]
- papers.md: P-001 through P-006
- extracted-research.md: B-001-specific extracted evidence
- implementation directives: none recorded for B-001

## Purpose
Define the core project scope for a small PyTorch neural network that learns addition over two bounded non-negative integer inputs. This block establishes dataset representation, public input/output contract, model family, training/evaluation responsibility, inference contract, and saved-artifact requirement.

## Concrete Implementation Requirements
- Implement real Python/PyTorch functionality, not scaffolding or placeholders.
- Preserve the public input contract: exactly two integers, `a` and `b`, with `0 <= a <= 100` and `0 <= b <= 100`.
- Represent each learning example as two numeric inputs and one target sum.
- Use floating-point tensors internally for neural-network regression.
- Implement a small feed-forward PyTorch model with two input features and one scalar output.
- Train the model using real optimizer-backed parameter updates.
- Evaluate on held-out examples not used for optimizer updates.
- Provide inference that accepts two validated integers and returns a numeric predicted sum.
- Save a trained model artifact that can be loaded later without retraining.
- Do not add a web UI, symbolic math solver, transformer, or large language model.

## Interfaces Or Data Contracts

### Public Inference Input
- Interface: `predict_sum(a: int, b: int, model_path: str | Path | None = None) -> float` or an equivalent project-local function selected by implementation.
- `a` and `b` must be Python integers.
- Reject `bool` values even though `bool` is an `int` subclass in Python.
- Reject values outside `[0, 100]` with `ValueError`.
- Reject non-integers with `TypeError`.

### Dataset Example Contract
- Feature tensor shape for one example: `(2,)` containing `[a, b]` as `torch.float32`.
- Target tensor shape for one example: `(1,)` or scalar-compatible tensor containing `a + b` as `torch.float32`.
- Batched feature tensor shape: `(batch_size, 2)`.
- Batched target tensor shape: `(batch_size, 1)` or `(batch_size,)`, normalized consistently before loss calculation.

### Model Contract
- Model input: `torch.Tensor` with last dimension `2`.
- Model output: `torch.Tensor` with one scalar prediction per example, preferably shape `(batch_size, 1)`.
- First trainable layer must accept two input features.
- Final trainable layer must emit one output feature.
- Final output must be raw regression output, with no softmax or classification head.

### Artifact Contract
- Saved model artifact must contain at minimum the model `state_dict` and configuration needed to reconstruct the same architecture.
- Artifact path should default to a project-local path such as `artifacts/addition_model.pt` unless later blocks choose a different command convention.

## Files Or Artifacts To Create Or Modify
- Create or modify source files that define dataset generation/loading, model class, training function, evaluation function, inference function, and model save/load helpers.
- Candidate files, subject to existing repo layout: `addition_nn/data.py`, `addition_nn/model.py`, `addition_nn/train.py`, `addition_nn/evaluate.py`, `addition_nn/infer.py`, `addition_nn/checkpoint.py`, and `addition_nn/__init__.py`.
- Create or use a runtime artifact directory such as `artifacts/` for trained model files.
- Tests and CLI command packaging are primarily specified by B-002/B-003, but B-001 implementation must expose callable functions that those blocks can test and invoke.

## Artifacts To Remove Or Replace
- No existing artifacts are required to be removed by this block.
- Replace any placeholder/mock implementation of the B-001 dataset, model, training, evaluation, inference, or checkpoint responsibilities with real PyTorch code.
- If an existing file already provides compatible behavior, modify it in place rather than duplicating competing implementations.

## Implementation Steps
1. Inspect the existing repository layout and reuse current package/test conventions if present.
2. Define constants for supported input range: minimum `0`, maximum `100`, and input dimension `2`.
3. Implement public input validation for inference boundaries.
4. Implement dataset generation for integer addition examples in the supported domain or a deterministic subset with a held-out split.
5. Convert generated feature and target values to `torch.float32` tensors for model training.
6. Implement a small feed-forward `torch.nn.Module` with two input features and one scalar output.
7. Implement training using real PyTorch loss, backward pass, optimizer step, and gradient reset.
8. Implement held-out evaluation that reports a scalar prediction-error metric.
9. Implement model persistence using `state_dict` plus configuration metadata.
10. Implement inference that loads a saved artifact when requested, validates `a` and `b`, runs the model in evaluation mode, and returns a Python numeric prediction.
11. Preserve compatibility with B-002 tests and B-003 commands.

## Traceability To Block And Research
- Block purpose [1] is represented by the public inference contract and the model/dataset requirements.
- Dataset obligations [5], [6], [18], and [19] are represented by the Dataset Example Contract and dataset implementation steps.
- Training obligation [7] and [20] is represented by the real optimizer-backed training requirement.
- Evaluation obligation [8] and [21] is represented by the held-out evaluation requirement.
- Inference obligation [9] and [22] is represented by `predict_sum` or equivalent public inference function.
- Artifact obligation [10] and [23] is represented by `state_dict` persistence and reload requirements.
- Input/output/model constraints [11], [12], and [24] through [27] are represented by the public input, model, and output contracts.
- Extracted evidence pin [32] is represented by the implementation requirements, data contracts, and evidence adapter map below.
- Attached evidence pin [34] is represented by the per-reference implementation role, processing step, provenance, confidence handling, boundaries, and adapter/interface fields below.

## Paper Model Fit And Adapter Map

### P-001 User plan: Addition Neural Network Plan
- Implementation role: controlling product and scope requirement source for B-001.
- Adapter or interface: map plan text into Python function contracts, dataset contracts, model contracts, and artifact contracts.
- Processing step: convert plan obligations into public contracts, model scope, dataset scope, artifact scope, and verification requirements.
- Consumed inputs: Goal, Requirements, and Model Scope sections from `plan.md`.
- Produced outputs: B-001 implementation contracts for inputs, outputs, dataset, model, training, evaluation, inference, and saved artifact.
- Provenance: local project file `C:\Users\ayode\small_neural_network\plan.md`, stored in ConstantX as P-001.
- Confidence or uncertainty handling: high confidence because it is the user-provided controlling plan; if local code conflicts with it, the plan governs unless the user later approves a directive.
- Boundaries: applies only to B-001 scope; detailed tests and command packaging are deferred to B-002/B-003.

### P-002 PyTorch Datasets & DataLoaders tutorial
- Implementation role: official PyTorch data representation and batching reference.
- Adapter or interface: implement a Dataset/DataLoader-compatible API that yields `(features, target)` tensors for addition examples.
- Processing step: adapt generated addition examples into Dataset/DataLoader-compatible feature/target samples.
- Consumed inputs: generated integer pairs `(a, b)` and target sums `a + b`.
- Produced outputs: tensors and batches with feature shape `(batch_size, 2)` and target shape compatible with scalar regression.
- Provenance: official PyTorch documentation URL recorded in P-002.
- Confidence or uncertainty handling: high confidence for PyTorch API patterns; project-specific split strategy remains a design choice constrained by held-out evaluation.
- Boundaries: does not prescribe exact dataset size or train/test ratio.

### P-003 PyTorch Build the Neural Network tutorial
- Implementation role: official PyTorch model construction reference.
- Adapter or interface: implement a project model class such as `AdditionNet(torch.nn.Module)` with a `forward(x)` method.
- Processing step: adapt `nn.Module`, `forward`, `nn.Linear`, `nn.ReLU`, and optional `nn.Sequential` patterns to a two-input scalar-regression model.
- Consumed inputs: batched feature tensors with two values per example.
- Produced outputs: one raw scalar prediction per example.
- Provenance: official PyTorch tutorial URL recorded in P-003.
- Confidence or uncertainty handling: high confidence for model construction pattern; exact hidden size/layer count is a local implementation choice.
- Boundaries: does not justify classifier softmax output or large architectures.

### P-004 PyTorch Linear API reference
- Implementation role: official layer shape contract reference.
- Adapter or interface: use `torch.nn.Linear` layers in the project model interface.
- Processing step: map two input features to hidden units and hidden units to one scalar output using `torch.nn.Linear`.
- Consumed inputs: tensors whose last dimension is `2`.
- Produced outputs: tensors whose last dimension is `1` at the final layer.
- Provenance: official PyTorch API reference URL recorded in P-004.
- Confidence or uncertainty handling: high confidence for shape semantics; runtime tests must still verify project-specific shapes.
- Boundaries: covers affine layers only and does not define training loop, persistence, or CLI behavior.

### P-005 PyTorch MSELoss API reference
- Implementation role: official scalar regression loss/error reference.
- Adapter or interface: use `torch.nn.MSELoss` or an equivalent loss call site that accepts prediction and target tensors.
- Processing step: compute prediction error between model output and target sum tensors.
- Consumed inputs: predicted scalar tensor and target sum tensor with compatible shape/dtype.
- Produced outputs: scalar loss/error value for training and evaluation reporting.
- Provenance: official PyTorch API reference URL recorded in P-005.
- Confidence or uncertainty handling: high confidence for MSE behavior; optional MAE can supplement reporting but must not replace required prediction-error reporting.
- Boundaries: does not define dataset generation or model architecture.

### P-006 PyTorch Saving and Loading Models tutorial
- Implementation role: official model persistence reference.
- Adapter or interface: implement save/load helpers such as `save_model(model, path, config)` and `load_model(path)`.
- Processing step: persist trained weights with `state_dict` and reload them into the same architecture for inference.
- Consumed inputs: trained model instance and model configuration metadata.
- Produced outputs: reusable model artifact and loaded model instance for inference.
- Provenance: official PyTorch tutorial URL recorded in P-006.
- Confidence or uncertainty handling: high confidence for `state_dict` persistence; implementation must include config metadata to avoid architecture mismatch.
- Boundaries: does not define training quality threshold or command interface.

## Acceptance Criteria Coverage
- AC-B001-001: Dataset generation/loading must create integer addition examples.
- AC-B001-002: Each example must be represented as two inputs and one target sum.
- AC-B001-003: A small feed-forward PyTorch model must train on generated examples.
- AC-B001-004: Evaluation must run on held-out unseen examples.
- AC-B001-005: Inference must accept two numbers and return a predicted sum.
- AC-B001-006: Training must save a reusable model artifact.
- AC-B001-007: Public inference inputs must be two integers, `a` and `b`.
- AC-B001-008: Public inference inputs must be limited to `0 <= a <= 100` and `0 <= b <= 100`.
- AC-B001-009: Public output must be the predicted value of `a + b`.
- AC-B001-010: Model type must remain a small feed-forward neural network.

## Verification Expectations
- Verify generated dataset examples have two inputs in range and the correct target sum.
- Verify model forward pass accepts `(batch_size, 2)` and returns one prediction per example.
- Verify training performs real parameter updates without runtime errors.
- Verify evaluation reports held-out prediction error.
- Verify inference validates inputs and returns a numeric prediction.
- Verify saved artifact can be loaded for inference without retraining.

## Non-Minimal Implementation Requirement
The eventual implementation must include real dataset generation/loading, a real PyTorch model, real parameter updates during training, held-out evaluation, inference, and artifact persistence. Placeholder models, mocked training, hard-coded inference sums as the primary solution, or test-only stubs do not satisfy this spec.

## Out Of Scope
- Large language models, transformers, symbolic math engines, arbitrary math support, web UI, and production-scale training optimization.
- Command packaging and full CLI verification are primarily specified by B-003.

## Spec Approval
Approved at: 2026-08-15T01:02:28.316Z
Approved by: local-user
Notes: User explicitly requested: approve spec, implement, record, and verify block B-001 to B-003.
