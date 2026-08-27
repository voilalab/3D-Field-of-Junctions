
# 3D Field of Junctions
----------------------------------------------------------------------------

**[Project page and interactive demo](https://voilalab.github.io/3D-Field-of-Junctions/)**

## Requirements

The code is implemented in pytorch. It has been tested using pytorch 1.6 but it should work for other pytorch 1.x versions. The following packages are required:

- python 3.x
- pytorch 1.x
- numpy >= 1.14.0

## Data

We have used engine dataset to test the 3D FoJ and it is located at the `examples/` folder.


## Usage

To analyze an `DxHxWxC` image into its field of junctions, you can simply run the following code snippet:
```
from field_of_junctions3d import FieldOfJunctions3D
foj = FieldOfJunctions3D(img, opts)
foj.optimize()
```

In addition to the input image, the `FieldOfJunctions3D` class requires an object `opts` with the following fields:
```
R                          Patch size
stride                     Stride of field of junctions (e.g. opts.stride == 1 is dense)
eta                        Width of Heaviside functions
delta                      Width of boundary maps
lr_angles                  Learning rate of angles
lr_x0y0z0                    Learning rate of vertex positions
lambda_boundary_final      Final value of spatial boundary consistency weight lambda_B
lambda_color_final         Final value of spatial color consistency weight lambda_C
nvals                      Number of values to query in Algorithm 2 
num_initialization_iters   Number of initialization iterations
num_refinement_iters       Number of refinement iterations
greedy_step_every_iters    Frequency of "greedy" iteration (applying Algorithm 2 with consistency)
parallel_mode              Whether or not to run Algorithm 2 in parallel over all `nvals` values.
```

Note that setting `parallel_mode` to `True` typically results in faster optimization, but requires more memory during
initialization. For large images on a GPU with limited memory, you might need to set `parallel_mode` to `False`.


Instead of using `foj.optimize()` which executes the entire optimization scheme, it is possible to access the field of junctions
during optimization by using the following equivalent code snippet:
```
foj = FieldOfJunctions(img, opts)
for i in range(foj.num_iters):
    foj.step(i)
```

See Python notebook in the `examples/` folder for a full usage example.

### Boundary maps

In order to compute the (global) boundary maps for a given field of junctions object `foj`:

```
params = torch.cat([foj.angles, foj.x0y0z0], dim=1)
dists, _, patches = foj.get_dists_and_patches_3d(params)
local_boundaries = foj.dists2boundaries_3d(dists)
global_boundaries = foj.local2global_3d(local_boundaries)[0, 0].detach().cpu().numpy()
```

### Boundary-aware smoothing

In order to compute the boundary-aware smoothing of the input image given `foj`, use:
```
params = torch.cat([foj.angles, foj.x0y0z0], dim=1)
dists, _, patches = foj.get_dists_and_patches_3d(params)
smoothed_img = foj.local2global_3d(patches)[0].permute(1, 2, 3, 0).detach().cpu().numpy()
```        


