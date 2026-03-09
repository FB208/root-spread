"use client";

import {
  useCallback,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";

type ReactivePanelProps = HTMLAttributes<HTMLDivElement> & {
  rotationLimit?: number;
};

const baseStyle = {
  "--pointer-x": "50%",
  "--pointer-y": "50%",
  "--rotate-x": "0deg",
  "--rotate-y": "0deg",
  "--glow-alpha": "0",
} as CSSProperties;

function updatePointerState(
  element: HTMLDivElement,
  clientX: number,
  clientY: number,
  rotationLimit: number,
) {
  const rect = element.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;
  const ratioX = rect.width === 0 ? 0.5 : offsetX / rect.width;
  const ratioY = rect.height === 0 ? 0.5 : offsetY / rect.height;

  element.style.setProperty("--pointer-x", `${offsetX}px`);
  element.style.setProperty("--pointer-y", `${offsetY}px`);
  element.style.setProperty(
    "--rotate-x",
    `${((0.5 - ratioY) * rotationLimit).toFixed(2)}deg`,
  );
  element.style.setProperty(
    "--rotate-y",
    `${((ratioX - 0.5) * rotationLimit).toFixed(2)}deg`,
  );
  element.style.setProperty("--glow-alpha", "1");
}

function resetPointerState(element: HTMLDivElement) {
  element.style.setProperty("--pointer-x", "50%");
  element.style.setProperty("--pointer-y", "50%");
  element.style.setProperty("--rotate-x", "0deg");
  element.style.setProperty("--rotate-y", "0deg");
  element.style.setProperty("--glow-alpha", "0");
}

export function ReactivePanel({
  children,
  className,
  onPointerLeave,
  onPointerMove,
  rotationLimit = 10,
  style,
  ...props
}: ReactivePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = panelRef.current;

      if (element) {
        updatePointerState(
          element,
          event.clientX,
          event.clientY,
          rotationLimit,
        );
      }

      onPointerMove?.(event);
    },
    [onPointerMove, rotationLimit],
  );

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = panelRef.current;

      if (element) {
        resetPointerState(element);
      }

      onPointerLeave?.(event);
    },
    [onPointerLeave],
  );

  return (
    <div
      ref={panelRef}
      className={className ? `interactive-surface ${className}` : "interactive-surface"}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      style={{ ...baseStyle, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}
