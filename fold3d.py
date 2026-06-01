import torch
import torch.nn.functional as F
from torch import nn, Tensor
from typing import Union, Tuple


class Fold3d(nn.Module):
    def __init__(
        self,
        output_size: Tuple[int, int, int],
        kernel_size: Union[int, Tuple[int, int, int]],
        channels: int,
        dilation: Union[int, Tuple[int, int, int]] = 1,
        padding: Union[int, Tuple[int, int, int]] = 0,
        stride: Union[int, Tuple[int, int, int]] = 1,
    ):
        super().__init__()
        self.output_size = output_size
        self.kernel_size = kernel_size if isinstance(kernel_size, tuple) else (kernel_size,) * 3
        self.dilation = dilation if isinstance(dilation, tuple) else (dilation,) * 3
        self.padding = padding if isinstance(padding, tuple) else (padding,) * 3
        self.stride = stride if isinstance(stride, tuple) else (stride,) * 3
        self.channels = channels

    def forward(self, input: Tensor) -> Tensor:
        """
        Args:
            input: Tensor of shape [N, C * kD * kH * kW, L]
        Returns:
            Tensor of shape [N, C, D_out, H_out, W_out]
        """
        N, CK, L = input.shape
        C = self.channels
        kD, kH, kW = self.kernel_size
        patch_vol = kD * kH * kW
        assert CK == C * patch_vol, f"Expected {C * patch_vol}, got {CK}"

        D_out, H_out, W_out = self.output_size
        Dp = (D_out + 2 * self.padding[0] - self.dilation[0] * (kD - 1) - 1) // self.stride[0] + 1
        Hp = (H_out + 2 * self.padding[1] - self.dilation[1] * (kH - 1) - 1) // self.stride[1] + 1
        Wp = (W_out + 2 * self.padding[2] - self.dilation[2] * (kW - 1) - 1) // self.stride[2] + 1
        assert Dp * Hp * Wp == L, f"L ({L}) != expected number of patches ({Dp * Hp * Wp})"

        # Reshape to [N * C, patch_vol, Dp, Hp, Wp]
        input = input.view(N, C, patch_vol, Dp, Hp, Wp).reshape(N * C, patch_vol, Dp, Hp, Wp)

        # Construct weight: [patch_vol, 1, kD, kH, kW]
        weight = torch.eye(patch_vol, device=input.device).view(patch_vol, 1, kD, kH, kW)

        # Apply transpose conv with groups=1
        out = F.conv_transpose3d(
            input,
            weight,
            bias=None,
            stride=self.stride,
            padding=self.padding,
            dilation=self.dilation,
            groups=1
        )  # Output: [N * C, 1, D_out, H_out, W_out]

        # Reshape back to [N, C, D_out, H_out, W_out]
        out = out.view(N, C, D_out, H_out, W_out)
        return out
