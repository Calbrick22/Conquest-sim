import { useRef } from 'react';

/**
 * A drag handle on the edge of a side panel (desktop). Drag or use the arrow keys to resize;
 * double-click to reset. `edge` is the panel edge the handle sits on: 'left' for the right-hand
 * side panel (dragging left widens it), 'right' for the left-hand panel.
 */
export function PanelResizer({ edge, width, min, max, reset, onChange, label }: { edge: 'left' | 'right'; width: number; min: number; max: number; reset: number; onChange: (w: number) => void; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.max(min, Math.min(max, w)));
  const sign = edge === 'left' ? -1 : 1;
  return (
    <div
      className={`panel-resizer ${edge}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      data-testid={`resize-${edge}`}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.w + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(clamp(width - sign * 20));
        else if (e.key === 'ArrowRight') onChange(clamp(width + sign * 20));
        else return;
        e.preventDefault();
      }}
    />
  );
}
