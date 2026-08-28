"""Generate the controlled 3D junction phantom used by the project-page demo."""

from pathlib import Path
from types import SimpleNamespace
import argparse
import sys
import time

import numpy as np
import torch


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import field_of_junctions3d as foj_module  # noqa: E402


VOLUME_SIZE = 64
PHOTON_COUNT = 5


def make_phantom(size=VOLUME_SIZE):
    coordinates = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    z, y, x = np.meshgrid(coordinates, coordinates, coordinates, indexing="ij")

    clean = np.full((size, size, size), 0.025, dtype=np.float32)
    body = (
        (np.abs(x) < 0.84)
        & (np.abs(y) < 0.80)
        & (np.abs(z) < 0.76)
        & (x + y < 1.22)
        & (-x + z < 1.18)
        & (y - z < 1.16)
    )

    plane_1 = x + 0.36 * y - 0.20 * z + 0.04
    plane_2 = y - 0.30 * z + 0.12 * x - 0.06
    plane_3 = z + 0.26 * x - 0.18 * y + 0.02

    clean[body] = 0.14
    clean[body & (plane_1 >= 0)] = 0.42
    clean[body & (plane_1 >= 0) & (plane_2 >= 0)] = 0.68
    clean[body & (plane_1 >= 0) & (plane_2 >= 0) & (plane_3 >= 0)] = 0.92

    # A rotated cuboid void exposes planar corners in all three orthogonal views.
    void = (
        (np.abs(x + 0.18 * y) < 0.20)
        & (np.abs(y - 0.16 * z) < 0.18)
        & (np.abs(z + 0.12 * x) < 0.17)
    )
    clean[body & void] = 0.025

    # Three square channels and two oblique ribs add fine but still planar structure.
    channel_x = body & (np.abs(y + 0.43) < 0.085) & (np.abs(z - 0.27) < 0.085)
    channel_y = body & (np.abs(x - 0.46) < 0.085) & (np.abs(z + 0.29) < 0.085)
    channel_z = body & (np.abs(x + 0.42) < 0.085) & (np.abs(y - 0.40) < 0.085)
    clean[channel_x | channel_y | channel_z] = 0.025

    rib_1 = body & (np.abs(x - 0.55 * y + 0.22 * z) < 0.055) & (z < 0.48)
    rib_2 = body & (np.abs(z + 0.48 * x - 0.18 * y) < 0.055) & (y > -0.58)
    clean[rib_1] = 0.82
    clean[rib_2] = 0.58
    return clean


def add_poisson_noise(clean, seed=3047):
    generator = np.random.default_rng(seed)
    noisy = generator.poisson(clean * PHOTON_COUNT).astype(np.float32) / PHOTON_COUNT
    return np.clip(noisy, 0.0, 1.0)


def optimize(noisy):
    foj_module.dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    options = SimpleNamespace(
        R=8,
        stride=4,
        eta=0.02,
        delta=0.07,
        lr_angles=0.005,
        lr_x0y0z0=0.05,
        lambda_boundary_final=0.1,
        lambda_color_final=0.001,
        nvals=5,
        num_initialization_iters=6,
        num_refinement_iters=30,
        greedy_step_every_iters=12,
        parallel_mode=True,
    )
    model = foj_module.FieldOfJunctions3D(noisy[..., None], options)
    for iteration in range(model.num_iters):
        model.step(iteration)

    parameters = torch.cat([model.angles, model.x0y0z0], dim=1)
    _, _, patches = model.get_dists_and_patches_3d(parameters)
    smoothed = model.local2global_3d(patches)[0, 0].detach().cpu().numpy()
    return np.clip(smoothed, 0.0, 1.0)


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
        default=REPO_ROOT / "docs/static/data/junction-lab.bin",
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
