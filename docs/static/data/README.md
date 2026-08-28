# Interactive demo data

The demo has four independently loaded gzip payloads:

- `junction-lab-256.bin.gz`: clean reference
- `engine-ct-p100-256.bin.gz`: mild P100 Poisson noise
- `engine-ct-p50-256.bin.gz`: moderate P50 Poisson noise
- `engine-ct-p20-256.bin.gz`: severe P20 Poisson noise

Each payload contains three `256 x 256 x 256` uint8 volumes in contiguous
`[input, 3D FoJ regions, 3D FoJ global boundaries]` channel order. Voxels
within each channel are stored in `z, y, x` order.

The first channel is the clean engine volume already included with the paper's
CT experiments at
`examples/image_of_engine/cone_ntrain_25_angle_360/2_engine_cone/vol_gt.npy`.
It is not an invented browser-demo phantom. The second and third channels are
rendered from the same fitted local junctions by the repository's actual 3D FoJ
optimizer: piecewise-constant regional colors and the global boundary response,
respectively.

- Source volume: noise-free engine CT, 256 x 256 x 256 float32 voxels
- Noise model: Poisson sampling at 100, 50, or 20 expected photons for unit
  intensity, with random seed 3047
- 3D FoJ settings: patch size 6, stride 2, 5 discrete search values, 1
  exhaustive initialization, and 1 refinement iteration
- Dense-field assembly: disjoint batches of patch locations are reconstructed
  and combined with exact voxel-wise overlap counts
- Boundary display: the raw global boundary response is windowed from its 75th
  to 99.5th percentile, gamma-mapped, and weighted by the fitted region's local
  3D contrast. A low-intensity contour from that same fitted region supplies a
  continuous baseline, while aligned global junction evidence remains brighter.

PSNR is measured against the clean source within the fitted support:

- Clean regions: 28.99 dB
- P100: input 29.26 dB, regions 28.86 dB (-0.40 dB)
- P50: input 26.27 dB, regions 28.77 dB (+2.50 dB)
- P20: input 22.39 dB, regions 28.51 dB (+6.12 dB)

Regenerate the clean asset with `scripts/generate_demo_volume.py`. Pass
`--photons 100`, `--photons 50`, or `--photons 20` for a noisy state, then gzip
the resulting binary for the browser. The source path, seed, fitted support,
dense patch assembly, and fixed optimizer settings are recorded in that script.
