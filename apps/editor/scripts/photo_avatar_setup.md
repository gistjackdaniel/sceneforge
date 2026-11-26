# Local Photo to 3D setup

The editor starts two local Python processes. Pixal3D creates the textured mesh from the photo. Make-It-Animatable skins it with a Mixamo bone hierarchy. The rig stage then fits the ICT-FaceKit expression template to the reconstructed face and writes the rigged GLB with the three.ws rig library. The resulting GLB retains the mesh's PBR maps and can be driven with Kimodo body motion and webcam expression weights.

## Prepare the runtimes

1. Run the editor and both Python environments on the same machine, or see [Run the models on another machine](#run-the-models-on-another-machine). Use Linux or WSL2 with a CUDA-capable NVIDIA GPU for Pixal3D. Pixal3D reports about 10–12 GB of VRAM peak usage for low-VRAM inference. Its TRELLIS.2 dependency maintains its own OS and CUDA support matrix. [Pixal3D](https://github.com/TencentARC/Pixal3D#installation) · [TRELLIS.2](https://github.com/microsoft/TRELLIS.2#-installation)
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

## Run the models on another machine

Keep the editor on this machine and run Kimodo and the photo avatar stages on a GPU machine. Clone this repository on the GPU machine, and put the Kimodo settings and the six `PHOTO_AVATAR_*` paths in its own `.env.local`. Don't set `MODEL_SERVER_URL` there. Start its editor in `apps/editor` with `npm run dev -- --host 127.0.0.1`. The flag binds the IPv4 address that the tunnel connects to, because `localhost` can resolve to `::1` on Linux.

Forward a local port to it over SSH and leave the command running. A photo avatar job sends no data for up to 20 minutes, so the keepalive option stops an idle network link from closing the tunnel.

```sh
ssh -N -o ServerAliveInterval=30 -L 4180:127.0.0.1:4173 <lab-host>
```

Then add this line to `.env.local` on this machine and restart the editor:

```dotenv
MODEL_SERVER_URL=http://127.0.0.1:4180
```

The local editor forwards photo avatar requests and Kimodo generation to that address. It copies each generated Kimodo clip into its local `.local/poses/clips` cache after checking the clip's hash, so saved shots still load while the tunnel is down. While the tunnel is down, new generation requests fail with a message to check the SSH tunnel.

### Run the model server in Docker

Use these steps when the GPU machine runs every job in a Docker container. The container holds Node, the editor, and the Python environments, because the editor starts each Python stage by its path. The image holds only the toolchain. The repository and the runtimes are bind mounts:

- `~/sceneforge` on the host is `/workspace/sceneforge` in the container.
- `~/sceneforge-runtimes` on the host is `/opt/runtimes` in the container. It holds the checkouts, the conda environments, the Hugging Face cache, the Kimodo checkpoints, and the container's home folder.

The container runs as your host user, so every file it writes stays yours. The steps assume an x86_64 host, and `<gpu>` is the index of the GPU that you may use.

1. Install Docker and the NVIDIA Container Toolkit on the host. [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
2. Run `nvidia-smi` on the host and read **CUDA Version**. The default image uses CUDA 12.8, which needs driver 570 or newer. RTX 50-series GPUs need CUDA 12.8. With an older driver, add `--build-arg CUDA_IMAGE=nvidia/cuda:12.4.1-devel-ubuntu22.04` to the build command, or pick another `-devel-ubuntu22.04` tag that the driver supports. To build on an image that you already use on the machine, pass its name as `CUDA_IMAGE`. That image needs `apt-get` and `nvcc`, and the build leaves it unchanged.
3. Clone this repository to `~/sceneforge`, and create the runtime folder:

	```sh
	mkdir -p ~/sceneforge-runtimes/home
	```

4. Build the image from the repository root:

	```sh
	docker build -f apps/editor/docker/model-server.Dockerfile -t sceneforge-models apps/editor/docker
	```

5. Open a shell in a one-time setup container:

	```sh
	docker run --rm -it --gpus '"device=<gpu>"' --user "$(id -u):$(id -g)" \
		-v "$HOME/sceneforge:/workspace/sceneforge" -v "$HOME/sceneforge-runtimes:/opt/runtimes" \
		sceneforge-models bash
	```

6. In that shell, install the editor packages with `npm ci`. The shell starts in `/workspace/sceneforge/apps/editor`.
7. Create one conda environment for each Python stage. Use Python 3.11 for the rig environment. For Pixal3D and Kimodo, use the Python version that the TRELLIS.2 and Kimodo install guides name. [Kimodo install](https://research.nvidia.com/labs/sil/projects/kimodo/docs/getting_started/quick_start.html)

	```sh
	conda create -y -p /opt/runtimes/envs/rig python=3.11
	conda create -y -p /opt/runtimes/envs/pixal3d python=<version>
	conda create -y -p /opt/runtimes/envs/kimodo python=<version>
	```

8. Activate an environment with `source /opt/miniforge/bin/activate /opt/runtimes/envs/<name>` before you install its packages. Install Kimodo in `/opt/runtimes/envs/kimodo`.
9. Follow steps 2 through 5 of [Prepare the runtimes](#prepare-the-runtimes). Put each checkout and `arkit_template.npz` under `/opt/runtimes`. Skip the WSL2 setup. On RTX 50-series GPUs, still apply its CUDA 12.8 build settings and `PHOTO_AVATAR_RIG_CPU=1`.
10. Leave the setup shell with `exit`.

Write `.env.local` at the repository root on the host. Use the paths that the container sees, and don't set `MODEL_SERVER_URL`:

```dotenv
KIMODO_PYTHON=/opt/runtimes/envs/kimodo/bin/python
CHECKPOINT_DIR=/opt/runtimes/kimodo-checkpoints
TEXT_ENCODER_DEVICE=cpu
HF_TOKEN=<token>
PHOTO_AVATAR_PIXAL3D_DIR=/opt/runtimes/Pixal3D
PHOTO_AVATAR_PIXAL3D_PYTHON=/opt/runtimes/envs/pixal3d/bin/python
PHOTO_AVATAR_RIG_WORKER_DIR=/opt/runtimes/three.ws/workers/rig
PHOTO_AVATAR_RIG_PYTHON=/opt/runtimes/envs/rig/bin/python
PHOTO_AVATAR_MIA_DIR=/opt/runtimes/Make-It-Animatable
PHOTO_AVATAR_ARKIT_TEMPLATE=/opt/runtimes/arkit_template.npz
```

Start the model server in the background. In the container the editor listens on all interfaces. The `-p` flag publishes it only on the host's loopback address, which is the address that the SSH tunnel above connects to.

```sh
docker run -d --name sceneforge-models --restart unless-stopped --gpus '"device=<gpu>"' --user "$(id -u):$(id -g)" \
	-p 127.0.0.1:4173:4173 \
	-v "$HOME/sceneforge:/workspace/sceneforge" -v "$HOME/sceneforge-runtimes:/opt/runtimes" \
	sceneforge-models
```

Check that the container sees the GPU, and that the editor finds all six photo avatar paths:

```sh
docker exec sceneforge-models nvidia-smi
curl -s http://127.0.0.1:4173/api/photo-avatar
```

The second command prints `{"available":true}` when the six paths resolve. If it prints `{"available":false}`, check each path with `docker exec sceneforge-models ls <path>`. Restart the container with `docker restart sceneforge-models` after you change `.env.local`. Then connect from this machine with the tunnel and the `MODEL_SERVER_URL` line above.

To update the model server, run these commands on the host in `~/sceneforge`:

```sh
git pull --ff-only
docker restart sceneforge-models
```

When `apps/editor/package-lock.json` changed, reinstall the packages while the server is stopped. `npm ci` deletes `node_modules` first, so a running editor can crash during the install and restart into a half-installed folder.

```sh
docker stop sceneforge-models
docker run --rm --user "$(id -u):$(id -g)" \
	-v "$HOME/sceneforge:/workspace/sceneforge" -v "$HOME/sceneforge-runtimes:/opt/runtimes" \
	sceneforge-models npm ci
docker start sceneforge-models
```
