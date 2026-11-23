"""Run the local Pixal3D pipeline with a mesh budget for realtime morph playback."""

import argparse
import sys
import warnings
from pathlib import Path


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

    # Pixal3D uses a fixed 1M-face export. Limit its native o_voxel exporter
    # before meshing so UVs and PBR maps are baked at the editor's mesh budget.
    postprocess = inference.o_voxel.postprocess
    to_glb = postprocess.to_glb

    def export_editor_mesh(*positional, **options):
        options.update(decimation_target=60_000, texture_size=2048)
        return to_glb(*positional, **options)

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
