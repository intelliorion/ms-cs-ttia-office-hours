import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** The design frame: everything is laid out for at least this size. */
export const BASE_W = 1920, BASE_H = 1080;

export interface StageSize { w: number; h: number; scale: number }

/**
 * Fit the window with no bands on any side: scale so the 1920×1080 frame fits, then let the frame grow along the
 * longer axis to the window's edges. On a 16:9 window the frame is exactly 1920×1080; on a wider one it gets wider.
 */
export function fitStage(innerWidth: number, innerHeight: number): StageSize {
  const scale = Math.min(innerWidth / BASE_W, innerHeight / BASE_H) || 1;
  return { w: Math.max(BASE_W, Math.round(innerWidth / scale)), h: Math.max(BASE_H, Math.round(innerHeight / scale)), scale };
}

const StageSizeContext = createContext<StageSize>({ w: BASE_W, h: BASE_H, scale: 1 });
/** The frame's size in stage pixels, for anything placed against its right or bottom edge. */
export const useStageSize = () => useContext(StageSizeContext);

const fit = () => fitStage(window.innerWidth, window.innerHeight);

export function Stage({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const [size, setSize] = useState(fit);
  useEffect(() => {
    const on = () => setSize(fit());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const style = { width: size.w, height: size.h, transform: `scale(${size.scale})`, '--sw': `${size.w}px`, '--sh': `${size.h}px` } as React.CSSProperties;
  return (
    <StageSizeContext.Provider value={size}>
      <div className="stage-wrap">
        <div className={`stage${focus ? ' focus' : ''}`} data-testid="stage" style={style}>{children}</div>
      </div>
    </StageSizeContext.Provider>
  );
}
