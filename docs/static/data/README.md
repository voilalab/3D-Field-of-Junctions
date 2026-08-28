# Interactive demo data

`junction-lab.bin` contains three `64 x 64 x 64` uint8 volumes in contiguous
`[noisy input, 3D FoJ, ground truth]` channel order. Voxels within each channel
are stored in `z, y, x` order.

The controlled phantom combines intersecting oblique planes, corners, ribs, a
rotated void, and square channels. It is a visualization designed to make the
3D behavior of the representation easy to inspect; it is not a benchmark or a
paper result. The middle channel is the output of the repository's actual 3D
FoJ optimizer and is not hand-cleaned or post-processed.

- Noise model: Poisson, 5 expected photons per voxel (P5)
- Input PSNR: 15.60 dB
- 3D FoJ PSNR: 20.29 dB (+4.69 dB)
- 3D FoJ settings: patch radius 8, stride 4, 5 wedge values, 6 initialization
  iterations, and 30 refinement iterations

Regenerate the asset with `scripts/generate_demo_volume.py` from the repository
root. The exact random seed and phantom construction are recorded in that
script.
