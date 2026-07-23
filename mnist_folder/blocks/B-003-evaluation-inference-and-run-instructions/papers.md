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
