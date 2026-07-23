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
