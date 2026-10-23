import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, NormalBlending, Sprite, Vector3 } from 'three';
import { DIM, edgeStyle, NIGHT, type GEdge, type ScenePalette, type Vec3 } from './graphView';
import { haloTexture } from './haloTexture';

const PULSE_SECONDS = 1.2;
/** Without bloom the links lose their lift, so Lite draws them a little stronger. */
const LITE_LINK_BOOST = 2.2;

/** Faint teal links; unconfirmed dashed amber; the selection's links bright with travelling pulses. */
// memo: hover changes never re-render the links (their style depends only on the selection).
// Lite (no bloom): the selection's links get a second, wider, faint additive line under them as their glow.
// Frost: silver threads on light, the ones in view pine green, drawn stronger (light swallows thin lines), no glow.
export const Links = memo(function Links({ edges, pos, selectedId, lit = null, dim = DIM, lite = false, palette = NIGHT }: { edges: GEdge[]; pos: Map<string, Vec3>; selectedId: string | null; lit?: Set<string> | null; dim?: number; lite?: boolean; palette?: ScenePalette }) {
  const boost = (lite ? LITE_LINK_BOOST : 1) * palette.linkBoost;
  // One stable points array per edge, so drei Line keeps its geometry across renders.
  const points = useMemo(() => {
    const m = new Map<string, [Vec3, Vec3]>();
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (a && b) m.set(e.id, [a, b]);
    }
    return m;
  }, [edges, pos]);
  const drawn = useMemo(() => edges.filter((e) => points.has(e.id)), [edges, points]);
  const pulses = selectedId ? drawn.filter((e) => edgeStyle(e, selectedId).pulse) : [];
  // Lite: the quiet links go in a few batches (one draw call per look) instead of one line each.
  const batches = useMemo(() => (lite ? linkBatches(drawn, points, selectedId, lit, dim) : []), [lite, drawn, points, selectedId, lit, dim]);
  const single = lite ? pulses : drawn;
  return (
    <group>
      {batches.map((b) => (
        <Line
          key={b.key}
          points={b.points}
          segments
          color={b.dashed ? palette.unconfirmed : palette.link}
          lineWidth={1}
          transparent
          opacity={Math.min(1, boost * b.opacity)}
          dashed={b.dashed}
          dashSize={2.5}
          gapSize={2}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {single.map((e) => {
        const s = edgeStyle(e, selectedId, lit, dim);
        const bright = s.pulse;
        return (
          <Line
            key={e.id}
            points={points.get(e.id)!}
            color={s.dashed ? palette.unconfirmed : bright || (lit && lit.has(e.from) && lit.has(e.to)) ? palette.linkHot : palette.link}
            lineWidth={bright ? 1.2 : 1}
            transparent
            opacity={Math.min(1, boost * linkOpacity(e, selectedId, lit, dim))}
            dashed={s.dashed}
            dashSize={2.5}
            gapSize={2}
            depthWrite={false}
            toneMapped={false}
          />
        );
      })}
      {lite && !palette.frost && !palette.workshop && pulses.map((e) => (
        <Line
          key={`glow-${e.id}`}
          points={points.get(e.id)!}
          color={e.confirmed ? palette.link : palette.unconfirmed}
          lineWidth={3}
          transparent
          opacity={0.1}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {pulses.map((e) => (
        <Pulse key={e.id} from={pos.get(selectedId === e.from ? e.from : e.to)!} to={pos.get(selectedId === e.from ? e.to : e.from)!} amber={!e.confirmed} frost={palette.frost || !!palette.workshop} hot={palette.linkHot} />
      ))}
    </group>
  );
});

const linkOpacity = (e: GEdge, selectedId: string | null, lit?: Set<string> | null, dim = DIM) => {
  const s = edgeStyle(e, selectedId, lit, dim);
  return !selectedId && !lit && e.rel === 'HAS_MEMBER' ? s.opacity * 0.6 : s.opacity;
};

/** The links that are not the selection's, grouped by look (dashed, opacity) as flat segment lists. */
export function linkBatches(edges: GEdge[], points: Map<string, [Vec3, Vec3]>, selectedId: string | null, lit?: Set<string> | null, dim = DIM) {
  const m = new Map<string, { key: string; dashed: boolean; opacity: number; points: Vec3[] }>();
  for (const e of edges) {
    const s = edgeStyle(e, selectedId, lit, dim);
    const ab = points.get(e.id); if (s.pulse || !ab) continue;
    const opacity = linkOpacity(e, selectedId, lit, dim);
    if (opacity <= 0) continue;
    const key = `${s.dashed ? 'd' : 's'}-${opacity}`;
    let b = m.get(key);
    if (!b) m.set(key, (b = { key, dashed: s.dashed, opacity, points: [] }));
    b.points.push(ab[0], ab[1]);
  }
  return [...m.values()];
}

function Pulse({ from, to, amber, frost = false, hot }: { from: Vec3; to: Vec3; amber: boolean; frost?: boolean; hot?: string }) {
  const ref = useRef<Sprite>(null);
  const [a, b] = useMemo(() => [new Vector3(...from), new Vector3(...to)], [from, to]);
  const offset = useMemo(() => Math.random(), []);
  useFrame(({ clock }) => {
    const t = ((clock.elapsedTime / PULSE_SECONDS) + offset) % 1;
    const s = ref.current; if (!s) return;
    s.position.lerpVectors(a, b, t);
    const fade = Math.sin(Math.PI * t);
    (s.material as { opacity: number }).opacity = 0.55 * fade;
    s.scale.setScalar(1.1 + fade * 0.8);
  });
  return (
    <sprite ref={ref}>
      {/* A glow adds light, which shows on dark only; on Frost the bead is a soft pine (or gold) dot instead. */}
      <spriteMaterial map={haloTexture()} color={frost ? (amber ? '#b8862b' : hot ?? '#1f6f5c') : amber ? '#ffd29a' : '#c9fffa'}
        blending={frost ? NormalBlending : AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
