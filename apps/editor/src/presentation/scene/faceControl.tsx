import { useEffect, useRef, useState, type RefObject } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { readFaceWeights, type LiveFaceFrame } from "./faceRig";

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
  liveFace: RefObject<LiveFaceFrame | null>;
}

/** Capture one on-device face stream and publish the latest expression for the selected actor. */
export const WebcamFaceControl = ({ subjectId, available, liveFace }: WebcamFaceControlProps) => {
  const [status, setStatus] = useState<CaptureStatus>({ kind: "off" });
  const selectedSubject = useRef(subjectId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const enabled = status.kind === "starting" || status.kind === "tracking" || status.kind === "no_face";

  useEffect(() => {
    selectedSubject.current = subjectId;
    liveFace.current = null;
  }, [subjectId, liveFace]);

  useEffect(() => {
    if (!available) setStatus({ kind: "off" });
  }, [available]);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !available || !video) return;
    const controller = new AbortController();
    let stream: MediaStream | undefined;
    let detector: FaceLandmarker | undefined;
    let frameCallback = 0;
    let tracking = false;

    const stop = () => {
      controller.abort();
      if (frameCallback) video.cancelVideoFrameCallback(frameCallback);
      video.srcObject = null;
      stream?.getTracks().forEach((track) => track.stop());
      detector?.close();
      detector = undefined;
      liveFace.current = null;
    };
    const fail = (message: string, cause?: unknown) => {
      if (controller.signal.aborted) return;
      stop();
      if (cause) console.error(message, cause);
      setStatus({ kind: "error", message });
    };
    const tick: VideoFrameRequestCallback = (now) => {
      if (controller.signal.aborted || !detector) return;
      try {
        const face = detector.detectForVideo(video, now).faceBlendshapes[0];
        liveFace.current = face ? { subjectId: selectedSubject.current, weights: readFaceWeights(face.categories) } : null;
        if (Boolean(face) !== tracking) {
          tracking = Boolean(face);
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
        const { createFaceDetector } = await import("./faceDetector");
        const nextDetector = await createFaceDetector(controller.signal);
        if (controller.signal.aborted) {
          nextDetector.close();
          return;
        }
        detector = nextDetector;
        setStatus({ kind: "no_face" });
        frameCallback = video.requestVideoFrameCallback(tick);
      } catch (cause) {
        fail("표정 추적 모델을 불러오지 못했습니다.", cause);
      }
    };
    void start();
    return stop;
  }, [available, enabled, liveFace]);

  const toggle = () => setStatus({ kind: enabled ? "off" : "starting" });
  const running = enabled && available;
  const message = status.kind === "error" ? status.message : messages[status.kind];

  return (
    <div className="interaction-face">
      <button type="button" disabled={!available} aria-pressed={running} onClick={toggle}>
        {running ? "웹캠 끄기" : "웹캠 표정 켜기"}
      </button>
      <video ref={videoRef} hidden={!running} width={128} muted playsInline aria-label="웹캠 미리보기" />
      <span role="status">{available ? message : "이 인물에는 표정 채널이 없습니다."}</span>
    </div>
  );
};
