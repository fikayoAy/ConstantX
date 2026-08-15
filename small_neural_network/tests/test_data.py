import pytest
import torch

from addition_nn.data import AdditionDataset, generate_examples, validate_operand


def test_generate_examples_complete_domain_and_targets():
    examples = generate_examples()

    assert len(examples) == 101 * 101
    assert examples[0].a == 0
    assert examples[0].b == 0
    assert examples[-1].a == 100
    assert examples[-1].b == 100
    assert all(0 <= example.a <= 100 for example in examples)
    assert all(0 <= example.b <= 100 for example in examples)
    assert all(example.target == example.a + example.b for example in examples)


def test_dataset_returns_two_feature_input_and_sum_target():
    dataset = AdditionDataset(generate_examples(0, 2))

    features, target = dataset[5]

    assert features.shape == (2,)
    assert target.shape == (1,)
    assert features.dtype == torch.float32
    assert target.dtype == torch.float32
    assert target.item() == features.sum().item()


@pytest.mark.parametrize("bad_value", [-1, 101])
def test_validate_operand_rejects_out_of_range_values(bad_value):
    with pytest.raises(ValueError):
        validate_operand(bad_value, "a")


@pytest.mark.parametrize("bad_value", [True, 1.2, "3"])
def test_validate_operand_rejects_non_integer_values(bad_value):
    with pytest.raises(TypeError):
        validate_operand(bad_value, "a")
