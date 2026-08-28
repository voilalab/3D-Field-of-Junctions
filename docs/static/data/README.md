# Interactive demo volumes

These lossless WebP files contain the full `256 x 256 x 256` engine volumes from the P50 low-dose CT experiment. Each image is a `4096 x 4096` atlas whose 256 axial slices are arranged in a `16 x 16` grid. The browser reconstructs synchronized XY, YZ, and XZ views from the atlases.

The data are quantized to 8-bit only for browser display using these fixed visualization windows:

- `engine-p50-cgls.webp`: CGLS initialization, `[-1.0, 1.4]`
- `engine-p50-foj.webp`: 3D FoJ reconstruction, `[-0.15, 0.65]`
- `engine-ground-truth.webp`: reference volume, `[0.0, 0.8]`

Reported paper metrics are computed from the original floating-point volumes, not these display atlases.
