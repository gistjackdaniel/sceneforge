"""Run the local Pixal3D pipeline with a mesh budget for realtime morph playback."""

import argparse
import sys
import warnings
from pathlib import Path

BIREFNET_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"


def faces_facing_outside(mesh, pitch):
    """Mask of the faces to keep: those whose front opens onto air connected to the outside.

    Voxelize the surface at `pitch`, coarser than the gap between the shell's walls, and flood-fill the air from a
    corner of the grid. A face whose front looks into air the fill never reached faces the sealed cavity inside the
    shell. Parts too thin for the grid to hold a cavity, such as fingers, keep both walls.
    """
    import numpy as np
    from scipy import ndimage

    low = mesh.bounds[0] - 3 * pitch
    surface = np.zeros(np.ceil((mesh.bounds[1] + 3 * pitch - low) / pitch).astype(int) + 1, dtype=bool)
    corners = mesh.triangles
    longest = np.linalg.norm(corners - np.roll(corners, 1, axis=1), axis=2).max(axis=1)
    steps = np.clip(np.ceil(2 * longest / pitch).astype(int), 1, 64)
    for n in np.unique(steps):
        u, v = np.meshgrid(np.arange(n + 1), np.arange(n + 1))
        inside = u + v <= n
        a, b = (u[inside] / n)[:, None], (v[inside] / n)[:, None]
        rows = corners[steps == n]
        points = rows[:, None, 0] * (1 - a - b) + rows[:, None, 1] * a + rows[:, None, 2] * b
        surface[tuple(np.floor((points.reshape(-1, 3) - low) / pitch).astype(int).T)] = True
    labels, _ = ndimage.label(~surface)
    outside = labels == labels[0, 0, 0]
    ahead = tuple(np.floor((mesh.triangles_center + 1.5 * pitch * mesh.face_normals - low) / pitch).astype(int).T)
    return surface[ahead] | outside[ahead]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pixal-dir", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    from PIL import Image, ImageOps

    warnings.simplefilter("error", Image.DecompressionBombWarning)
    image_path = args.output.with_name("condition.png")
    with Image.open(args.image) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        alpha = "A" in image.getbands() or "transparency" in image.info
        image = image.convert("RGBA" if alpha else "RGB")
        image.info.clear()
        image.save(image_path)

    sys.path.insert(0, str(args.pixal_dir))
    import inference
    import numpy as np
    import torch
    from huggingface_hub import snapshot_download
    from pixal3d.pipelines import rembg

    # Pixal3D's pipeline.json names briaai/RMBG-2.0, a gated CC BY-NC model.
    # Load the MIT BiRefNet weights through the same class instead. The repo
    # ships model code that runs with trust_remote_code, so pin its revision.
    class OpenBiRefNet(rembg.BiRefNet):
        def __init__(self, model_name=None):
            super().__init__(snapshot_download("ZhengPeng7/BiRefNet", revision=BIREFNET_REVISION))

    rembg.BiRefNet = OpenBiRefNet

    # The texture stage upsamples 1024-channel DINOv3 features to 1024x1024
    # with NAF, about 4 GiB per fp32 tensor, and filled a 16 GB RTX 5080.
    # Below 20 GiB, upsample to 512 like the shape stages do.
    if torch.cuda.get_device_properties(0).total_memory < 20 * 1024**3:
        inference.IMAGE_COND_CONFIGS["tex_1024"]["naf_target_size"] = 512

    # Pixal3D uses a fixed 1M-face export. Limit its native o_voxel exporter
    # before meshing so UVs and PBR maps are baked at the editor's mesh budget.
    postprocess = inference.o_voxel.postprocess
    to_glb = postprocess.to_glb

    def export_editor_mesh(*positional, **options):
        options.update(decimation_target=60_000, texture_size=2048)
        mesh = to_glb(*positional, **options)
        # Pixal3D remeshes a narrow band around the surface, which returns a
        # closed shell with an outer and an inner wall about three grid cells
        # apart. The inner wall faces the bones, so the rig stage could not tell
        # arm skin from torso skin where they touch. Drop it.
        aabb = torch.as_tensor(options["aabb"], dtype=torch.float64)
        cell = float((aabb[1] - aabb[0]).max()) / float(torch.as_tensor(options["grid_size"]).max())
        normals = mesh.vertex_normals
        mesh.update_faces(faces_facing_outside(mesh, 4 * cell))
        referenced = np.zeros(len(mesh.vertices), dtype=bool)
        referenced[mesh.faces] = True
        mesh.update_vertices(referenced)
        # Keep to_glb's normals, which it computed before splitting UV seams.
        mesh.vertex_normals = normals[referenced]
        # After inference's own axis swap the subject faces -Z, while Mixamo
        # rigs and the editor's actors face +Z. Turn it 180 degrees about
        # Pixal3D's vertical axis, which that swap maps to glTF +Y.
        mesh.apply_transform(np.diag([-1.0, -1.0, 1.0, 1.0]))
        # The editor frames actors and places joint handles from an origin
        # between the feet. The swap sends this mesh's +Z to glTF -Y, so the
        # feet lie at its largest Z.
        low, high = mesh.bounds
        mesh.apply_translation([-(low[0] + high[0]) / 2, -(low[1] + high[1]) / 2, -high[2]])
        return mesh

    postprocess.to_glb = export_editor_mesh
    try:
        inference.run_inference(
            image_path=str(image_path), output_path=str(args.output),
            low_vram=True, resolution=1024,
        )
    finally:
        postprocess.to_glb = to_glb


if __name__ == "__main__":
    main()
