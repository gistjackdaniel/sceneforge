import { useEffect, useRef, useState, type RefObject } from "react";
import type { FaceLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { readFaceWeights, type LiveFaceFrame } from "./faceRig";
import { readUpperBodyAims, smoothAims, type UpperBodyAims } from "./upperBody";

type CaptureStatus =
  | { kind: "off" | "starting" | "tracking" | "no_face" }
  | { kind: "error"; message: string };

const messages = {
  off: "",
  starting: "웹캠 표정 추적을 준비 중입니다.",
  tracking: "웹캠 표정을 적용 중입니다.",
  no_face: "카메라에서 얼굴을 찾고 있습니다.",
};

const cameraError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "카메라 권한을 확인해 주세요.";
  if (error instanceof DOMException && error.name === "NotFoundError") return "연결된 카메라를 찾을 수 없습니다.";
  return "카메라를 열지 못했습니다.";
};

interface WebcamFaceControlProps {
  subjectId: string;
  available: boolean;
  /** The actor has SOMA body bones, so the webcam can also drive its arms and torso. */
  bodyAvailable: boolean;
  liveFace: RefObject<LiveFaceFrame | null>;
}

/** Capture one on-device webcam stream and publish the latest expression, and optionally upper-body pose, for the selected actor. */
export const WebcamFaceControl = ({ subjectId, available, bodyAvailable, liveFace }: WebcamFaceControlProps) => {
  const [status, setStatus] = useState<CaptureStatus>({ kind: "off" });
  const [upperBody, setUpperBody] = useState(false);
  const selectedSubject = useRef(subjectId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const enabled = status.kind === "starting" || status.kind === "tracking" || status.kind === "no_face";
  // An actor without expression channels can still follow the webcam with its upper body.
  const usable = available || bodyAvailable;
  const withBody = bodyAvailable && (upperBody || !available);

  useEffect(() => {
    selectedSubject.current = subjectId;
    liveFace.current = null;
  }, [subjectId, liveFace]);

  useEffect(() => {
    if (!usable) setStatus({ kind: "off" });
  }, [usable]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !usable || !video) return;
    const controller = new AbortController();
    let stream: MediaStream | undefined;
    let detector: FaceLandmarker | undefined;
    let poser: PoseLandmarker | undefined;
    let body: UpperBodyAims | undefined;
    let frameCallback = 0;
    let tracking = false;

    const stop = () => {
      controller.abort();
      if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
      video.srcObject = null;
      stream?.getTracks().forEach((track) => track.stop());
      detector?.close();
      detector = undefined;
      poser?.close();
      poser = undefined;
      liveFace.current = null;
    };
    const fail = (message: string, cause?: unknown) => {
      if (controller.signal.aborted) return;
      stop();
      if (cause) console.error(message, cause);
      setStatus({ kind: "error", message });
    };
    const tick: VideoFrameRequestCallback = (now) => {
      if (controller.signal.aborted || !(detector || poser)) return;
      try {
        const face = detector?.detectForVideo(video, now).faceBlendshapes[0];
        const landmarks = poser?.detectForVideo(video, now).worldLandmarks[0];
        body = landmarks ? smoothAims(body, readUpperBodyAims(landmarks)) : undefined;
        liveFace.current = face || body
          ? { subjectId: selectedSubject.current, weights: face ? readFaceWeights(face.categories) : {}, ...(body ? { body } : {}) }
          : null;
        if (Boolean(face || body) !== tracking) {
          tracking = Boolean(face || body);
          setStatus({ kind: tracking ? "tracking" : "no_face" });
        }
        frameCallback = video.requestVideoFrameCallback(tick);
      } catch (cause) {
        fail("웹캠 표정 추적이 중단되었습니다.", cause);
      }
    };
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !video.requestVideoFrameCallback) {
        fail("이 환경에서 웹캠 표정 추적을 사용할 수 없습니다. HTTPS 또는 localhost에서 열어 주세요.");
        return;
      }
      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (controller.signal.aborted) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => fail("카메라 연결이 끊겼습니다."), { once: true, signal: controller.signal });
        });
        video.srcObject = stream;
        await video.play();
      } catch (cause) {
        fail(cameraError(cause), cause);
        return;
      }
      try {
        const [nextDetector, nextPoser] = await Promise.all([
          available ? import("./faceDetector").then(({ createFaceDetector }) => createFaceDetector(controller.signal)) : undefined,
          withBody ? import("./poseDetector").then(({ createPoseDetector }) => createPoseDetector(controller.signal)) : undefined,
        ]);
        if (controller.signal.aborted) {
          nextDetector?.close();
          nextPoser?.close();
          return;
        }
        detector = nextDetector;
        poser = nextPoser;
        setStatus({ kind: "no_face" });
        frameCallback = video.requestVideoFrameCallback(tick);
      } catch (cause) {
        fail("표정 추적 모델을 불러오지 못했습니다.", cause);
      }
    };
    void start();
    return stop;
  }, [available, enabled, liveFace, usable, withBody]);

  const toggle = () => setStatus({ kind: enabled ? "off" : "starting" });
  const running = enabled && usable;
  const message = status.kind === "error" ? status.message
    : status.kind === "tracking" && withBody ? (available ? "웹캠 표정과 상체 동작을 적용 중입니다." : "웹캠 상체 동작을 적용 중입니다.")
    : messages[status.kind];

  return (
    <div className="interaction-face">
      <button type="button" disabled={!usable} aria-pressed={running} onClick={toggle}>
        {running ? "웹캠 끄기" : "웹캠 표정 켜기"}
      </button>
      <label><input type="checkbox" checked={withBody} disabled={!available || !bodyAvailable} onChange={(event) => setUpperBody(event.target.checked)} />상체도 웹캠으로 움직이기</label>
      <video ref={videoRef} hidden={!running} width={128} muted playsInline aria-label="웹캠 미리보기" />
      <span role="status">{usable ? message : "이 인물에는 표정 채널이 없습니다."}</span>
    </div>
  );
};
