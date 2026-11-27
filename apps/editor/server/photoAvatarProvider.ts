import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const imageExtensions = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
} as const;

const maxGlbBytes = 64 * 1024 * 1024;
const generationTimeoutMs = 20 * 60 * 1000;

export type PhotoAvatarImageMime = keyof typeof imageExtensions;

export interface PhotoAvatarProvider {
  generate(image: Buffer, mime: PhotoAvatarImageMime, signal: AbortSignal): Promise<Buffer>;
}

function configuredFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// A Python inside WSL is configured by its \\wsl.localhost\<distro>\ path and started through wsl.exe.
const wslShare = /^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)(.*)$/i;

function insideWsl(path: string): string {
  const share = wslShare.exec(path);
  if (share) return share[2].replace(/\\/g, '/') || '/';
  const drive = /^([a-z]):[\\/](.*)$/i.exec(path);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}` : path;
}

/** The command that runs `python` with `args` in `cwd`, through wsl.exe when the Python lives in a WSL share. */
export function wslInvocation(python: string, args: string[], cwd: string): { command: string; argv: string[]; inWsl: boolean } {
  const distro = wslShare.exec(python)?.[1];
  return distro
    ? { command: 'wsl.exe', argv: ['-d', distro, '--cd', insideWsl(cwd), '--exec', insideWsl(python), ...args.map(insideWsl)], inWsl: true }
    : { command: python, argv: args, inWsl: false };
}

function runStage(
  stage: string,
  python: string,
  args: string[],
  cwd: string,
  workDir: string,
  signal: AbortSignal,
  device?: string,
): Promise<void> {
  signal.throwIfAborted();
  const stageEnv = {
    ...(device === undefined ? {} : { CUDA_VISIBLE_DEVICES: device }),
    ATTN_BACKEND: process.env.ATTN_BACKEND ?? 'sdpa',
    DO_NOT_TRACK: '1',
    GRADIO_ANALYTICS_ENABLED: 'False',
    HF_HUB_DISABLE_TELEMETRY: '1',
    HF_HUB_OFFLINE: '1',
    MPLBACKEND: 'Agg',
    PYTHONDONTWRITEBYTECODE: '1',
    TRANSFORMERS_OFFLINE: '1',
  };
  const wslEnv = [process.env.WSLENV, ...Object.keys(stageEnv), 'TMPDIR/p'].filter(Boolean).join(':');
  const { command, argv, inWsl } = wslInvocation(python, args, cwd);
  return new Promise((resolveStage, reject) => {
    const child = spawn(command, argv, {
      cwd: inWsl ? undefined : cwd,
      env: {
        ...process.env,
        ...stageEnv,
        ...(inWsl ? { WSLENV: wslEnv } : {}),
        TEMP: workDir,
        TMP: workDir,
        TMPDIR: workDir,
      },
      signal,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });

    let stderrTail = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-4_096);
    });

    let spawnError: Error | undefined;
    child.on('error', (error) => { spawnError = error; });
    child.on('close', (code) => {
      if (signal.aborted) {
        reject(signal.reason);
      } else if (code === 0 && !spawnError) {
        resolveStage();
      } else {
        const lines = stderrTail.trim().split(/\r?\n/);
        const detail = lines[lines.length - 1] || spawnError?.message;
        if (detail) console.error(`[photo avatar] ${stage}: ${detail.split(workDir).join('[job]').split(insideWsl(workDir)).join('[job]')}`);
        reject(new Error(`${stage} failed. See the editor server log.`));
      }
    });
  });
}

async function readGeneratedGlb(path: string): Promise<Buffer> {
  const file = await stat(path).catch(() => undefined);
  if (!file?.isFile() || file.size < 20 || file.size > maxGlbBytes) {
    throw new Error('The generated avatar is missing or exceeds the 64 MB GLB size limit.');
  }

  const bytes = await readFile(path).catch(() => undefined);
  if (!bytes || bytes.length < 20) throw new Error('The generated avatar GLB could not be read.');
  if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error('The generator did not produce a valid GLB container.');
  }
  return bytes;
}

/** Configures local subprocesses from the paths documented in photo_avatar_setup.md. */
export function photoAvatarProvider(
  editorRoot: string,
  env: Record<string, string | undefined>,
): PhotoAvatarProvider | undefined {
  const pixalDir = env.PHOTO_AVATAR_PIXAL3D_DIR?.trim();
  const pixalPython = env.PHOTO_AVATAR_PIXAL3D_PYTHON?.trim();
  const workerDir = env.PHOTO_AVATAR_RIG_WORKER_DIR?.trim();
  const rigPython = env.PHOTO_AVATAR_RIG_PYTHON?.trim();
  const miaDir = env.PHOTO_AVATAR_MIA_DIR?.trim();
  const template = env.PHOTO_AVATAR_ARKIT_TEMPLATE?.trim();
  if (!pixalDir || !pixalPython || !workerDir || !rigPython || !miaDir || !template) return undefined;

  const pixalRoot = resolve(editorRoot, pixalDir);
  const pixalExecutable = resolve(editorRoot, pixalPython);
  const rigRoot = resolve(editorRoot, workerDir);
  const rigExecutable = resolve(editorRoot, rigPython);
  const miaRoot = resolve(editorRoot, miaDir);
  const faceTemplate = resolve(editorRoot, template);
  const meshScript = join(editorRoot, 'scripts', 'photo_avatar_mesh.py');
  const rigScript = join(editorRoot, 'scripts', 'photo_avatar_rig.py');
  const rigDevice = env.PHOTO_AVATAR_RIG_CPU === '1' ? '-1' : undefined;

  const requiredFiles = [
    pixalExecutable, rigExecutable, faceTemplate, meshScript, rigScript,
    join(pixalRoot, 'inference.py'), join(miaRoot, 'app.py'),
    join(rigRoot, 'engine_mia.py'), join(rigRoot, 'rig_glb.py'), join(rigRoot, 'blendshapes.py'),
  ];
  if (!requiredFiles.every(configuredFile)) return undefined;

  let active = false;
  return {
    async generate(image, mime, callerSignal) {
      if (active) throw new Error('The local photo avatar generator is already running.');
      callerSignal.throwIfAborted();
      active = true;
      let workDir: string | undefined;
      try {
        const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(generationTimeoutMs)]);
        workDir = await mkdtemp(join(tmpdir(), 'sceneforge-photo-avatar-'));
        const photo = join(workDir, `photo${imageExtensions[mime]}`);
        const baseMesh = join(workDir, 'mesh.glb');
        const avatar = join(workDir, 'avatar.glb');
        await writeFile(photo, image, { mode: 0o600, signal });

        await runStage('Pixal3D mesh generation', pixalExecutable, [
          meshScript, '--pixal-dir', pixalRoot, '--image', photo, '--output', baseMesh,
        ], pixalRoot, workDir, signal);
        await runStage('Make-It-Animatable body and face rigging', rigExecutable, [
          rigScript, '--worker-dir', rigRoot, '--mia-dir', miaRoot, '--template', faceTemplate,
          '--mesh', baseMesh, '--output', avatar,
        ], miaRoot, workDir, signal, rigDevice);

        const bytes = await readGeneratedGlb(avatar);
        signal.throwIfAborted();
        return bytes;
      } finally {
        try {
          if (workDir) await rm(workDir, { recursive: true, force: true, maxRetries: 3 });
        } finally {
          active = false;
        }
      }
    },
  };
}
