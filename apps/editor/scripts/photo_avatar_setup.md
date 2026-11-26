# Local Photo to 3D setup

The editor starts two local Python processes. Pixal3D creates the textured mesh from the photo. Make-It-Animatable skins it with a Mixamo bone hierarchy. The rig stage then fits the ICT-FaceKit expression template to the reconstructed face and writes the rigged GLB with the three.ws rig library. The resulting GLB retains the mesh's PBR maps and can be driven with Kimodo body motion and webcam expression weights.

## Prepare the runtimes

1. Run the editor and both Python environments on the same machine. Use Linux or WSL2 with a CUDA-capable NVIDIA GPU for Pixal3D. Pixal3D reports about 10–12 GB of VRAM peak usage for low-VRAM inference. Its TRELLIS.2 dependency maintains its own OS and CUDA support matrix. [Pixal3D](https://github.com/TencentARC/Pixal3D#installation) · [TRELLIS.2](https://github.com/microsoft/TRELLIS.2#-installation)
2. Set up a Python environment for Pixal3D using its TRELLIS.2, `requirements.txt`, NATTEN and utils3d installation steps. Clone Pixal3D's TRELLIS.2-based default branch. Install MoGe at `b942f00bdc2a2a23ebb474fbe034d487e6dcceec`, because MoGe 3.0 requires a newer trimesh than Pixal3D pins. The editor runs Hugging Face components from their local cache, so run the editor's mesh stage once with network access to populate it: `ATTN_BACKEND=sdpa python apps/editor/scripts/photo_avatar_mesh.py --pixal-dir /path/to/Pixal3D --image photo.png --output /tmp/mesh.glb`. The mesh stage removes the background with the MIT [BiRefNet](https://huggingface.co/ZhengPeng7/BiRefNet) weights instead of the gated, non-commercial RMBG-2.0 model that Pixal3D's `pipeline.json` names.
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

## Windows with WSL2

Keep the editor on Windows and build both Python environments inside a WSL2 distribution. Write the six paths as `//wsl.localhost/<distro>/...`. The editor starts a Python found under that share through `wsl.exe` and passes its stage settings through `WSLENV`. Create both virtual environments with `python -m venv --copies`, because Windows cannot follow the symlinks that a default venv uses for its interpreter.

RTX 50-series GPUs (sm_120) need PyTorch built for CUDA 12.8 or newer in the Pixal3D environment, for example `torch==2.7.1` from the `cu128` index. Build its CUDA extensions with `TORCH_CUDA_ARCH_LIST=12.0` and `NATTEN_CUDA_ARCH=12.0`. With about 32 GB of RAM in WSL, set `MAX_JOBS=4`, because the o-voxel build runs out of memory at higher parallelism. The rig worker's PyTorch 2.1.2 has no sm_120 kernels, so set `PHOTO_AVATAR_RIG_CPU=1` on these GPUs.

Use a straight-on full-body photo with the head, hands, and feet visible and the limbs clear of the torso. Where an arm rests against the body, the reconstruction joins the two surfaces. The rig stage gives each side its own weights and removes the triangles that still join them, which can leave small holes there. The model estimates geometry for surfaces hidden by the input view. Expression quality depends on the reconstructed head and its match to the face template. A local inference job uses temporary files, removed when the job exits. The editor receives a GLB of up to 64 MB.

Pixal3D code and checkpoints are MIT. Make-It-Animatable code is MIT and the checkpoint repository is Apache-2.0. The three.ws library is Apache-2.0 and ICT-FaceKit Light is MIT. The models and source assets that these projects depend on retain their own terms, including Mixamo's gated files. [Pixal3D notice](https://github.com/TencentARC/Pixal3D/blob/master/NOTICE) · [Make-It-Animatable weights](https://huggingface.co/jasongzy/Make-It-Animatable) · [three.ws license](https://github.com/nirholas/three.ws/blob/main/LICENSE)
