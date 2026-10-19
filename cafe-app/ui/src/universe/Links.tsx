import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, Sprite, Vector3 } from 'three';
import { edgeStyle, LINK_COLOUR, UNCONFIRMED_COLOUR, type GEdge, type Vec3 } from './graphView';
import { haloTexture } from './haloTexture';

const PULSE_SECONDS = 1.2;

/** Faint teal links; unconfirmed dashed amber; the selection's links bright with travelling pulses. */
// memo: hover changes never re-render the links (their style depends only on the selection).
export const Links = memo(function Links({ edges, pos, selectedId }: { edges: GEdge[]; pos: Map<string, Vec3>; selectedId: string | null }) {
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
  return (
    <group>
      {drawn.map((e) => {
        const s = edgeStyle(e, selectedId);
        const bright = s.pulse;
        return (
          <Line
            key={e.id}
            points={points.get(e.id)!}
            color={s.dashed ? UNCONFIRMED_COLOUR : bright ? '#a8f0ea' : LINK_COLOUR}
            lineWidth={bright ? 1.6 : 1}
            transparent
            opacity={!selectedId && e.rel === 'HAS_MEMBER' ? s.opacity * 0.6 : s.opacity}
            dashed={s.dashed}
            dashSize={2.5}
            gapSize={2}
            depthWrite={false}
            toneMapped={false}
          />
        );
      })}
      {pulses.map((e) => (
        <Pulse key={e.id} from={pos.get(selectedId === e.from ? e.from : e.to)!} to={pos.get(selectedId === e.from ? e.to : e.from)!} amber={!e.confirmed} />
      ))}
    </group>
  );
});

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
