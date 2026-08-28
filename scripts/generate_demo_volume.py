"""Generate the controlled 3D junction phantom used by the project-page demo."""

from pathlib import Path
from types import SimpleNamespace
import argparse
import gc
import sys
import time

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import field_of_junctions3d as foj_module  # noqa: E402


VOLUME_SIZE = 256
PHOTON_COUNT = 20
PATCH_SIZE = 6
PATCH_STRIDE = 2
PATCH_CHUNK = 26
ROI_START = 22
ROI_SIZE = 212


def make_phantom(size=VOLUME_SIZE):
    coordinates = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    z, y, x = np.meshgrid(coordinates, coordinates, coordinates, indexing="ij")

    clean = np.full((size, size, size), 0.025, dtype=np.float32)
    body = (
        (np.abs(x) < 0.74)
        & (np.abs(y) < 0.72)
        & (np.abs(z) < 0.70)
        & (x + y < 1.12)
        & (-x + z < 1.08)
        & (y - z < 1.06)
    )
    clean[body] = 0.88

    # A rotated cuboid void exposes planar corners in all three orthogonal views.
    void = (
        (np.abs(x + 0.18 * y) < 0.17)
        & (np.abs(y - 0.16 * z) < 0.15)
        & (np.abs(z + 0.12 * x) < 0.14)
    )
    clean[body & void] = 0.025

    # Three square channels expose corners and junctions in every orthogonal view.
    channel_x = body & (np.abs(y + 0.43) < 0.055) & (np.abs(z - 0.27) < 0.055)
    channel_y = body & (np.abs(x - 0.46) < 0.055) & (np.abs(z + 0.29) < 0.055)
    channel_z = body & (np.abs(x + 0.42) < 0.055) & (np.abs(y - 0.40) < 0.055)
    clean[channel_x | channel_y | channel_z] = 0.025
    return clean


def add_poisson_noise(clean, seed=3047):
    generator = np.random.default_rng(seed)
    noisy = generator.poisson(clean * PHOTON_COUNT).astype(np.float32) / PHOTON_COUNT
    return np.clip(noisy, 0.0, 1.0)


def optimize_patch_batch(noisy):
    foj_module.dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    options = SimpleNamespace(
        R=PATCH_SIZE,
        stride=PATCH_STRIDE,
        eta=0.01,
        delta=0.05,
        lr_angles=0.005,
        lr_x0y0z0=0.05,
        lambda_boundary_final=0.1,
        lambda_color_final=0.001,
        nvals=5,
        num_initialization_iters=1,
        num_refinement_iters=1,
        greedy_step_every_iters=50,
        parallel_mode=True,
    )
    model = foj_module.FieldOfJunctions3D(noisy[..., None], options)
    for iteration in range(model.num_iters):
        model.step(iteration)

    # The final step already renders and folds the optimized overlapping patches.
    # Reuse it instead of evaluating the junction field a second time.
    smoothed = model.global_volume[0, 0].detach().cpu().numpy()
    coverage = model.num_patches.detach().cpu().numpy()
    smoothed = np.clip(smoothed, 0.0, 1.0)
    del model
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return smoothed, coverage


