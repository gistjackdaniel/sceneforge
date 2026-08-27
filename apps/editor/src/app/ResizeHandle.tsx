import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  orientation: "vertical" | "horizontal";
  /** Called on drag start, before any onResize. */
  onResizeStart?: () => void;
  /** Pixel delta from drag start; positive = right/down. */
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  className?: string;
}

export const ResizeHandle = ({
  orientation,
  onResizeStart,
  onResize,
  onResizeEnd,
  className,
}: ResizeHandleProps) => {
  const startRef = useRef(0);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      onResizeStart?.();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      startRef.current = orientation === "vertical" ? event.clientX : event.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const current = orientation === "vertical" ? moveEvent.clientX : moveEvent.clientY;
        onResize(current - startRef.current);
      };

      const handleUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener("pointermove", handleMove);
        target.removeEventListener("pointerup", handleUp);
        onResizeEnd?.();
      };

      target.addEventListener("pointermove", handleMove);
      target.addEventListener("pointerup", handleUp);
    },
    [onResize, onResizeEnd, onResizeStart, orientation],
  );

  return (
    <div
      className={`resize-handle resize-handle-${orientation} ${className ?? ""}`}
      role="separator"
      aria-orientation={orientation}
      onPointerDown={handlePointerDown}
    />
  );
};
