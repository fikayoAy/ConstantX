# Implementation Spec For B-001 Data Pipeline and Preprocessing

## Implementation Target
Language: Python
Framework: PyTorch

## Source Block
---
{
  "id": "B-001",
  "title": "Data Pipeline and Preprocessing",
  "slug": "data-pipeline-and-preprocessing",
  "dir": "blocks/B-001-data-pipeline-and-preprocessing",
  "status": "research_approved",
  "depends_on": [],
  "related_blocks": [
    "B-002",
    "B-003"
  ],
  "source_plan_refs": [
    "Goal",
    "System Requirements",
    "Data Handling",
    "Inference"
  ],
  "paper_ids": [
    "P-001",
    "P-002"
  ],
  "created_at": "2026-07-21T17:57:47.887Z",
  "updated_at": "2026-07-22T18:44:08.790Z",
  "source_excerpt": "Goal: build a handwritten digit classifier from MNIST.\nSystem Requirements: load MNIST, preprocess images, train, evaluate, and provide inference.\nData Handling: download/load images and labels, use train/test split, normalize pixels, reshape images.\nInference: preprocess new single images the same way as training data."
}
---



# Data Pipeline and Preprocessing

## Purpose
Load MNIST, normalize it, split it, and prepare tensors/images in the exact shape required by the classifier.

## Source From Original Plan
Goal: build a handwritten digit classifier from MNIST.
System Requirements: load MNIST, preprocess images, train, evaluate, and provide inference.
Data Handling: download/load images and labels, use train/test split, normalize pixels, reshape images.
Inference: preprocess new single images the same way as training data.

## Responsibilities
- Download or load MNIST images and labels.
- Use the dataset's train/test split correctly.
- Normalize pixel values for model training and inference.
- Handle grayscale image shape consistently.
- Format labels for the chosen loss function.
- Provide reusable preprocessing for both training and inference.

## Inputs
- MNIST images and labels.
- Raw single-image input for inference preprocessing.

## Outputs
- Training dataset.
- Test dataset.
- Normalized image tensors.
- Encoded labels.
- Shared preprocessing function.

## Dependencies
TBD

## Related Blocks
- [B-002](../../blocks/B-002-cnn-model-training/block.md)
- [B-003](../../blocks/B-003-evaluation-inference-and-run-instructions/block.md)

## Research Questions
- What is the standard normalization used for MNIST CNN baselines?
- What input tensor shape should the selected framework use for 28x28 grayscale images?
- Is data augmentation useful or unnecessary for a simple MNIST baseline?

## Implementation Criteria
- Data loads reliably from the selected framework or dataset source.
- Pixel values are normalized consistently.
- Model receives 28x28x1 images or the framework-equivalent channel format.
- Training and inference share the same preprocessing logic.

## Open Questions
TBD

## Curated Papers
# Papers For B-001 Data Pipeline and Preprocessing

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
Primary dataset source for B-001. It defines the standard MNIST training/test files, 60,000 training examples, 10,000 test examples, 28x28 centered grayscale images, IDX file format, and the origin of the split from NIST SD-1 and SD-3.

### Relevant Sections
- Dataset sizes and train/test file names
- Size-normalized and centered 28x28 image construction
- IDX file format for images and labels
- NIST SD-1/SD-3 split details

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
Relevance score: 0.82

### Abstract
The paper reviews gradient-based learning methods for handwritten character recognition and compares methods on a standard handwritten digit recognition task.

### Relevance Notes
Primary paper supporting the MNIST benchmark context and the design goal of classifying handwritten characters with minimal preprocessing. Useful for B-001 because it constrains preprocessing to standard image preparation instead of complex feature engineering.

### Relevant Sections
- Handwritten digit recognition benchmark context
- Minimal preprocessing motivation for gradient-based classifiers
- Citation metadata for the standard MNIST-era document recognition paper

## Approved Research
# Extracted Research For B-001 Data Pipeline and Preprocessing

## Attached Papers
- P-001: The MNIST Database of Handwritten Digits. Source: https://yann.lecun.org/exdb/mnist/index.html
- P-002: Gradient Based Learning Applied to Document Recognition. Source: https://leon.bottou.org/papers/lecun-98h

