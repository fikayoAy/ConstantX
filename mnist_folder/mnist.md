# MNIST Classification System Plan

## Goal

Build a simple image classification system that trains a neural network to recognize handwritten digits from the MNIST dataset.

## System Requirements

The system should load the MNIST dataset, preprocess the images, train a classification model, evaluate model accuracy, and provide a simple inference function for predicting digits from new images.

## Data Handling

The system must download or load MNIST images and labels, split the data into training and test sets, normalize pixel values, and reshape the images into the format expected by the model.

## Model

Implement a neural network for digit classification. The model should accept a 28x28 grayscale image and output probabilities for the 10 digit classes from 0 to 9.

The model can be a small convolutional neural network with convolution, pooling, dense, dropout, and softmax layers.

## Training

Train the model using cross-entropy loss and an optimizer such as Adam. Track training loss, validation loss, and accuracy during training.

## Evaluation

Evaluate the trained model on the MNIST test set. Report test accuracy, loss, and optionally a confusion matrix showing which digits are commonly misclassified.

## Inference

Provide a function or script that accepts a single handwritten digit image, preprocesses it the same way as the training data, runs the trained model, and returns the predicted digit and confidence score.

## Outputs

The system should produce:

- A trained model file.
- Training and evaluation metrics.
- A reusable inference function.
- Clear instructions for running training, evaluation, and prediction.
