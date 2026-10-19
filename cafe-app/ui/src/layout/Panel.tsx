import type { CSSProperties, ReactNode } from 'react';

export function Panel({ title, side = 'left', style, children }: { title: string; side?: 'left' | 'right'; style: CSSProperties; children?: ReactNode }) {
  return (
    <section className={`panel abs ${side}`} style={style}>
      <h2>{title}</h2>
      <div className="panel-body">{children}</div>
    </section>
  );
}
