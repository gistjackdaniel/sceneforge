/** Shot-local timecode `HH:MM:SS:FF`. `fps` must be `Shot.time.fps`. */
export const frameToTimecode = (frame: number, fps: number): string => {
  const rate = Math.max(1, Math.round(fps));
  const whole = Math.max(0, Math.floor(frame));
  const frames = whole % rate;
  const totalSeconds = Math.floor(whole / rate);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
};
