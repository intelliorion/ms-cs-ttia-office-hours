import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { AdditiveBlending, NormalBlending, Sprite, Vector3 } from 'three';
import { DIM, edgeStyle, NIGHT, roleStyle, withFlash, type GEdge, type Role, type ScenePalette, type Vec3 } from './graphView';
import { haloTexture } from './haloTexture';

const PULSE_SECONDS = 1.2;
/** Without bloom the links lose their lift, so Lite draws them a little stronger. */
const LITE_LINK_BOOST = 2.2;

/**
 * Faint teal links; unconfirmed dashed amber; derived dashed violet; the selection's links bright with travelling pulses.
 * A person's role on an idea has its own look (lead gold and thick, builder blue, sponsor rose, member dotted), static in
 * every quality. The threads a chat change just made (flash) pulse for a moment as a selection's do.
 */
// memo: hover changes never re-render the links (their style depends only on the selection).
// Lite (no bloom): the selection's links get a second, wider, faint additive line under them as their glow.
// Frost: silver threads on light, the ones in view pine green, drawn stronger (light swallows thin lines), no glow.
export const Links = memo(function Links({ edges, pos, selectedId, lit = null, dim = DIM, lite = false, palette = NIGHT, hood = null, flash = null }: { edges: GEdge[]; pos: Map<string, Vec3>; selectedId: string | null; lit?: Set<string> | null; dim?: number; lite?: boolean; palette?: ScenePalette; hood?: Set<string> | null; flash?: Set<string> | null }) {
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
  const style = (e: GEdge) => withFlash(edgeStyle(e, selectedId, lit, dim, hood), e, flash);
  const pulses = drawn.filter((e) => (selectedId && edgeStyle(e, selectedId).pulse) || !!flash?.has(e.id));
  // Lite: the quiet links go in a few batches (one draw call per look) instead of one line each.
  const batches = useMemo(() => (lite ? linkBatches(drawn, points, selectedId, lit, dim, hood, palette, flash) : []), [lite, drawn, points, selectedId, lit, dim, hood, palette, flash]);
  const single = lite ? pulses : drawn;
  return (
    <group>
      {batches.map((b) => (
        <Line
          key={b.key}
          points={b.points}
          segments
          color={b.colour}
          lineWidth={b.width}
          transparent
          opacity={Math.min(1, boost * b.opacity)}
          dashed={b.dashed || !!b.dash}
          dashSize={b.dash?.[0] ?? 2.5}
          gapSize={b.dash?.[1] ?? 2}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {single.map((e) => {
        const s = style(e);
        const bright = s.pulse;
        const r = roleStyle(e.rel, palette, e);
        return (
          <Line
            key={e.id}
            points={points.get(e.id)!}
            color={s.derived ? palette.derived : s.dashed ? palette.unconfirmed : r ? r.colour : bright || (lit && lit.has(e.from) && lit.has(e.to)) ? palette.linkHot : palette.link}
            lineWidth={(r?.width ?? 1) * (bright ? 1.2 : 1)}
            transparent
            opacity={Math.min(1, boost * linkOpacity(e, selectedId, lit, dim, hood, flash) * (r?.boost ?? 1))}
            dashed={s.dashed || !!r?.dash}
            dashSize={r?.dash?.[0] ?? 2.5}
            gapSize={r?.dash?.[1] ?? 2}
            depthWrite={false}
            toneMapped={false}
          />
        );
      })}
      {lite && !palette.frost && !palette.workshop && pulses.map((e) => (
        <Line
          key={`glow-${e.id}`}
          points={points.get(e.id)!}
          color={e.derived ? palette.derived : !e.confirmed ? palette.unconfirmed : roleStyle(e.rel, palette, e)?.colour ?? palette.link}
          lineWidth={3}
          transparent
          opacity={0.1}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      ))}
      {pulses.map((e) => {
        // From the selected star outward; a changed thread with neither end selected runs from its start to its end.
        const out = selectedId === e.to ? [e.to, e.from] : [e.from, e.to];
        return <Pulse key={e.id} from={pos.get(out[0])!} to={pos.get(out[1])!} amber={!e.confirmed && !e.derived} frost={palette.frost || !!palette.workshop} hot={palette.linkHot} tint={e.derived ? palette.derived : roleStyle(e.rel, palette, e)?.colour} />;
      })}
    </group>
  );
});

const linkOpacity = (e: GEdge, selectedId: string | null, lit?: Set<string> | null, dim = DIM, hood?: Set<string> | null, flash?: Set<string> | null) => {
  const s = withFlash(edgeStyle(e, selectedId, lit, dim, hood), e, flash);
  return !selectedId && !lit && !s.pulse && e.rel === 'HAS_MEMBER' ? s.opacity * 0.6 : s.opacity;
};

export interface LinkBatch { key: string; dashed: boolean; derived: boolean; opacity: number; points: Vec3[]; colour: string; width: number; role?: Role; dash?: [number, number] }
/**
 * The links that are not the selection's (nor a change's, which pulse), grouped by look (dashed, role, opacity) as flat
 * segment lists: one draw call per look. A role thread keeps its colour and width here too, still, with no animation.
 */
export function linkBatches(edges: GEdge[], points: Map<string, [Vec3, Vec3]>, selectedId: string | null, lit?: Set<string> | null, dim = DIM, hood?: Set<string> | null, palette: ScenePalette = NIGHT, flash?: Set<string> | null): LinkBatch[] {
  const m = new Map<string, LinkBatch>();
  for (const e of edges) {
    const s = withFlash(edgeStyle(e, selectedId, lit, dim, hood), e, flash);
    const ab = points.get(e.id); if (s.pulse || !ab) continue;
    const r = s.dashed ? null : roleStyle(e.rel, palette, e);
    const opacity = linkOpacity(e, selectedId, lit, dim, hood) * (r?.boost ?? 1);
    if (opacity <= 0) continue;
    const key = `${s.derived ? 'r' : s.dashed ? 'd' : r ? r.role : 's'}-${opacity}`;
    let b = m.get(key);
    if (!b) m.set(key, (b = {
      key, dashed: s.dashed, derived: s.derived, opacity, points: [],
      colour: s.derived ? palette.derived : s.dashed ? palette.unconfirmed : r ? r.colour : palette.link,
      width: r?.width ?? 1, ...(r ? { role: r.role } : {}), ...(r?.dash ? { dash: r.dash } : {}),
    }));
    b.points.push(ab[0], ab[1]);
  }
  return [...m.values()];
}

function Pulse({ from, to, amber, frost = false, hot, tint }: { from: Vec3; to: Vec3; amber: boolean; frost?: boolean; hot?: string; tint?: string }) {
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
      <spriteMaterial map={haloTexture()} color={tint ?? (frost ? (amber ? '#b8862b' : hot ?? '#1f6f5c') : amber ? '#ffd29a' : '#c9fffa')}
        blending={frost ? NormalBlending : AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
