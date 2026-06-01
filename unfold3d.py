import torch
import torch.nn.functional as F
from torch import nn, Tensor
from typing import Tuple, Union
import numpy as np

class Unfold3d(nn.Module):
    def __init__(
        self,
        kernel_size: Union[int, Tuple[int, int, int]],
        dilation: Union[int, Tuple[int, int, int]] = 1,
        padding: Union[int, Tuple[int, int, int]] = 0,
        stride: Union[int, Tuple[int, int, int]] = 1,
    ):
        super().__init__()
        self.kernel_size = kernel_size if isinstance(kernel_size, tuple) else (kernel_size,) * 3
        self.dilation = dilation if isinstance(dilation, tuple) else (dilation,) * 3
        self.padding = padding if isinstance(padding, tuple) else (padding,) * 3
        self.stride = stride if isinstance(stride, tuple) else (stride,) * 3

    def forward(self, input: Tensor) -> Tensor:
        N, C, D, H, W = input.shape
        kD, kH, kW = self.kernel_size
        patch_vol = kD * kH * kW

        # Create grouped conv weights
        eye = torch.eye(patch_vol, device=input.device)
        weight = eye.view(patch_vol, 1, kD, kH, kW)        # [patch_vol, 1, kD, kH, kW]
        weight = weight.repeat(C, 1, 1, 1, 1)               # [C*patch_vol, 1, kD, kH, kW]

        # Apply grouped conv3d (no reshaping input)
        patches = F.conv3d(
            input,
            weight,
            bias=None,
            stride=self.stride,
            padding=self.padding,
            dilation=self.dilation,
            groups=C
        )  # shape: [N, C * patch_vol, D_out, H_out, W_out]

        # Flatten the spatial dimensions
        patches = patches.view(patches.size(0), patches.size(1), -1)  # [N, C * patch_vol, L]
        return patches