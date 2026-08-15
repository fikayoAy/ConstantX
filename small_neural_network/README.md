# Addition Neural Network

Small PyTorch project that trains a feed-forward neural network to predict the sum of two integers in the range `0..100`.

## Commands

Run tests:

```powershell
python -m pytest
```

Train and save a model artifact:

```powershell
python -m addition_nn.train --model-path artifacts/addition_model.pt
```

Evaluate the saved model:

```powershell
python -m addition_nn.evaluate --model-path artifacts/addition_model.pt
```

Run sample inference:

```powershell
python -m addition_nn.infer 2 3 --model-path artifacts/addition_model.pt
```
