# Spec For B-003 Non-Goals / Verification

## Status
Draft only. This spec is not approved and must not be implemented until ConstantX approval gates are satisfied.

## Implementation Target
Language: Python
Framework: pytorch
- Language: Python
- Framework: pytorch

## Source Inputs
- block.md: B-003 Non-Goals / Verification
- pins.md: non-goal pins [4] through [8], verification pins [9] through [11], criteria pins [17] through [23], evidence pin [28], and attached-evidence pin [30]
- papers.md: P-015 through P-021
- extracted-research.md: B-003-specific extracted evidence
- implementation directives: none recorded for B-003
- dependencies: B-001 and B-002 specs and implementation outputs

## Purpose
Specify non-goal constraints and command-level verification for the addition neural network project. This block ensures the project remains a small local Python/PyTorch pipeline and provides commands to run tests, train, evaluate, and perform sample inference.

## Concrete Implementation Requirements
- Enforce the non-goals: no large language model, no arbitrary symbolic math engine, no web UI, no production-scale training optimization, and no placeholder/mock training code.
- Provide command-level access to run tests, train the model, evaluate the model, and run inference for a sample addition problem.
- Commands must call the real dataset/model/training/evaluation/inference code from B-001 and B-002.
- Commands must be local Python command-line workflows, not web server endpoints.
- Training and evaluation defaults must be bounded for development-scale verification.
- Evaluation and inference must avoid gradient calculation and optimizer updates.
- Verification must demonstrate that the saved model artifact can be used for later inference.

## Interfaces Or Data Contracts

### Test Command Contract
- Provide a documented command such as `python -m pytest` or an equivalent project command that runs the automated test suite from the project root.
- The command must exercise real tests for dataset generation, model shape, training, evaluation, save/load, and inference as specified by B-002.

### Train Command Contract
- Provide a command such as `python -m addition_nn.train` or equivalent.
- The command must generate/load the addition dataset, train the small feed-forward model, report basic training progress or final metrics, and save a model artifact.
- Default artifact path should be project-local, for example `artifacts/addition_model.pt`, unless implementation chooses a documented equivalent.

### Evaluate Command Contract
- Provide a command such as `python -m addition_nn.evaluate --model-path artifacts/addition_model.pt` or equivalent.
- The command must load the model artifact or otherwise use the trained model path specified by the user/config.
- The command must report held-out prediction error, at least MSE and optionally MAE.
- The command must not update model weights.

### Inference Command Contract
- Provide a command such as `python -m addition_nn.infer 2 3 --model-path artifacts/addition_model.pt` or equivalent.
- The command must accept two supported integers, validate them according to B-001, load/use the trained model, and print or return a numeric predicted sum.
- The command must include a sample inference path suitable for verification.

### Configuration Contract
- Commands may use Python `argparse` or equivalent standard CLI parsing.
- Commands must expose enough options to set model path and bounded training/evaluation parameters.
- Defaults must be small enough for local verification and must not imply production-scale optimization.

## Files Or Artifacts To Create Or Modify
- Create or modify CLI/module entry points for tests, training, evaluation, and inference.
- Candidate files, subject to existing repo layout: `addition_nn/train.py`, `addition_nn/evaluate.py`, `addition_nn/infer.py`, `addition_nn/__main__.py`, `pyproject.toml`, `README.md`, and test files under `tests/`.
- Create or use `artifacts/` for saved model outputs.
- Create or update documentation listing exact commands for tests, train, evaluate, and sample inference.

## Artifacts To Remove Or Replace
- No existing artifacts are required to be removed by this block.
- Replace any placeholder commands that print fixed values without running real project code.
- Replace any mock-only training/evaluation/inference scripts with commands that call the real B-001/B-002 functions.
- Do not add or retain web UI artifacts for this block unless the user later approves a directive that changes the plan.

## Implementation Steps
1. Inspect the existing repository layout and determine the project command style.
2. Wire a test command using pytest-compatible discovery.
3. Wire a training command to the real B-002 training function with bounded defaults and artifact saving.
4. Wire an evaluation command to the real B-002 evaluation and checkpoint-loading helpers.
5. Wire an inference command to the real B-001/B-002 inference function and checkpoint loading.
6. Add `argparse` or equivalent argument parsing for model path, sample inputs, and bounded training/evaluation options.
7. Use evaluation/inference no-gradient behavior.
8. Update documentation with the exact command strings for tests, train, evaluate, and sample inference.
9. Ensure commands reject unsupported inputs and surface clear errors.
10. Verify no web UI, LLM, symbolic-math engine, production/distributed training stack, or placeholder/mock training behavior is introduced.

## Traceability To Block And Research
- Non-goal pins [4] through [8] and criteria [17] through [21] are represented by the non-goal enforcement requirements and artifact replacement policy.
- Verification pins [9] through [11] and criteria [22] through [23] are represented by the test, train, evaluate, and inference command contracts.
- Implementation criteria [24] through [27] are represented by concrete command artifacts, data contracts, traceability, and verification expectations.
- Evidence pin [28] and attached-evidence pin [30] are represented by the adapter map below.

## Paper Model Fit And Adapter Map

### P-015 User plan: Addition Neural Network Plan
- Implementation role: controlling non-goal and verification-command source for B-003.
- Adapter or interface: map Non-Goals and Verification plan sections into command contracts and prohibited-artifact rules.
- Processing step: convert non-goal bullets into constraints and verification bullets into required commands.
- Consumed inputs: Non-Goals and Verification sections from `plan.md`.
- Produced outputs: command requirements for tests, train, evaluate, inference, and explicit exclusions.
- Provenance: local project file `C:\Users\ayode\small_neural_network\plan.md`, stored in ConstantX as P-015.
- Confidence or uncertainty handling: high confidence because it is the user-provided controlling plan; command names may adapt to existing repo style.
- Boundaries: applies to B-003 command verification and non-goals only; model internals come from B-001/B-002.

