# Local Photo to 3D setup

The editor starts two local Python processes. Pixal3D creates the textured mesh from the photo. Make-It-Animatable skins it with a Mixamo bone hierarchy, and the three.ws rig library transfers ICT-FaceKit expressions onto the head. The resulting GLB retains the mesh's PBR maps and can be driven with Kimodo body motion and webcam expression weights.

## Prepare the runtimes

1. Run the editor and both Python environments on the same machine. Use Linux or WSL2 with a CUDA-capable NVIDIA GPU for Pixal3D. Pixal3D reports about 10–12 GB of VRAM peak usage for low-VRAM inference. Its TRELLIS.2 dependency maintains its own OS and CUDA support matrix. [Pixal3D](https://github.com/TencentARC/Pixal3D#installation) · [TRELLIS.2](https://github.com/microsoft/TRELLIS.2#-installation)
2. Set up a Python environment for Pixal3D using its TRELLIS.2, `requirements.txt`, NATTEN and utils3d installation steps. Clone Pixal3D's TRELLIS.2-based default branch. Run the official example once from the Pixal3D checkout with `ATTN_BACKEND=sdpa python inference.py --image assets/images/0_img.png --output /tmp/pixal3d-check.glb --low_vram` to verify CUDA and populate the model caches for the editor's user account. The editor runs Hugging Face components from their local cache.
3. Create a separate Python 3.11 environment for the three.ws rig worker. Use the PyTorch and Python dependency versions in the worker Dockerfile and requirements file as the reference. If the rig's PyTorch wheel lacks CUDA support for your GPU, set `PHOTO_AVATAR_RIG_CPU=1` to run the rig stage on CPU. [Rig runtime](https://github.com/nirholas/three.ws/blob/main/workers/rig/Dockerfile) · [Rig dependencies](https://github.com/nirholas/three.ws/blob/main/workers/rig/requirements.txt)
4. Clone Make-It-Animatable and check out `d60cc7e01ff8da46448e458dbf450e8967b34e77`, the revision used by the three.ws worker. Copy `output/best/new` and `data` from the Hugging Face model repository with their real Git LFS contents. After accepting access conditions for the Hugging Face Mixamo dataset, download `bones.fbx` and `bones_vroid.fbx` into `data/Mixamo/` within the Make-It-Animatable checkout. [Source](https://github.com/jasongzy/Make-It-Animatable) · [Weights and demo data](https://huggingface.co/jasongzy/Make-It-Animatable/tree/main) · [Mixamo files](https://huggingface.co/datasets/jasongzy/Mixamo)
5. Clone ICT-FaceKit and bake the face template with the rig environment's Python using `python /path/to/three.ws/workers/rig/build_arkit_template.py --facekit /path/to/ICT-FaceKit --out /path/to/arkit_template.npz`. [ICT-FaceKit](https://github.com/USC-ICT/ICT-FaceKit) · [Template script](https://github.com/nirholas/three.ws/blob/main/workers/rig/build_arkit_template.py)

Add the following settings to `.env.local` at the repository root, next to the Kimodo settings, and start the editor normally. All six paths are required and can be absolute or relative to `apps/editor`.

```dotenv
PHOTO_AVATAR_PIXAL3D_DIR=/path/to/Pixal3D
PHOTO_AVATAR_PIXAL3D_PYTHON=/path/to/pixal-env/bin/python
PHOTO_AVATAR_RIG_WORKER_DIR=/path/to/three.ws/workers/rig
PHOTO_AVATAR_RIG_PYTHON=/path/to/rig-env/bin/python
PHOTO_AVATAR_MIA_DIR=/path/to/Make-It-Animatable
PHOTO_AVATAR_ARKIT_TEMPLATE=/path/to/arkit_template.npz
```

Use a straight-on full-body photo with the head, hands, and feet visible and the limbs clear of the torso. The model estimates geometry for surfaces hidden by the input view. Expression quality depends on the reconstructed head and its match to the face template. A local inference job uses temporary files, removed when the job exits. The editor receives a GLB of up to 64 MB.

Pixal3D code and checkpoints are MIT. Make-It-Animatable code is MIT and the checkpoint repository is Apache-2.0. The three.ws library is Apache-2.0 and ICT-FaceKit Light is MIT. The models and source assets that these projects depend on retain their own terms, including Mixamo's gated files. [Pixal3D notice](https://github.com/TencentARC/Pixal3D/blob/master/NOTICE) · [Make-It-Animatable weights](https://huggingface.co/jasongzy/Make-It-Animatable) · [three.ws license](https://github.com/nirholas/three.ws/blob/main/LICENSE)
