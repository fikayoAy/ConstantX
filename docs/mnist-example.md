# MNIST Worked Example

![MNIST worked example flow](../assets/mnist-flow.svg)

This repo includes a complete Python/PyTorch MNIST example in [`../mnist_folder`](../mnist_folder).

Useful files:

- [`B-001 Data Pipeline and Preprocessing`](../mnist_folder/blocks/B-001-data-pipeline-and-preprocessing/block.md)
- [`B-002 CNN Model Training`](../mnist_folder/blocks/B-002-cnn-model-training/block.md)
- [`B-003 Evaluation, Inference, and Run Instructions`](../mnist_folder/blocks/B-003-evaluation-inference-and-run-instructions/block.md)
- [`mnist_pipeline/data.py`](../mnist_folder/mnist_pipeline/data.py)
- [`mnist_pipeline/model.py`](../mnist_folder/mnist_pipeline/model.py)
- [`mnist_pipeline/evaluation.py`](../mnist_folder/mnist_pipeline/evaluation.py)
- [`mnist_pipeline/RUN_INSTRUCTIONS.md`](../mnist_folder/mnist_pipeline/RUN_INSTRUCTIONS.md)

Example prompt shape:

```text
Use ConstantX. Start project <REPO_PATH>\mnist_folder from plan <REPO_PATH>\mnist_folder\mnist.md with language Python and framework PyTorch. Propose no more than 3 blocks. Do not write blocks until I approve.
```

Verify the example:

```bash
python -m unittest discover -s mnist_folder\tests -t mnist_folder -p "test_*.py"
npm run verify
```
