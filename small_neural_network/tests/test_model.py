import torch

from addition_nn.model import AdditionNet


def test_model_maps_two_features_to_one_prediction():
    model = AdditionNet()
    batch = torch.tensor([[1.0, 2.0], [50.0, 25.0]])

    output = model(batch)

    assert output.shape == (2, 1)
