"""Run the local Pixal3D pipeline with a mesh budget for realtime morph playback."""

import argparse
import sys
import warnings
from pathlib import Path

BIREFNET_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"


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
        # After inference's own axis swap the subject faces -Z, while Mixamo
        # rigs and the editor's actors face +Z. Turn it 180 degrees about
        # Pixal3D's vertical axis, which that swap maps to glTF +Y.
        mesh.apply_transform(np.diag([-1.0, -1.0, 1.0, 1.0]))
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
