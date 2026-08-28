# Interactive demo data

`junction-lab-256.bin.gz` is a gzip-compressed payload containing three
`256 x 256 x 256` uint8 volumes in contiguous
`[noise-free engine CT, 3D FoJ regions, 3D FoJ global boundaries]` channel
order. Voxels within each channel are stored in `z, y, x` order.

The first channel is the clean engine volume already included with the paper's
CT experiments at
`examples/image_of_engine/cone_ntrain_25_angle_360/2_engine_cone/vol_gt.npy`.
It is not an invented browser-demo phantom. The second and third channels are
rendered from the same fitted local junctions by the repository's actual 3D FoJ
optimizer: piecewise-constant regional colors and the global boundary response,
respectively.

- Source volume: noise-free engine CT, 256 x 256 x 256 float32 voxels
- 3D FoJ settings: patch size 6, stride 2, 5 discrete search values, 1
  exhaustive initialization, and 1 refinement iteration
- Dense-field assembly: disjoint batches of patch locations are reconstructed
  and combined with exact voxel-wise overlap counts
- Boundary display: the raw global boundary response is windowed from its 75th
  to 99.5th percentile, gamma-mapped, and weighted by the fitted region's local
  3D contrast. A low-intensity contour from that same fitted region supplies a
  continuous baseline, while aligned global junction evidence remains brighter.

Regenerate the asset with `scripts/generate_demo_volume.py` from the repository
root, then gzip the resulting binary for the browser. The source path, fitted
support, dense patch assembly, and optimizer settings are recorded in that
script.