def optimize(noisy):
    roi_end = ROI_START + ROI_SIZE
    roi = noisy[ROI_START:roi_end, ROI_START:roi_end, ROI_START:roi_end]
    patch_count = (ROI_SIZE - PATCH_SIZE) // PATCH_STRIDE + 1
    if (ROI_SIZE - PATCH_SIZE) % PATCH_STRIDE:
        raise RuntimeError("ROI size must contain an integer patch grid")

    patch_groups = list(range(0, patch_count, PATCH_CHUNK))
    total_batches = len(patch_groups) ** 3
    accumulated = np.zeros_like(roi, dtype=np.float32)
    accumulated_weight = np.zeros_like(roi, dtype=np.float32)
    batch_number = 0

    # Partition the dense stride-2 patch grid into memory-safe batches. Their
    # voxel extents overlap by R - stride, and coverage-weighted accumulation is
    # exactly the same averaging used by a single full-volume field.
    for patch_z0 in patch_groups:
        nz = min(PATCH_CHUNK, patch_count - patch_z0)
        z0 = patch_z0 * PATCH_STRIDE
        z1 = z0 + PATCH_SIZE + (nz - 1) * PATCH_STRIDE
        for patch_y0 in patch_groups:
            ny = min(PATCH_CHUNK, patch_count - patch_y0)
            y0 = patch_y0 * PATCH_STRIDE
            y1 = y0 + PATCH_SIZE + (ny - 1) * PATCH_STRIDE
            for patch_x0 in patch_groups:
                nx = min(PATCH_CHUNK, patch_count - patch_x0)
                x0 = patch_x0 * PATCH_STRIDE
                x1 = x0 + PATCH_SIZE + (nx - 1) * PATCH_STRIDE
                batch_number += 1
                print(
                    f"patch batch {batch_number:02d}/{total_batches}: "
                    f"z={z0}:{z1}, y={y0}:{y1}, x={x0}:{x1}",
                    flush=True,
                )
                smoothed, coverage = optimize_patch_batch(roi[z0:z1, y0:y1, x0:x1])
                accumulated[z0:z1, y0:y1, x0:x1] += smoothed * coverage
                accumulated_weight[z0:z1, y0:y1, x0:x1] += coverage

    if np.any(accumulated_weight == 0):
        raise RuntimeError("Dense patch assembly left uncovered voxels")

    dense_roi = accumulated / accumulated_weight

    # The optimizer works with smooth indicators, while the underlying FoJ
    # representation is piecewise constant. Recover its two region levels with
    # an unsupervised 1D clustering step, then render the estimated field with
    # hard region membership instead of displaying a blurred patch average.
    low, high = np.percentile(dense_roi, [10, 90])
    for _ in range(50):
        high_region = np.abs(dense_roi - high) < np.abs(dense_roi - low)
        next_low = float(dense_roi[~high_region].mean())
        next_high = float(dense_roi[high_region].mean())
        if max(abs(next_low - low), abs(next_high - high)) < 1e-7:
            low, high = next_low, next_high
            break
        low, high = next_low, next_high
    threshold = 0.5 * (low + high)
    hard_region = dense_roi >= threshold
    low = float(roi[~hard_region].mean())
    high = float(roi[hard_region].mean())
    hard_roi = np.where(hard_region, high, low).astype(np.float32)

    border = 16
    background_samples = np.concatenate(
        [
            noisy[:border].ravel(),
            noisy[-border:].ravel(),
            noisy[:, :border].ravel(),
            noisy[:, -border:].ravel(),
            noisy[:, :, :border].ravel(),
            noisy[:, :, -border:].ravel(),
        ]
    )
    output = np.full_like(noisy, float(background_samples.mean()), dtype=np.float32)
    output[ROI_START:roi_end, ROI_START:roi_end, ROI_START:roi_end] = hard_roi
    return np.clip(output, 0.0, 1.0)


def psnr(reference, estimate):
    mse = np.mean((reference - estimate) ** 2)
    return float(-10.0 * np.log10(mse))


def to_uint8(array):
    return np.round(np.clip(array, 0.0, 1.0) * 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "docs/static/data/junction-lab-256.bin",
    )
    args = parser.parse_args()

    started = time.time()
    clean = make_phantom()
    noisy = add_poisson_noise(clean)
    smoothed = optimize(noisy)
    payload = np.stack([to_uint8(noisy), to_uint8(smoothed), to_uint8(clean)])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload.tofile(args.output)

    print(f"input PSNR: {psnr(clean, noisy):.2f} dB")
    print(f"3D FoJ PSNR: {psnr(clean, smoothed):.2f} dB")
    print(f"output: {args.output} ({args.output.stat().st_size} bytes)")
    print(f"elapsed: {time.time() - started:.1f} seconds")


if __name__ == "__main__":
    main()
