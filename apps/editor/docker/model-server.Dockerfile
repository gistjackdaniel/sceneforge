# Model server for Kimodo and the photo avatar stages. See apps/editor/scripts/photo_avatar_setup.md.
# The repository and every runtime are bind mounts, so the image holds only the toolchain.
ARG CUDA_IMAGE=nvidia/cuda:12.8.1-devel-ubuntu22.04
FROM ${CUDA_IMAGE}
# CUDA_IMAGE can be another Ubuntu image with nvcc, so undo a non-root USER it may set.
USER root

ARG NODE_VERSION=22.12.0
ARG NODE_SHA256=22982235e1b71fa8850f82edd09cdae7e3f32df1764a9ec298c72d25ef2c164f
ARG MINIFORGE_VERSION=26.9.4-2
ARG MINIFORGE_SHA256=bbaf16b3897da24c4be50315934ba74848f617b4495982841d6a0a60e0edbbdf

RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates curl xz-utils git git-lfs build-essential ninja-build libgl1 libglib2.0-0 \
	&& rm -rf /var/lib/apt/lists/* \
	&& git lfs install --system

RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
	&& echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
	&& tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
	&& rm /tmp/node.tar.xz

RUN curl -fsSLo /tmp/miniforge.sh "https://github.com/conda-forge/miniforge/releases/download/${MINIFORGE_VERSION}/Miniforge3-${MINIFORGE_VERSION}-Linux-x86_64.sh" \
	&& echo "${MINIFORGE_SHA256}  /tmp/miniforge.sh" | sha256sum -c - \
	&& bash /tmp/miniforge.sh -b -p /opt/miniforge \
	&& rm /tmp/miniforge.sh

# The container runs as the host user, so every writable path sits in the /opt/runtimes mount.
# The editor passes its environment to each Python stage, so an empty PYTHONPATH keeps a base image's packages out.
ENV PATH=/opt/miniforge/bin:${PATH} \
	PYTHONPATH= \
	HOME=/opt/runtimes/home \
	HF_HOME=/opt/runtimes/huggingface \
	CONDA_PKGS_DIRS=/opt/runtimes/conda-pkgs \
	npm_config_cache=/opt/runtimes/npm-cache

WORKDIR /workspace/sceneforge/apps/editor
EXPOSE 4173
ENTRYPOINT []
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
