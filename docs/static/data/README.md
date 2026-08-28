# Interactive demo data

`junction-lab-256.bin.gz` is a gzip-compressed payload containing three
`256 x 256 x 256` uint8 volumes in contiguous
`[noisy input, 3D FoJ, ground truth]` channel order. Voxels within each channel
are stored in `z, y, x` order.

The controlled phantom is a large two-material polyhedron with planar corners,
a rotated void, and square channels. It is a visualization designed to make the
3D behavior of the representation easy to inspect; it is not a benchmark or a
paper result. The middle channel's foreground crop is produced at native voxel
resolution by the repository's actual 3D FoJ optimizer on a dense overlapping
patch field. The constant exterior is estimated from the noisy volume's outer
support. The displayed result uses hard membership in the two regions estimated
from the FoJ reconstruction; no smoothing filter, display blur, or patch-grid
antialiasing is applied.

- Noise model: Poisson, 20 expected photons per voxel (P20)
- Input PSNR: 20.37 dB
- 3D FoJ PSNR: 29.94 dB (+9.57 dB)
- 3D FoJ settings: patch size 6, stride 2, 5 wedge values, 1 exhaustive
  initialization, and 1 refinement iteration
- Dense-field assembly: disjoint batches of patch locations are reconstructed
  and combined with exact voxel-wise overlap counts

Regenerate the asset with `scripts/generate_demo_volume.py` from the repository
root, then gzip the resulting binary for the browser. The exact random seed,
phantom construction, dense patch assembly, and optimizer settings are recorded
in that script.
