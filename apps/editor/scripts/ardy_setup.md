# ARDY live steering setup

The **실시간 조종 (ARDY)** button on the Kimodo timeline streams motion from [NVIDIA ARDY](https://github.com/nv-tlabs/ardy) for the selected actor. While it runs, ↑ and ↓ change the actor's speed and ← and → turn it 30°. **샷에 저장하고 끝내기** saves the most recent motion that fits between the start frame and the end of the shot, up to 10 seconds, as a clip on the actor's motion track.

The editor starts `ardy_server.py` with the Python that `ARDY_PYTHON` names. ARDY always runs on the editor's machine, even when `MODEL_SERVER_URL` sends Kimodo and photo avatar jobs elsewhere. It sends requests to that process over standard input and output. The 15 GB LLM2Vec Llama 3 text encoder runs on the CPU, so the process exits when steering ends or two minutes after the last request. Loading the encoder takes about a minute and a half on the first start. On an RTX 5080 under WSL2, steering used about 1.3 GB of GPU memory, so Kimodo and Pixal3D can run at the same time. Each 2-second replan took 0.13–0.21 s.

## Install

1. Use Linux or WSL2 with an NVIDIA GPU. Clone ARDY and check out the revision that the editor was tested with:

	```sh
	git clone https://github.com/nv-tlabs/ardy.git
	git -C ardy checkout e706e27acc88070918308a10922b8f7174d0825e
	```

2. Create a Python 3.11 environment, then install PyTorch and ARDY. Use `--copies` so that `wsl.exe` can start the interpreter from Windows. The CUDA 12.8 wheel also supports RTX 50-series GPUs.

	```sh
	python3.11 -m venv --copies ~/envs/ardy
	~/envs/ardy/bin/pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cu128
	~/envs/ardy/bin/pip install setuptools wheel cmake
	~/envs/ardy/bin/pip install --no-build-isolation -e ardy
	```

3. ARDY reads its checkpoint and the text encoder from `~/hf-cache/hub`, or from `HF_HUB_CACHE` when it is set. The editor runs ARDY offline. Fill the cache once with network access, using a Hugging Face token that has access to [Meta Llama 3 8B Instruct](https://huggingface.co/meta-llama/Meta-Llama-3-8B-Instruct):

	```sh
	echo '{"id": 1, "type": "start", "prompt": "A person walks."}' | HF_TOKEN=<token> ~/envs/ardy/bin/python apps/editor/scripts/ardy_server.py > /dev/null
	```

	If Kimodo already downloaded the text encoder on Windows, link its three model folders instead of downloading them again: `models--meta-llama--Meta-Llama-3-8B-Instruct`, `models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp` and `models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised`. Create each link from `~/hf-cache/hub/<folder>` to `/mnt/c/Users/<user>/.cache/huggingface/hub/<folder>`.

4. Add the Python path to `.env.local` at the repository root, and restart the editor. If the editor runs on Windows and ARDY is in WSL, use the `\\wsl.localhost\` path. The editor then starts ARDY through `wsl.exe`.

	```dotenv
	ARDY_PYTHON=//wsl.localhost/Ubuntu-24.04/home/<user>/envs/ardy/bin/python
	```

ARDY's code is licensed under Apache-2.0. Its checkpoint is covered by the [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement), and the text encoder by the Meta Llama 3 Community License.
