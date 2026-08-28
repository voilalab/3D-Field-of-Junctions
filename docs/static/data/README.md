# Interactive demo data

`junction-lab-256.bin.gz` is a gzip-compressed payload containing three
`256 x 256 x 256` uint8 volumes in contiguous
`[noisy input, 3D FoJ, ground truth]` channel order. Voxels within each channel
are stored in `z, y, x` order.

The controlled phantom combines intersecting oblique planes, corners, ribs, a
rotated void, and square channels. It is a visualization designed to make the
3D behavior of the representation easy to inspect; it is not a benchmark or a
paper result. The middle channel is produced by the repository's actual 3D FoJ
optimizer in overlapping memory-safe blocks. A one-voxel separable binomial
filter suppresses residual patch-grid texture for display.

- Noise model: Poisson, 20 expected photons per voxel (P20)
- Input PSNR: 20.75 dB
- Displayed 3D FoJ PSNR: 24.71 dB (+3.96 dB)
- 3D FoJ settings: patch size 8, stride 8, 5 wedge values, 1 exhaustive
  initialization, and 5 refinement iterations per block
- Block assembly: `88^3` blocks with 4-voxel overlap and separable linear
  blending

Regenerate the asset with `scripts/generate_demo_volume.py` from the repository
root, then gzip the resulting binary for the browser. The exact random seed,
phantom construction, block assembly, and antialiasing step are recorded in
that script.
