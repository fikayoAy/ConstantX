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
