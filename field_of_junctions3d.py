import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import torch.nn.functional as F
import sys
sys.path.append('..')
from unfold3d import Unfold3d
from fold3d import Fold3d


if torch.cuda.is_available():
    dev = torch.device('cuda')
else:
    dev = torch.device('cpu')

class FieldOfJunctions3D:
    def __init__(self, vol, opts): 
        """
        vol : 3D input volume, numpy array of shape [D, H, W, C]
        opts: configuration with attributes like R, stride, eta, etc.
            R                          Patch size
            stride                     Stride for junctions (e.g. opts.stride == 1 is a dense field of junctions)
            eta                        Width parameter for Heaviside functions
            delta                      Width parameter for boundary maps
            lr_angles                  Angle learning rate
            lr_x0y0z0                    Vertex position learning rate
            lambda_boundary_final      Final value of spatial boundary consistency term
            lambda_color_final         Final value of spatial color consistency term
            nvals                      Number of values to query in Algorithm 2 from the paper
            num_initialization_iters   Number of initialization iterations
            num_refinement_iters       Number of refinement iterations
            greedy_step_every_iters    Frequency of "greedy" iteration (applying Algorithm 2 with consistency)
            parallel_mode              Whether or not to run Algorithm 2 in parallel over all `nvals` values.
        """

        # Get volume dimensions
        self.D, self.H, self.W, self.C = vol.shape

        assert (self.D - opts.R) % opts.stride == 0 and (self.H - opts.R) % opts.stride == 0 and (self.W - opts.R) % opts.stride == 0, \
                "Number of patches must be an integer."
        self.D_patches = (self.D - opts.R) // opts.stride + 1
        self.H_patches = (self.H - opts.R) // opts.stride + 1
        self.W_patches = (self.W - opts.R) // opts.stride + 1

        self.num_iters = opts.num_initialization_iters + opts.num_refinement_iters

        # Convert input volume [D, H, W, C] to torch tensor [1, C, D, H, W]
        t_vol = torch.tensor(vol, device= dev).permute(3, 0, 1, 2).unsqueeze(0)
        #print("shape t_vol:", t_vol.shape)
        #tensor = t_vol.unfold(2, opts.R, opts.stride).unfold(3, opts.R, opts.stride).unfold(4, opts.R, opts.stride)
        #print("params_query size (GB):", tensor.numel() * tensor.element_size() / 1e9)
        #t_vol = t_vol.cpu()
        # Extract patches manually (3D unfold doesn't exist, so simulate)

        self.patches = Unfold3d(kernel_size= opts.R, stride= opts.stride)(t_vol)
        #patches = self.unfold(t_vol)  # shape: [1, C*R*R*R, N_patches]
        #print("Patches shape:", self.patches.shape)

        self.vol_patches = self.patches.view(1, self.C, opts.R, opts.R, opts.R, self.D_patches, self.H_patches, self.W_patches)
        #print("Vol_Patches shape:",  self.vol_patches.shape)

        # Junction parameters
        self.angles = torch.zeros(1, 6, self.D_patches, self.H_patches, self.W_patches,
                                  device=dev, dtype=torch.float32, requires_grad=True)  # 3 normals: (theta, phi)
        self.x0y0z0 = torch.zeros(1, 3, self.D_patches, self.H_patches, self.W_patches,
                                  device=dev, dtype=torch.float32, requires_grad=True)  # junction center

        #print("Angles shape:", self.angles.shape)
        #print("x0y0z0 shape:", self.x0y0z0.shape)

        self.num_patches = Fold3d(output_size=[self.D, self.H, self.W],
                                         kernel_size=opts.R,
                                         stride=opts.stride, channels=1)(torch.ones(1, opts.R**3,
                                                                        self.D_patches *self.H_patches * self.W_patches,
                                                                        device=dev)).view(self.D, self.H, self.W)
        #print("num_patches shape:", self.num_patches.shape)
        #print(self.num_patches.max())
        #print("num_patches shape:", self.num_patches)

        # Grid for each patch
        lin = torch.linspace(-1.0, 1.0, opts.R, device= dev)
        z, y, x = torch.meshgrid(lin, lin, lin, indexing='ij')
        self.grid = torch.stack([x, y, z], dim=-1).view(1, opts.R, opts.R, opts.R, 1, 1, 1,3)
        #print("grid shape:", self.grid.shape)

        # Optimization
        adam_beta1 = 0.5
        adam_beta2 = 0.99
        adam_eps   = 1e-08

        optimizer_angles = optim.Adam([self.angles], opts.lr_angles, [adam_beta1, adam_beta2], eps=adam_eps)
        optimizer_x0y0z0 = optim.Adam([self.x0y0z0], opts.lr_x0y0z0, [adam_beta1, adam_beta2], eps=adam_eps)
        self.optimizers = [optimizer_angles, optimizer_x0y0z0]

        # Discrete search ranges
        self.angle_range  = torch.linspace(0.0, 2*np.pi, opts.nvals+1, device=dev)[:opts.nvals]
        self.x0y0z0_range = torch.linspace(-2.0, 2.0, opts.nvals, device=dev)

        # Global outputs
        self.global_volume      = None
        self.global_boundaries  = None

        # Save opts
        self.opts = opts

    def optimize(self): 
        """
        Optimize 3D field of junctions.
        """
        for iteration in range(self.num_iters):
            self.step(iteration)

    def step(self, iteration): 
        """
        Perform one step (either initialization or refinement).
        """
        # Linearly increase lambda from 0 to final values
        if self.opts.num_refinement_iters <= 1:
            factor = 0.0
        else:
            factor = max(0, (iteration - self.opts.num_initialization_iters) / 
                            (self.opts.num_refinement_iters - 1))

        lmbda_boundary = factor * self.opts.lambda_boundary_final
        lmbda_color    = factor * self.opts.lambda_color_final

        # Initialization or refinement
        if iteration < self.opts.num_initialization_iters or \
        (iteration - self.opts.num_initialization_iters + 1) % self.opts.greedy_step_every_iters == 0:
            self.initialization_step(lmbda_boundary, lmbda_color)
        else:
            self.refinement_step(lmbda_boundary, lmbda_color)


    def initialization_step(self, lmbda_boundary, lmbda_color): 
        """
        3D initialization step for Field of Junctions using coordinate descent.
        """
        # Concatenate parameters: [angles..., x0, y0, z0]
        params = torch.cat([self.angles, self.x0y0z0], dim=1).detach()
        #print('params=', params.shape)
        num_planes = self.angles.shape[1] // 2  # each plane has 2 angles: θ, φ
        num_params = self.angles.shape[1] + 3   # angles + x, y, z
        #print('angles=', self.angles.shape)
        #print('number of parmeters=', num_params)
        # Step 1: Coordinate descent on all parameters
        for i in range(num_params):
            params_query = params.repeat(self.opts.nvals, 1, 1, 1, 1)  # shape: [nvals, P, D', H', W']
            param_range = self.angle_range if i < self.angles.shape[1] else self.x0y0z0_range
            param_range = param_range.view(self.opts.nvals, 1, 1, 1, 1)   # shape: [nvals, 1, 1, 1, 1]
            params_query[:, i, :, :, :] += param_range.view(-1, 1, 1, 1)
            best_ind = self.get_best_inds_3d(params_query, lmbda_boundary, lmbda_color)

            params[0, i, :, :, :] = params_query[
                        best_ind.view(1, self.D_patches, self.H_patches, self.W_patches),
                        i,
                        torch.arange(self.D_patches).view(1, -1, 1, 1),
                        torch.arange(self.H_patches).view(1, 1, -1, 1),
                        torch.arange(self.W_patches).view(1, 1, 1, -1)
                    ]

        # Step 2: Heuristic refinement along plane normal
        for i in range(num_planes):
            theta = params[:, 2 * i, :, :, :]
            phi = params[:, 2 * i + 1, :, :, :]
            dx = torch.sin(theta) * torch.cos(phi) * self.x0y0z0_range.view(-1, 1, 1, 1)
            dy = torch.sin(theta) * torch.sin(phi) * self.x0y0z0_range.view(-1, 1, 1, 1)
            dz = torch.cos(theta) * self.x0y0z0_range.view(-1, 1, 1, 1)

            params_query = params.repeat(self.opts.nvals, 1, 1, 1, 1)
            params_query[:, 6, :, :, :] += dx
            params_query[:, 7, :, :, :] += dy
            params_query[:, 8, :, :, :] += dz
            best_ind = self.get_best_inds_3d(params_query, lmbda_boundary, lmbda_color)

            for j in range(6, 9):
                params[:, j, :, :, :] = params_query[
                    best_ind.view(1, self.D_patches, self.H_patches, self.W_patches),
                    j,
                    torch.arange(self.D_patches).view(1, -1, 1, 1),
                    torch.arange(self.H_patches).view(1, 1, -1, 1),
                    torch.arange(self.W_patches).view(1, 1, 1, -1)
                ]

        # Finalize parameters
        self.angles.data = params[:, :6, :, :, :].data
        self.x0y0z0.data = params[:, 6:, :, :, :].data

        # Update global maps
        dists, colors, patches = self.get_dists_and_patches_3d(params, lmbda_color)
        self.global_volume = self.local2global_3d(patches)
        self.global_boundaries = self.local2global_3d(self.dists2boundaries_3d(dists))


    def refinement_step(self, lmbda_boundary, lmbda_color):
        """
        Perform a single refinement step for 3D Field of Junctions.

        Inputs
        ------
        lmbda_boundary    Spatial consistency boundary loss weight
        lmbda_color       Spatial consistency color loss weight
        """
        # Combine angular and center parameters
        params = torch.cat([self.angles, self.x0y0z0], dim=1)  # shape [1, P, D', H', W']

        # Compute distance functions, colors, and patch renderings
        dists, colors, patches = self.get_dists_and_patches_3d(params, lmbda_color)

        #print(dists)
        # Compute mean loss over patches
        loss = self.get_loss_3d(dists, colors, patches, lmbda_boundary, lmbda_color).mean()

        # Gradient descent step
        for optimizer in self.optimizers:
            optimizer.zero_grad()
        loss.backward()
        for optimizer in self.optimizers:
            optimizer.step()

        # Recompute updated global image and boundary map
        dists, colors, patches = self.get_dists_and_patches_3d(params, lmbda_color)
        self.global_volume = self.local2global_3d(patches)
        self.global_boundaries = self.local2global_3d(self.dists2boundaries_3d(dists))

            
    def get_loss_3d(self, dists, colors, patches, lmbda_boundary, lmbda_color): 
        """
        Compute the full loss function for 3D FoJ:
        Includes data fidelity + boundary consistency + color consistency terms.

        Inputs
        ------
        dists             : Tensor of shape [N, 3, R, R, R, D', H', W']
        colors            : Tensor of shape [N, C, 3, D', H', W']
        patches           : Tensor of shape [N, C, R, R, R, D', H', W']
        lmbda_boundary    : float, weight for boundary consistency
        lmbda_color       : float, weight for color consistency

        Returns
        -------
        loss_per_patch    : Tensor of shape [N, D', H', W']
        """

        # --- Data term: Mean Squared Error between patch and local image patch
        # Shape: [N, D', H', W']
        loss_per_patch = ((self.vol_patches - patches) ** 2).mean(dim=(2, 3, 4)).sum(dim=1)

        # --- Boundary consistency term
        if lmbda_boundary > 0.0:
            boundary_term = self.get_boundary_consistency_term_3d(dists)  # [N, D', H', W']
            loss_per_patch = loss_per_patch + lmbda_boundary * boundary_term

        # --- Color consistency term
        if lmbda_color > 0.0:
            color_term = self.get_color_consistency_term_3d(dists, colors)  # [N, D', H', W']
            loss_per_patch = loss_per_patch + lmbda_color * color_term

        return loss_per_patch  # shape [N, D', H', W']



    def get_boundary_consistency_term_3d(self, dists): 
        """
        Compute boundary consistency loss for 3D FoJ.

        Inputs
        ------
        dists : Tensor of shape [N, 3, R, R, R, D', H', W']

        Returns
        -------
        consistency_loss : Tensor of shape [N, D', H', W']
        """
        # Step 1: Local boundaries
        local_boundaries = self.dists2boundaries_3d(dists)  # [N, 1, R, R, R, D', H', W']

        # Step 2: Global boundary map from overlapping patches
        global_boundaries = self.local2global_3d(local_boundaries)  # [N, 1, D, H, W]

        # Step 3: Extract global patches at the same locations
        N, C, R, _, _, Dp, Hp, Wp = local_boundaries.shape
        extracted_global_patches = torch.zeros_like(local_boundaries)

        for dz in range(R):
            for dy in range(R):
                for dx in range(R):
                    extracted_global_patches[:, :, dz, dy, dx, :, :, :] = global_boundaries[
                        :, :, 
                        dz : dz + Dp * self.opts.stride : self.opts.stride,
                        dy : dy + Hp * self.opts.stride : self.opts.stride,
                        dx : dx + Wp * self.opts.stride : self.opts.stride
                    ]

        # Step 4: MSE consistency term
        consistency = (local_boundaries - extracted_global_patches) ** 2
        consistency = consistency.mean(dim=(2, 3, 4))  # average over R^3
        return consistency[:, 0, :, :, :]  # shape [N, D', H', W']



    def get_color_consistency_term_3d(self, dists, colors): 
        """
        Compute the color consistency loss term for 3D FoJ.

        Inputs
        ------
        dists   : Tensor of shape [N, 3, R, R, R, D', H', W'] with signed distances for each patch
        colors  : Tensor of shape [N, 3, D', H', W'] = color for each region in each patch

        Returns
        -------
        consistency : Tensor of shape [N, D', H', W'] with the color consistency loss at each patch
        """
        N, _, R, _, _, Dp, Hp, Wp = dists.shape
        device = dists.device
        curr_global_volume_patches = Unfold3d(self.opts.R, stride=self.opts.stride)(
                self.global_volume.detach()).view(1, self.C, self.opts.R, self.opts.R,self.opts.R, self.D_patches, self.H_patches, self.W_patches)
        #print ('curr_global_volume_patches size', curr_global_volume_patches.shape)
        # Compute soft indicators [N, 2, R, R, R, D', H', W']
        regions = self.dists2indicators_3d(dists)  # soft assignments to 2 regions

        # Expand colors and apply weighting by wedge masks
        # [N, 3, 1, 1, 1, 1, 1, 1] for broadcasting
        colors_exp = colors.unsqueeze(-4).unsqueeze(-4).unsqueeze(-4)
        #print ('colors_exp', colors_exp.shape)
        # Compute squared error between predicted region color and global value
        # Resulting shape: [N, 3, R, R, R, D', H', W']
        color_diff_sq = (colors_exp - curr_global_volume_patches.unsqueeze(2)) ** 2

        # Multiply squared diff by region masks (soft assignment)
        weighted_diff = regions.unsqueeze(1) * color_diff_sq  # shape [N, 3, R, R, R, D', H', W']

        # Mean over voxel dimensions R^3, sum over 3 regions
        consistency = weighted_diff.mean(-4).mean(-4).mean(-4).sum(1).sum(1)  # shape [N, D', H', W']

        return consistency


    
    
    def get_dists_and_patches_3d(self, params, lmbda_color=0.0): 
        """
        Compute distance functions and piecewise-constant patches given 3D FoJ junction parameters.

        Inputs
        ------
        params   : Tensor of shape [N, 9, D', H', W'].
                Each patch holds 9 FoJ parameters: 3*(theta, phi) + (x0, y0, z0)

        lmbda_color : float, regularization weight for global image

        Outputs
        -------
        dists   : Tensor of shape [N, 3, R, R, R, D', H', W']
        colors  : Tensor of shape [N, C, 3, D', H', W']
        patches : Tensor of shape [N, C, R, R, R, D', H', W']
        """

        # Compute signed distance maps (3 per patch)
        dists = self.params2dists_3d(params)  # [N, 3, R, R, R, D', H', W']

        # Get wedge indicator functions: soft masks for each of the 2 regions
        regions = self.dists2indicators_3d(dists)  # [N, 2, R, R, R, D', H', W']
        # print('regions shape:', regions.shape)
        # Compute region-wise optimal colors
        if lmbda_color >= 0 and self.global_volume is not None:
            # Extract global image patches [1, C, R, R, R, D', H', W']
            curr_global_volume_patches = Unfold3d(self.opts.R, stride=self.opts.stride)(
                self.global_volume.detach()).view(1, self.C, self.opts.R, self.opts.R,self.opts.R, self.D_patches, self.H_patches, self.W_patches)
            # Combine patch and global image contributions
            numerator = ((self.vol_patches + lmbda_color * curr_global_volume_patches).unsqueeze(2) * regions.unsqueeze(1)).sum(3).sum(3).sum(3)
            denominator = (1.0 + lmbda_color) * regions.sum(-4).sum(-4).sum(-4).unsqueeze(1)
            #print('numerator', numerator.shape)
            #print('denominator', denominator.shape)
            colors = numerator / (denominator + 1e-10)  # [N, C, 3, D', H', W']

        else:
            # Use only local patch information
            numerator = (self.vol_patches.unsqueeze(2) * regions.unsqueeze(1)).sum(3).sum(3).sum(3)
            denominator = regions .sum(-4).sum(-4).sum(-4).unsqueeze(1)
            #print('numerator', numerator.shape)
            #print('denominator', denominator.shape)
            colors = numerator / (denominator + 1e-10)  # [N, C, 2, D', H', W']
            #print('color', colors.shape)
        # Compose final patch: fill each region with its color
        patches = (regions.unsqueeze(1) * colors.unsqueeze(-4).unsqueeze(-4).unsqueeze(-4)).sum(dim=2)
        # Shape: [N, C, R, R, R, D', H', W']

        return dists, colors, patches


    def dists2boundaries_3d(self, dists):
        """
        Compute 3D boundary map for each patch, given distance functions for 3D FoJ.

        Inputs
        ------
        dists : Tensor of shape [N, 3, R, R, R, D', H', W']

        Returns
        -------
        boundaries : Tensor of shape [N, 1, R, R, R, D', H', W']
        """
        # Extract the 3 distance fields
        d1 = dists[:, 0:1, :, :, :, :, :, :]  # [N, 1, R, R, R, D', H', W']
        d2 = dists[:, 1:2, :, :, :, :, :, :]
        d3 = dists[:, 2:3, :, :, :, :, :, :]

        # Compute min of absolute distances
        #minabsdist = torch.min(torch.abs(torch.min(torch.stack([d1, d2, d3], dim=0), dim=0).values), dim=1, keepdim=True).values
        minabsdist = torch.min(torch.stack([d1.abs(), d2.abs(), d3.abs()], dim = 0), dim=0).values  # shape: [N, 1, R, R, R, D', H', W']

        # Apply the regularized derivative of Heaviside as in the paper:
        boundaries = 1.0 / (1.0 + (minabsdist / self.opts.delta) ** 2)

        return boundaries  # shape: [N, 1, R, R, R, D', H', W']


    def local2global_3d(self, patches): 
        """
        Compute the average value for each voxel over all patches that contain it (3D FoJ).

        Inputs
        ------
        patches : Tensor of shape [N, C, R, R, R, D', H', W']
                patches[n, :, :, :, :, i, j, k] is an RxRxR C-channel patch at (i, j, k)

        Returns
        -------
        global_volume : Tensor of shape [N, C, D, H, W]
                        average over all overlapping patches per voxel
        """

        N, C, R, _, _, Dp, Hp, Wp = patches.shape

        # Reshape to [N, C*R^3, D'*H'*W'] so we can use conv_transpose3d
        patches_reshaped = patches.view(N, C * self.opts.R**3, -1)
        #print('patch_reshpped size', patches_reshaped.shape)
        patches_reshaped_folded= Fold3d(output_size=[self.D, self.H, self.W],
                                         kernel_size=self.opts.R,
                                         stride=self.opts.stride, channels=C)(patches_reshaped).view(N, C, self.D, self.H, self.W)
        
        folded = patches_reshaped_folded/ self.num_patches.unsqueeze(0).unsqueeze(0)
        #print('folded size:', folded.shape)
        # Normalize using number of patches per voxel
        return folded 



    def get_best_inds_3d(self, params, lmbda_boundary, lmbda_color): 
        """
        Compute the best parameter index along dim=0 of `params` for each 3D patch location.

        Inputs
        ------
        params           : Tensor [N, P, D', H', W']
        lmbda_boundary   : Weight for boundary consistency
        lmbda_color      : Weight for color consistency

        Returns
        -------
        best_ind         : Tensor [D', H', W'] with best index (0 to N-1) for each patch
        """
        N, _, Dp, Hp, Wp = params.shape

        if self.opts.parallel_mode:
            # Evaluate loss for all parameter configurations in parallel
            dists, colors, smooth_patches = self.get_dists_and_patches_3d(params, lmbda_color)
            loss_per_patch = self.get_loss_3d(dists, colors, smooth_patches, lmbda_boundary, lmbda_color)  # [N, D', H', W']
            best_ind = loss_per_patch.argmin(dim=0)  # [D', H', W']

        else:
            # Sequential loop over N parameter samples
            best_ind = torch.zeros(Dp, Hp, Wp, dtype=torch.int64, device=dev)
            best_loss = torch.full((Dp, Hp, Wp), 1e10, dtype=torch.float32, device=dev)

            for n in range(N):
                dists, colors, smooth_patches = self.get_dists_and_patches_3d(params[n:n+1], lmbda_color)
                loss = self.get_loss_3d(dists, colors, smooth_patches, lmbda_boundary, lmbda_color)[0]  # [D', H', W']

                improved = loss < best_loss
                best_ind = torch.where(improved, torch.tensor(n, device=dev), best_ind)
                best_loss = torch.where(improved, loss, best_loss)

        return best_ind  # [D', H', W']


    def params2dists_3d(self, params, tau=1e-1): 
        """
        Compute three signed distance functions for 3D FoJ using three planes.

        Inputs
        ------
        params : Tensor of shape [N, 9, D', H', W'], where 9 = 3 * (2 angles + 1 center)
                Each patch has:
                - theta1, phi1
                - theta2, phi2
                - theta3, phi3
                - x0, y0, z0 (center)

        grid   : Tensor of shape [R, R, R, 3] = normalized 3D coordinate grid

        Returns
        -------
        dists  : Tensor of shape [N, 3, R, R, R, D', H', W']
                3 signed distances per patch
        """

        N, _, Dp, Hp, Wp = params.shape
        R =self.grid.shape[1]

        # Extract center coordinates (N, 1, 1, 1, D', H', W')
        x0 = params[:, -3].view(N, 1, 1, 1, Dp, Hp, Wp)
        y0 = params[:, -2].view(N, 1, 1, 1, Dp, Hp, Wp)
        z0 = params[:, -1].view(N, 1, 1, 1, Dp, Hp, Wp)

        # Extract grid coordinates and expand for broadcasting

        x = self.grid[..., 0].view(1, R, R, R, 1, 1, 1)
        y = self.grid[..., 1]
        z = self.grid[..., 2]
        #print ('x:', x.shape)

        dists = []

        for i in range(3):  # Loop over 3 planes
            theta = params[:, 2 * i + 0].view(N, 1, 1, 1, Dp, Hp, Wp)
            phi   = params[:, 2 * i + 1].view(N, 1, 1, 1, Dp, Hp, Wp)

            # Compute normal vector components
            nx = torch.sin(theta) * torch.cos(phi)
            ny = torch.sin(theta) * torch.sin(phi)
            nz = torch.cos(theta)

            # Signed distance: n · (x - x0)
            d = nx * (x - x0) + ny * (y - y0) + nz * (z - z0)
            d = d + tau  # add shift to prevent gradient flattening

            dists.append(d)

        stacked = torch.stack(dists, dim=1)
        #print("dists shape after stacking:", stacked.shape)
        return stacked  # (N, 3, R, R, R, D', H', W')



    def dists2indicators_3d(self, dists): 
        """
        Compute the 3D binary indicator functions u_in and u_out from the 3 signed distances.

        Inputs
        ------
        dists : Tensor of shape [N, 3, R, R, R, D', H', W']  (d1, d2, d3 for each patch)

        Returns
        -------
        indicators : Tensor of shape [N, 2, R, R, R, D', H', W']  (u_in, u_out)
        """
        h = 0.5 * (1.0 + (2.0 / np.pi) * torch.atan(dists / self.opts.eta))  # Smooth Heaviside

        # Region inside if all distances are positive
        u_in = h[:, 0] * h[:, 1] * h[:, 2]
        u_out = 1.0 - u_in

        stacked = torch.stack([u_in, u_out], dim=1)
        #print("indicator:", stacked.shape)
        return stacked # shape: (N, 2, R, R, R, D', H', W')

