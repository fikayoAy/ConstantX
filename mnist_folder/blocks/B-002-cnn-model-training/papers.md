# Papers For B-002 CNN Model Training

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
Primary paper supporting the MNIST benchmark context, LeNet-style convolutional architecture, gradient-based training, and minimal-preprocessing handwritten recognition. Useful for B-002 because it grounds the small CNN classifier architecture for MNIST-like digit recognition.

### Relevant Sections
- LeNet-style convolutional network architecture for document recognition
- Gradient-based training for handwritten character recognition
- Standard handwritten digit recognition benchmark context

## P-003 Adam: A Method for Stochastic Optimization

Citation: Kingma, D. P., and Ba, J. Adam: A Method for Stochastic Optimization. International Conference on Learning Representations, 2015. arXiv:1412.6980.
Discovery source: codex_online
Source URL: https://arxiv.org/abs/1412.6980
Stored path: Reference only
Source path: N/A
Authors: Diederik P. Kingma, Jimmy Ba
Year: 2015
Venue: International Conference on Learning Representations
DOI: 10.48550/arXiv.1412.6980
arXiv: 1412.6980
Relevance score: 0.93

### Abstract
Introduces Adam, a first-order stochastic optimization algorithm using adaptive estimates of lower-order moments. The method is computationally efficient, has low memory requirements, and is suitable for noisy or sparse-gradient objectives.

### Relevance Notes
Primary optimizer paper for B-002. It supports using Adam as a computationally efficient stochastic optimizer with adaptive first and second moment estimates, low memory requirements, and default hyperparameters that usually need little tuning.

### Relevant Sections
- Algorithm definition and adaptive moment estimates
- Default hyperparameters and optimizer behavior
- Empirical neural-network optimization comparisons

## P-004 Dropout: A Simple Way to Prevent Neural Networks from Overfitting

Citation: Srivastava, N., Hinton, G., Krizhevsky, A., Sutskever, I., and Salakhutdinov, R. Dropout: A Simple Way to Prevent Neural Networks from Overfitting. Journal of Machine Learning Research, 15(56):1929-1958, 2014.
Discovery source: codex_online
Source URL: https://www.jmlr.org/papers/v15/srivastava14a.html
Stored path: Reference only
Source path: N/A
Authors: Nitish Srivastava, Geoffrey Hinton, Alex Krizhevsky, Ilya Sutskever, Ruslan Salakhutdinov
Year: 2014
Venue: Journal of Machine Learning Research
DOI: N/A
arXiv: N/A
Relevance score: 0.85

### Abstract
Introduces dropout as a technique for reducing overfitting in neural networks by randomly dropping units during training and approximating model averaging at test time with one unthinned network.

### Relevance Notes
Primary regularization paper for B-002. It supports optional dropout layers in the classifier to reduce overfitting by randomly dropping units during training while using a single unthinned network at test time.

### Relevant Sections
- Dropout training mechanism
- Overfitting reduction motivation
- Test-time unthinned network behavior
- Supervised vision benchmark relevance
