"""Generate one noise state for the interactive engine CT 3D FoJ demo."""

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
ENGINE_VOLUME = (
    REPO_ROOT
    / "examples/image_of_engine/cone_ntrain_25_angle_360/2_engine_cone/vol_gt.npy"
)
PATCH_SIZE = 6
PATCH_STRIDE = 2
PATCH_CHUNK = 26

# The clean engine is concentrated in this patch-aligned box. The browser still
# receives the complete 256^3 CT; limiting optimization to the occupied support
# avoids spending most of the runtime fitting junctions to empty background.
ROI_BOUNDS = ((16, 232), (0, 250), (0, 222))  # z, y, x


def load_engine_ct():
    volume = np.load(ENGINE_VOLUME).astype(np.float32)
    if volume.shape != (VOLUME_SIZE, VOLUME_SIZE, VOLUME_SIZE):
        raise RuntimeError(f"Unexpected engine CT shape: {volume.shape}")
    return np.clip(volume, 0.0, 1.0)


def add_poisson_noise(clean, photons, seed):
    generator = np.random.default_rng(seed)
    noisy = generator.poisson(clean * photons).astype(np.float32) / photons
    return np.clip(noisy, 0.0, 1.0)


def optimize_patch_batch(volume):
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
    model = foj_module.FieldOfJunctions3D(volume[..., None], options)
    for iteration in range(model.num_iters):
        model.step(iteration)

    # The final step renders both outputs from the same fitted local junctions.
    regions = model.global_volume[0, 0].detach().cpu().numpy()
    boundaries = model.global_boundaries[0, 0].detach().cpu().numpy()
    coverage = model.num_patches.detach().cpu().numpy()
    regions = np.clip(regions, 0.0, 1.0)
    boundaries = np.clip(boundaries, 0.0, 1.0)
    del model
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    return regions, boundaries, coverage


def patch_groups(length):
    if (length - PATCH_SIZE) % PATCH_STRIDE:
        raise RuntimeError("ROI dimensions must contain an integer patch grid")
    patch_count = (length - PATCH_SIZE) // PATCH_STRIDE + 1
    return patch_count, list(range(0, patch_count, PATCH_CHUNK))


def optimize(volume):
    roi_slices = tuple(slice(start, end) for start, end in ROI_BOUNDS)
    roi = volume[roi_slices]
    axis_grids = [patch_groups(length) for length in roi.shape]
    total_batches = int(np.prod([len(groups) for _, groups in axis_grids]))

    accumulated_regions = np.zeros_like(roi, dtype=np.float32)
    accumulated_boundaries = np.zeros_like(roi, dtype=np.float32)
    accumulated_weight = np.zeros_like(roi, dtype=np.float32)
    batch_number = 0

    # Partition the dense stride-2 patch grid into memory-safe batches. Their
    # voxel extents overlap by R - stride, so coverage-weighted accumulation is
    # exactly the same averaging used by one full-volume field.
    for patch_z0 in axis_grids[0][1]:
        nz = min(PATCH_CHUNK, axis_grids[0][0] - patch_z0)
        z0 = patch_z0 * PATCH_STRIDE
        z1 = z0 + PATCH_SIZE + (nz - 1) * PATCH_STRIDE
        for patch_y0 in axis_grids[1][1]:
            ny = min(PATCH_CHUNK, axis_grids[1][0] - patch_y0)
            y0 = patch_y0 * PATCH_STRIDE
            y1 = y0 + PATCH_SIZE + (ny - 1) * PATCH_STRIDE
            for patch_x0 in axis_grids[2][1]:
                nx = min(PATCH_CHUNK, axis_grids[2][0] - patch_x0)
                x0 = patch_x0 * PATCH_STRIDE
                x1 = x0 + PATCH_SIZE + (nx - 1) * PATCH_STRIDE
                batch_number += 1
                print(
                    f"patch batch {batch_number:03d}/{total_batches}: "
                    f"z={z0}:{z1}, y={y0}:{y1}, x={x0}:{x1}",
                    flush=True,
                )
                regions, boundaries, coverage = optimize_patch_batch(
                    roi[z0:z1, y0:y1, x0:x1]
                )
                accumulated_regions[z0:z1, y0:y1, x0:x1] += regions * coverage
                accumulated_boundaries[z0:z1, y0:y1, x0:x1] += boundaries * coverage
                accumulated_weight[z0:z1, y0:y1, x0:x1] += coverage

    if np.any(accumulated_weight == 0):
        raise RuntimeError("Dense patch assembly left uncovered voxels")

    dense_regions = accumulated_regions / accumulated_weight
    dense_boundaries = accumulated_boundaries / accumulated_weight

    region_volume = volume.copy()
    region_volume[roi_slices] = dense_regions
    boundary_volume = np.zeros_like(volume, dtype=np.float32)
    boundary_volume[roi_slices] = dense_boundaries
    return np.clip(region_volume, 0.0, 1.0), boundary_volume


def boundary_for_display(boundaries, regions):
    occupied = boundaries[boundaries > 0]
    if not occupied.size:
        return boundaries
    low, high = np.percentile(occupied, [75.0, 99.5])
    normalized = np.clip((boundaries - low) / max(high - low, 1e-6), 0.0, 1.0)
    gradient = np.sqrt(sum(component**2 for component in np.gradient(regions)))
    contrast = np.clip((gradient - 0.015) / (0.15 - 0.015), 0.0, 1.0) ** 0.65
    global_response = normalized**0.7 * contrast
    continuous_contour = np.clip(gradient / 0.12, 0.0, 1.0) ** 0.55
    return np.maximum(global_response, 0.25 * continuous_contour)


def psnr(reference, estimate):
    mse = np.mean((reference - estimate) ** 2)
    return float(-10.0 * np.log10(mse))


def to_uint8(array):
    return np.round(np.clip(array, 0.0, 1.0) * 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--photons",
        type=int,
        choices=(20, 50, 100),
        help="Expected photons at unit intensity; omit for the clean state.",
    )
    parser.add_argument("--seed", type=int, default=3047)
    parser.add_argument(
        "--output",
        type=Path,
    )
    args = parser.parse_args()

    started = time.time()
    clean_ct = load_engine_ct()
    input_volume = (
        clean_ct
        if args.photons is None
        else add_poisson_noise(clean_ct, args.photons, args.seed)
    )
    regions, boundaries = optimize(input_volume)
    boundary_display = boundary_for_display(boundaries, regions)
    payload = np.stack(
        [to_uint8(input_volume), to_uint8(regions), to_uint8(boundary_display)]
    )
    if args.output is None:
        filename = (
            "junction-lab-256.bin"
            if args.photons is None
            else f"engine-ct-p{args.photons}-256.bin"
        )
        output = REPO_ROOT / "docs/static/data" / filename
    else:
        output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    payload.tofile(output)

    roi_slices = tuple(slice(start, end) for start, end in ROI_BOUNDS)
    if args.photons is not None:
        print(
            "input PSNR in fitted support: "
            f"{psnr(clean_ct[roi_slices], input_volume[roi_slices]):.2f} dB"
        )
    print(
        "region PSNR in fitted support: "
        f"{psnr(clean_ct[roi_slices], regions[roi_slices]):.2f} dB"
    )
    print(
        "boundary display range (p75-p99.5): "
        f"{np.percentile(boundaries[boundaries > 0], [75.0, 99.5])}"
    )
    print(f"output: {output} ({output.stat().st_size} bytes)")
    print(f"elapsed: {time.time() - started:.1f} seconds")


if __name__ == "__main__":
    main()
