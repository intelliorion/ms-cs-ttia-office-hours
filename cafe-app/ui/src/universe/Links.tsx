import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, Sprite, Vector3 } from 'three';
import { edgeStyle, LINK_COLOUR, UNCONFIRMED_COLOUR, type GEdge, type Vec3 } from './graphView';
import { haloTexture } from './haloTexture';

const PULSE_SECONDS = 1.2;
/** Without bloom the links lose their lift, so Lite draws them a little stronger. */
const LITE_LINK_BOOST = 2.2;

/** Faint teal links; unconfirmed dashed amber; the selection's links bright with travelling pulses. */
// memo: hover changes never re-render the links (their style depends only on the selection).
// Lite (no bloom): the selection's links get a second, wider, faint additive line under them as their glow.
export const Links = memo(function Links({ edges, pos, selectedId, lit = null, lite = false }: { edges: GEdge[]; pos: Map<string, Vec3>; selectedId: string | null; lit?: Set<string> | null; lite?: boolean }) {
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
  const batches = useMemo(() => (lite ? linkBatches(drawn, points, selectedId, lit) : []), [lite, drawn, points, selectedId, lit]);
  const single = lite ? pulses : drawn;
  return (
    <group>
      {batches.map((b) => (
        <Line
          key={b.key}
          points={b.points}
          segments
          color={b.dashed ? UNCONFIRMED_COLOUR : LINK_COLOUR}
          lineWidth={1}
          transparent
          opacity={Math.min(1, LITE_LINK_BOOST * b.opacity)}
          dashed={b.dashed}
          dashSize={2.5}
          gapSize={2}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {single.map((e) => {
        const s = edgeStyle(e, selectedId, lit);
        const bright = s.pulse;
        return (
          <Line
            key={e.id}
            points={points.get(e.id)!}
            color={s.dashed ? UNCONFIRMED_COLOUR : bright ? '#a8f0ea' : LINK_COLOUR}
            lineWidth={bright ? 1.6 : 1}
            transparent
            opacity={Math.min(1, (lite ? LITE_LINK_BOOST : 1) * linkOpacity(e, selectedId, lit))}
            dashed={s.dashed}
            dashSize={2.5}
            gapSize={2}
            depthWrite={false}
            toneMapped={false}
          />
        );
      })}
      {lite && pulses.map((e) => (
        <Line
          key={`glow-${e.id}`}
          points={points.get(e.id)!}
          color={e.confirmed ? '#7dd3cf' : UNCONFIRMED_COLOUR}
          lineWidth={6}
          transparent
          opacity={0.22}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {pulses.map((e) => (
        <Pulse key={e.id} from={pos.get(selectedId === e.from ? e.from : e.to)!} to={pos.get(selectedId === e.from ? e.to : e.from)!} amber={!e.confirmed} />
      ))}
    </group>
  );
});

const linkOpacity = (e: GEdge, selectedId: string | null, lit?: Set<string> | null) => {
  const s = edgeStyle(e, selectedId, lit);
  return !selectedId && !lit && e.rel === 'HAS_MEMBER' ? s.opacity * 0.6 : s.opacity;
};

/** The links that are not the selection's, grouped by look (dashed, opacity) as flat segment lists. */
export function linkBatches(edges: GEdge[], points: Map<string, [Vec3, Vec3]>, selectedId: string | null, lit?: Set<string> | null) {
  const m = new Map<string, { key: string; dashed: boolean; opacity: number; points: Vec3[] }>();
  for (const e of edges) {
    const s = edgeStyle(e, selectedId, lit);
    const ab = points.get(e.id); if (s.pulse || !ab) continue;
    const opacity = linkOpacity(e, selectedId, lit);
    const key = `${s.dashed ? 'd' : 's'}-${opacity}`;
    let b = m.get(key);
    if (!b) m.set(key, (b = { key, dashed: s.dashed, opacity, points: [] }));
    b.points.push(ab[0], ab[1]);
  }
  return [...m.values()];
}

function Pulse({ from, to, amber }: { from: Vec3; to: Vec3; amber: boolean }) {
  const ref = useRef<Sprite>(null);
  const [a, b] = useMemo(() => [new Vector3(...from), new Vector3(...to)], [from, to]);
  const offset = useMemo(() => Math.random(), []);
  useFrame(({ clock }) => {
    const t = ((clock.elapsedTime / PULSE_SECONDS) + offset) % 1;
    const s = ref.current; if (!s) return;
    s.position.lerpVectors(a, b, t);
    const fade = Math.sin(Math.PI * t);
    (s.material as { opacity: number }).opacity = 0.95 * fade;
    s.scale.setScalar(1.4 + fade * 1.3);
  });
  return (
    <sprite ref={ref}>
      <spriteMaterial map={haloTexture()} color={amber ? '#ffd29a' : '#c9fffa'} blending={AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