### P-016 PyTorch Optimizing Model Parameters tutorial
- Implementation role: official train/evaluate flow reference for command wiring.
- Adapter or interface: commands call project `train_model` and `evaluate_model` functions that follow PyTorch train/eval loop structure.
- Processing step: separate training command with optimizer updates from evaluation command without updates.
- Consumed inputs: model, dataloaders, loss/optimizer configuration, saved artifact path.
- Produced outputs: trained model artifact and evaluation metrics.
- Provenance: official PyTorch tutorial URL recorded in P-016.
- Confidence or uncertainty handling: high confidence for workflow separation; exact hyperparameters remain bounded local defaults.
- Boundaries: does not require distributed or production-scale training.

### P-017 PyTorch Saving and Loading Models tutorial
- Implementation role: official persistence reference for command-level artifact reuse.
- Adapter or interface: train command saves a `state_dict`-based artifact; evaluate/infer commands load it.
- Processing step: persist trained weights/config and restore them for later commands.
- Consumed inputs: trained model and model path.
- Produced outputs: reusable artifact and loaded model for evaluation/inference.
- Provenance: official PyTorch tutorial URL recorded in P-017.
- Confidence or uncertainty handling: high confidence for `state_dict` pattern; config metadata must match the saved model.
- Boundaries: does not define CLI parsing or test framework.

### P-018 PyTorch no_grad API reference
- Implementation role: official inference/evaluation gradient-disabling reference.
- Adapter or interface: wrap evaluation/inference prediction calls in `torch.no_grad()` or equivalent no-gradient context.
- Processing step: run prediction-only commands without recording gradients.
- Consumed inputs: loaded model and evaluation/inference tensors.
- Produced outputs: metrics or predictions without optimizer updates.
- Provenance: official PyTorch API reference URL recorded in P-018.
- Confidence or uncertainty handling: high confidence for inference memory/gradient behavior; tests should still verify weights are not updated during evaluation/inference.
- Boundaries: does not replace model `.eval()` or define metrics.

### P-019 pytest invocation documentation
- Implementation role: official test command reference.
- Adapter or interface: expose a documented `python -m pytest` or equivalent command.
- Processing step: discover and run test files from the project root.
- Consumed inputs: source files and tests from B-001/B-002/B-003.
- Produced outputs: pytest pass/fail result.
- Provenance: official pytest documentation URL recorded in P-019.
- Confidence or uncertainty handling: high confidence for test invocation; exact command may include project-specific options.
- Boundaries: does not define implementation internals.

### P-020 Python argparse documentation
- Implementation role: official command-line parsing reference.
- Adapter or interface: use `argparse.ArgumentParser` or equivalent standard parser for train/evaluate/infer command arguments.
- Processing step: parse model path, integers, and optional bounded training/evaluation parameters.
- Consumed inputs: command-line arguments from `sys.argv`.
- Produced outputs: typed/configured arguments passed to project functions.
- Provenance: official Python documentation URL recorded in P-020.
- Confidence or uncertainty handling: high confidence for standard library CLI parsing; exact options remain project choices.
- Boundaries: does not require a web UI or external CLI framework.

### P-021 PyTorch Reproducibility note
- Implementation role: development/test stability reference.
- Adapter or interface: expose seed options or use deterministic seeds in verification defaults/tests.
- Processing step: set seeds for bounded verification runs where helpful.
- Consumed inputs: optional seed value from config/CLI/test fixtures.
- Produced outputs: more stable local verification behavior.
- Provenance: official PyTorch note URL recorded in P-021.
- Confidence or uncertainty handling: medium confidence; reduces randomness but does not guarantee identical results across PyTorch versions, devices, or platforms.
- Boundaries: does not require production-grade determinism or performance tuning.

## Acceptance Criteria Coverage
- AC-B003-001: No LLM or transformer-style large language model may be introduced.
- AC-B003-002: No arbitrary symbolic math engine may be introduced; exact addition may only be used for dataset target generation and test oracle checks.
- AC-B003-003: No web UI may be introduced.
- AC-B003-004: No production-scale optimization, distributed training, or deployment stack is required or introduced.
- AC-B003-005: Commands and tests must exercise real training/evaluation/inference code, not placeholder or mock training.
- AC-B003-006: Provide a sample inference command/path using two supported integers.
- AC-B003-007: Provide commands for tests, training, evaluation, and sample inference.

## Verification Expectations
- Run the test command and confirm pytest executes project tests.
- Run the training command and confirm it creates a model artifact.
- Run the evaluation command and confirm it reports held-out prediction error.
- Run the inference command with sample supported integers and confirm it returns a numeric predicted sum.
- Inspect command code to confirm it calls real B-001/B-002 functions.
- Confirm no web UI, LLM, symbolic-math engine, or production-scale training stack was added.

## Non-Minimal Implementation Requirement
The eventual implementation must wire real commands to real project behavior. A command that only prints fixed sample output, bypasses model loading/training, or uses mocks in place of the neural network pipeline does not satisfy this spec.

## Out Of Scope
- Building a web application, symbolic calculator, arbitrary math system, LLM, distributed training system, or production deployment pipeline.
- Changing the B-001 input/model scope or B-002 pipeline requirements except where needed to call their approved public functions.