## Relevant Claims
- MNIST should be treated as a fixed benchmark dataset with 60,000 training examples and 10,000 test examples. B-001 should use the canonical train/test split rather than creating a new random split from the whole dataset. Evidence: P-001.
- MNIST images are already size-normalized and centered into 28x28 images. B-001 should not add complex geometric preprocessing by default; the baseline pipeline should preserve the standard benchmark form. Evidence: P-001, P-002.
- The original source images were normalized to fit a 20x20 box while preserving aspect ratio, then centered in a 28x28 field using center-of-mass translation. This explains why the implementation should expect 28x28 grayscale digit images, not arbitrary-sized images, during training. Evidence: P-001.
- The raw MNIST files use the IDX binary format for multidimensional arrays and labels. If the implementation uses a framework dataset loader, the loader hides IDX parsing; if implementing manual loading, B-001 must parse IDX headers and byte order correctly. Evidence: P-001.
- Gradient-based handwritten recognition is intended to work with minimal preprocessing when the dataset is already formatted consistently. For this block, preprocessing should focus on reliable loading, normalization, dtype conversion, shape conversion, and consistent inference transforms. Evidence: P-002.

## Methods To Use
- Load the canonical MNIST training and test sets from a trusted framework loader or from the official MNIST files.
- Convert image pixels from unsigned-byte intensity values into floating-point tensors.
- Normalize pixel values consistently, with the simplest standard baseline being scaling from 0-255 integer values to 0.0-1.0 floating-point values.
- Preserve the 28x28 grayscale spatial layout for CNN training.
- Add a channel dimension for frameworks that expect explicit channels: 28x28x1 for channels-last or 1x28x28 for channels-first.
- Keep label handling compatible with B-002's loss function: integer class labels for sparse cross-entropy or one-hot vectors for categorical cross-entropy.
- Reuse the same preprocessing function for training, evaluation, and single-image inference.

## Algorithms / Equations
- Pixel scaling baseline: normalized_pixel = raw_pixel / 255.0.
- Shape conversion for image batches: from [N, 28, 28] to either [N, 28, 28, 1] or [N, 1, 28, 28], depending on the selected framework.
- Single-image inference conversion should mirror batch conversion: from one raw image to a batch of one normalized tensor with the same channel order used during training.

## Parameters / Thresholds
- Training examples: 60,000. Evidence: P-001.
- Test examples: 10,000. Evidence: P-001.
- Image size: 28x28 pixels. Evidence: P-001.
- Number of classes passed forward to B-002/B-003: 10 digit classes, 0 through 9. Evidence: source plan and MNIST dataset definition.
- Pixel dtype after preprocessing: floating point.
- Pixel value range after baseline normalization: [0.0, 1.0].

## Constraints
- Do not shuffle or merge the canonical train/test split before evaluation; B-003 depends on a stable held-out MNIST test set.
- Do not apply deskewing, random distortions, augmentation, or other enhanced preprocessing in the default B-001 pipeline unless later explicitly requested. Those choices change the benchmark setup and belong in an optional extension, not the baseline data contract.
- Single-image inference must apply the same resizing, grayscale conversion, normalization, and channel-order handling as training.
- If external images are accepted, they must be converted into MNIST-compatible 28x28 grayscale tensors before prediction. The exact external-image cleanup policy should be specified in B-003, but the shared preprocessing utility belongs in B-001.

## Risks
- Frameworks differ on channel order. A silent mismatch between 28x28x1 and 1x28x28 will break B-002 model training or produce incorrect inference.
- Label format must match the selected loss. One-hot labels with sparse cross-entropy or integer labels with categorical cross-entropy will cause errors or wrong training behavior.
- Manual IDX parsing can fail if byte order and header dimensions are ignored. Prefer a framework loader unless manual loading is required.
- Adding non-standard preprocessing can make reported metrics harder to compare with standard MNIST baselines.

## Conflicts Between Papers
- No conflict for B-001. P-001 defines the dataset format and split. P-002 supports the minimal-preprocessing handwritten-recognition context.

## Implementation Guidance
- Implement a single data/preprocessing module that exposes training/test dataset loading and a reusable `preprocess_image` path for inference.
- Keep B-001 independent of model architecture except for the image tensor contract required by B-002.
- Store or document the chosen channel order explicitly so B-002 and B-003 cannot make incompatible assumptions.
- Return labels in the format selected for B-002's loss function, and document that contract in the spec.
- Prefer no augmentation for the baseline. If augmentation is added later, make it optional and training-only.

## Evidence Map
- P-001 -> canonical MNIST dataset source, train/test counts, 28x28 centered grayscale images, IDX storage details, NIST source split.
- P-002 -> handwritten digit recognition benchmark context and minimal-preprocessing motivation for gradient-based classifiers.

## Approval
Approved at: 2026-07-22T18:44:08.790Z
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
Approved at: 2026-07-22T18:47:44.765Z
Approved by: fikayo
Notes: None
