import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const output = resolve(process.env.SCENEFORGE_EVIDENCE_DIR || fileURLToPath(new URL("../../../artifacts/phase1", import.meta.url)));
const capture = resolve(process.env.SCENEFORGE_CAPTURE_DIR || fileURLToPath(new URL("../../../.local/phase1-video", import.meta.url)));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const report = JSON.parse(readFileSync(resolve(output, "verification.json"), "utf8"));
assert(report.cameraTakeUnchanged && report.backgroundSha256Unchanged && report.actorARawRootFramesUnchanged && report.actorBSkeletonChangedAtFrame === 45);
const title = (start, end, style, x, y, text) => `Dialogue: 0,0:00:${start},0:00:${end},${style},,0,0,0,,{\\an7\\pos(${x},${y})}${text}`;
const captions = [
  title("00.00", "03.50", "Title", 60, 26, "SceneForge  /  Phase 1"),
  title("00.00", "03.50", "Body", 60, 1003, "교실 씬에 액터 A와 B의 Kimodo 전신 모션을 적용했습니다."),
  title("03.50", "10.00", "Title", 58, 38, "B의 행동 편집"),
  title("03.50", "10.00", "Body", 58, 109, "편집 전   ·   손 흔들기"),
  title("03.50", "10.00", "Body", 990, 109, "편집 후   ·   고개 숙여 인사"),
  title("03.50", "07.50", "Small", 58, 753, "같은 프레임을 나란히 재생합니다. A는 청록색, B는 주황색입니다."),
  title("07.50", "10.00", "Body", 58, 753, "45번째 프레임   /   01.50초"),
  title("10.00", "15.00", "Title", 60, 26, "3D 씬 상태 비교"),
  title("10.00", "15.00", "Body", 60, 982, `카메라 테이크  ·  교실 GLB 버전  ·  A의 원본 루트 ${report.actorARawRootFramesUnchanged}프레임이 일치합니다.`),
  title("10.00", "15.00", "Small", 60, 1033, `샷에서 평가한 A의 루트 ${report.actorAEvaluatedFramesUnchanged}프레임도 모두 일치합니다.`),
];
writeFileSync(resolve(capture, "captions.ass"), `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Malgun Gothic,43,&H00F5F9F4,&H00FFFFFF,&H000D1411,&H000D1411,-1,0,0,0,100,100,0,0,1,1.5,0,7,0,0,0,1
Style: Body,Malgun Gothic,31,&H00E2F3E8,&H00FFFFFF,&H000D1411,&H000D1411,0,0,0,0,100,100,0,0,1,1.2,0,7,0,0,0,1
Style: Small,Malgun Gothic,24,&H00B8D7C3,&H00FFFFFF,&H000D1411,&H000D1411,0,0,0,0,100,100,0,0,1,1,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${captions.join("\n")}
`, "utf8");

const background = "0x101714";
const panel = "scale=1800:890:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:85";
const side = "scale=904:512:force_original_aspect_ratio=decrease,pad=914:528:(ow-iw)/2:(oh-ih)/2";
const pair = `hstack,pad=1920:1080:46:180:${background}`;
const args = [
  "-hide_banner", "-loglevel", "warning", "-y",
  "-loop", "1", "-framerate", "24", "-t", "3.5", "-i", resolve(output, "before.png"),
  "-framerate", "8", "-i", "before-frames/%03d.jpg",
  "-framerate", "8", "-i", "after-frames/%03d.jpg",
  "-loop", "1", "-framerate", "24", "-t", "2.5", "-i", "before-frames/012.jpg",
  "-loop", "1", "-framerate", "24", "-t", "2.5", "-i", "after-frames/012.jpg",
  "-loop", "1", "-framerate", "24", "-t", "5", "-i", resolve(output, "after.png"),
  "-filter_complex", [
    `[0:v]${panel}:${background},format=yuv420p,setsar=1[intro]`,
    `[1:v]${side}:${background},fps=24,format=yuv420p[left]`,
    `[2:v]${side}:${background},fps=24,format=yuv420p[right]`,
    `[left][right]${pair},setsar=1[play]`,
    `[3:v]${side}:${background},format=yuv420p[stillLeft]`,
    `[4:v]${side}:${background},format=yuv420p[stillRight]`,
    `[stillLeft][stillRight]${pair},setsar=1[still]`,
    `[5:v]${panel}:${background},format=yuv420p,setsar=1[outro]`,
    "[intro][play][still][outro]concat=n=4:v=1:a=0,ass=captions.ass[out]",
  ].join(";"),
  "-map", "[out]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart",
  resolve(output, "SceneForge-Phase-1.mp4"),
];
const proc = spawnSync(ffmpeg, args, { cwd: capture, stdio: "inherit", windowsHide: true });
if (proc.error) throw proc.error;
assert.equal(proc.status, 0);
