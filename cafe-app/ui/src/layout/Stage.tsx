import { useEffect, useState, type ReactNode } from 'react';

const W = 1920, H = 1080;
const fit = () => Math.min(window.innerWidth / W, window.innerHeight / H);

export function Stage({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const [scale, setScale] = useState(fit);
  useEffect(() => {
    const on = () => setScale(fit());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return (
    <div className="stage-wrap">
      <div className={`stage${focus ? ' focus' : ''}`} data-testid="stage" style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}
