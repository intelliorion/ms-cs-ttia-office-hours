import type { CSSProperties, ReactNode } from 'react';

export function Panel({ title, side = 'left', style, className = 'abs side-panel', children }: {
  title: string; side?: 'left' | 'right'; style?: CSSProperties; className?: string; children?: ReactNode;
}) {
  return (
    <section className={`panel ${className} ${side}`} style={style}>
      <h2>{title}</h2>
      <div className="panel-body">{children}</div>
    </section>
  );
}
