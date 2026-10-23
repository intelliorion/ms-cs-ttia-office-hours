import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Html, Line } from '@react-three/drei';
import { AdditiveBlending, Color, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Material } from 'three';
import { BLUEPRINT_TINT, DIM, NIGHT, NODE_COLOURS, labelSpotVisible, type ScenePalette, labelsMayOverlap, wantsLabel, type LabelMode, phase, ringColour, starLabel, starSize, type GNode, type Vec3 } from './graphView';
import { haloTexture, softHaloTexture } from './haloTexture';
import { HAMMER, gearGeometry } from './workshopShapes';

const RING_PTS: [number, number, number][] = Array.from({ length: 65 }, (_, k) => [Math.cos((k / 64) * Math.PI * 2), Math.sin((k / 64) * Math.PI * 2), 0]);

export interface StarsProps {
  nodes: GNode[];
  pos: Map<string, Vec3>;
  deg: Map<string, number>;
  hood: Set<string> | null;
  selectedId: string | null;
  /** Every star picked with Ctrl/⌘+click: each glows like the selected one. */
  picked?: Set<string> | null;
  hoverId: string | null;
  labels: LabelMode;
  /** Focus mode: no side panels, so labels may use the whole stage. */
  focus?: boolean;
  /** Lite quality: no bloom, so the halos carry the glow (larger, with a pulse on the selected star). */
  lite?: boolean;
  /** How bright stars outside the lit set are (0 hides them, with their labels and rings). */
  dim?: number;
  /** The theme's colours. Frost draws glossy baubles with gold caps instead of glowing stars. */
  palette?: ScenePalette;
  onSelect: (id: string, additive?: boolean) => void;
  onHover: (id: string | null) => void;
}

const HALO = 3; // halo diameter is 3× the star diameter
/** Lite halos, as multiples of the star diameter: every star, and the selected one (which also pulses). */
export const LITE_HALO = 6;
export const LITE_HALO_SELECTED = 8.5;
export const LITE_HALO_OPACITY = 0.55;
/** Lite also puts a small white-hot glint on each star, standing in for the bright centre bloom gives in Full. */
export const LITE_GLINT = 1.5;
const WHITE = new Color('#ffffff');
const Z_AXIS = new Vector3(0, 0, 1);
const tmpR = new Quaternion(); const tmpZ = new Quaternion();
/**
 * Lite labels move in whole pixels and only once a label has drifted a pixel or more: on software graphics
 * re-styling a few hundred labels every frame costs more than drawing the scene.
 */
const LITE_LABEL = {
  eps: 1,
  calculatePosition: (el: Object3D, camera: import('three').Camera, size: { width: number; height: number }) => {
    const v = tmpL.setFromMatrixPosition(el.matrixWorld).project(camera);
    return [Math.round((v.x + 1) * size.width / 2), Math.round((1 - v.y) * size.height / 2)];
  },
};
const tmpL = new Vector3();
const tmpF = new Vector3();

/** A halo's diameter this frame. */
export function haloDiameter(size: number, o: { lite: boolean; selected: boolean; hovered: boolean; t: number }): number {
  if (!o.lite) return size * 2 * HALO * (o.hovered ? 1.15 : 1);
  if (o.selected) return size * 2 * LITE_HALO_SELECTED * (1 + 0.08 * Math.sin(o.t * 2.4));
  return size * 2 * LITE_HALO * (o.hovered ? 1.15 : 1);
}

interface InstanceSink { setMatrixAt(i: number, m: Matrix4): void; setColorAt(i: number, c: Color): void }
/** One billboarded halo per star: writes every instance's matrix and colour for this frame (no rendering needed). */
export function writeHalos(h: InstanceSink, f: {
  nodes: GNode[]; pos: Map<string, Vec3>; sizes: number[]; base: Color[]; bright: number[]; hood: Set<string> | null;
  selectedId: string | null; hoverIndex: number; lite: boolean; t: number; facing: Quaternion; glint?: InstanceSink | null;
  /** Stars outside the lit set are hidden: their halos take no space. */
  hide?: boolean;
}): number {
  for (let i = 0; i < f.nodes.length; i++) {
    const id = f.nodes[i].id;
    const lit = !f.hood || f.hood.has(id);
    const p = f.pos.get(id)!;
    h.setColorAt(i, tmpC.copy(f.base[i]).multiplyScalar(f.bright[i] * (lit ? 0.85 : 0.5)));
    tmpS.setScalar(f.hide && !lit ? 0 : haloDiameter(f.sizes[i], { lite: f.lite, selected: id === f.selectedId, hovered: i === f.hoverIndex, t: f.t }));
    h.setMatrixAt(i, tmpM.compose(tmpP.set(p[0], p[1], p[2]), f.facing, tmpS));
    if (f.glint) {
      f.glint.setColorAt(i, tmpC.copy(f.base[i]).lerp(WHITE, 0.4).multiplyScalar(f.bright[i] * (lit ? 0.9 : 0.4)));
      tmpS.setScalar(f.sizes[i] * 2 * LITE_GLINT * (i === f.hoverIndex || id === f.selectedId ? 1.2 : 1));
      // Just in front of the sphere (towards the camera), so the depth test keeps it over its own star only.
      tmpP.add(tmpF.set(0, 0, 1).applyQuaternion(f.facing).multiplyScalar(f.sizes[i] * 1.05));
      f.glint.setMatrixAt(i, tmpM.compose(tmpP, f.facing, tmpS));
    }
  }
  return f.nodes.length;
}
const tmpM = new Matrix4(); const tmpC = new Color(); const tmpQ = new Quaternion(); const tmpS = new Vector3(); const tmpP = new Vector3();
const dummy = new Object3D();
const tmpV = new Vector3(); const tmpW = new Vector3();
const TYPE_RANK: Record<string, number> = { Idea: 0, Team: 1, Round: 1, Entity: 2, Tool: 3, Capability: 4, System: 5, PainPoint: 6, Support: 6, Outcome: 6, Beneficiary: 6, Category: 6, Person: 7 };

// Per-instance emissive: three multiplies diffuse by instance colour; we also multiply emissive by it.
function emissiveByInstance(m: Material) {
  m.customProgramCacheKey = () => 'emissive-by-instance';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      // Limb darkening: the face of the star is hot, its edge falls off, so a close star reads as a sphere.
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif\n'
        + 'totalEmissiveRadiance *= mix(0.35, 1.25, pow(clamp(abs(normal.z), 0.0, 1.0), 1.4));',
    );
  };
}

/** Glowing stars: instanced cores, additive halos, stage rings on ideas, and labels. */
/** A bauble's cap: a short gold cylinder on top, as wide as a third of the ball. */
export const CAP = { width: 0.36, height: 0.3, lift: 0.96 };
/** Blueprint: stars at least this big get the white drafting wireframe. */
export const WIRE_FROM = 4.5;
export function Stars({ nodes, pos, deg, hood, selectedId, picked = null, hoverId, labels, focus = false, lite = false, dim = DIM, palette = NIGHT, onSelect, onHover }: StarsProps) {
  const frost = palette.frost;
  const blueprint = !!palette.blueprint;
  const workshop = !!palette.workshop;
  /** Frost, Blueprint and Workshop draw solid colour with no halo; the night sky lights its stars. */
  const flat = frost || blueprint || workshop;
  const gearGeo = useMemo(() => (workshop ? gearGeometry() : null), [workshop]);
  const hammerGeo = useMemo(() => (workshop ? { handle: HAMMER.handle(), head: HAMMER.head() } : null), [workshop]);
  const handle = useRef<InstancedMesh>(null);
  const head = useRef<InstancedMesh>(null);
  const cap = useRef<InstancedMesh>(null);
  const wire = useRef<InstancedMesh>(null);
  const bg = useMemo(() => new Color(palette.bg), [palette.bg]);
  const core = useRef<InstancedMesh>(null);
  const halo = useRef<InstancedMesh>(null);
  const glint = useRef<InstancedMesh>(null);
  const hit = useRef<InstancedMesh>(null);
  const n = nodes.length;
  const sizes = useMemo(() => nodes.map((d) => starSize(d, deg.get(d.id) ?? 0)), [nodes, deg]);
  const base = useMemo(() => nodes.map((d) => {
    const c = new Color(NODE_COLOURS[d.type] ?? '#9fb0ae');
    return palette.blueprint ? c.lerp(WHITE, BLUEPRINT_TINT) : c;
  }), [nodes, palette.blueprint]);
  const phases = useMemo(() => nodes.map((d) => phase(d.id)), [nodes]);
  const hoverIndex = hoverId ? nodes.findIndex((d) => d.id === hoverId) : -1;
  const root = useRef<Group>(null);
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const labelBox = useRef(new Map<string, [number, number]>());
  const frame = useRef(0);
  const bright = useRef<number[]>([]);
  const size = useThree((st) => st.size);

  // Hidden at 100%: stars outside the lit set take no space, no click and no label.
  const hidden = (id: string) => dim <= 0 && !!hood && !hood.has(id);
  useLayoutEffect(() => {
    nodes.forEach((d, i) => {
      const p = pos.get(d.id) ?? [0, 0, 0];
      const gone = hidden(d.id);
      dummy.position.set(...p); dummy.quaternion.identity();
      dummy.scale.setScalar(gone ? 0 : sizes[i]); dummy.updateMatrix();
      core.current!.setMatrixAt(i, dummy.matrix); core.current!.setColorAt(i, base[i]);
      dummy.scale.setScalar(gone ? 0 : Math.max(sizes[i] * 2.2, 4)); dummy.updateMatrix();
      hit.current!.setMatrixAt(i, dummy.matrix);
      halo.current!.setMatrixAt(i, dummy.matrix); halo.current!.setColorAt(i, base[i]);
      // Only the big stars (the division, teams) carry the drafting wireframe: on a small one the lines wash the colour out.
      if (wire.current) { dummy.position.set(...p); dummy.scale.setScalar(gone || sizes[i] < WIRE_FROM ? 0 : sizes[i]); dummy.updateMatrix(); wire.current.setMatrixAt(i, dummy.matrix); }
      if (cap.current) {
        dummy.position.set(p[0], p[1] + sizes[i] * CAP.lift, p[2]);
        dummy.scale.set(gone ? 0 : sizes[i] * CAP.width, gone ? 0 : sizes[i] * CAP.height, gone ? 0 : sizes[i] * CAP.width); dummy.updateMatrix();
        cap.current.setMatrixAt(i, dummy.matrix);
      }
    });
    if (cap.current) { cap.current.instanceMatrix.needsUpdate = true; cap.current.computeBoundingSphere(); }
    if (wire.current) { wire.current.instanceMatrix.needsUpdate = true; wire.current.computeBoundingSphere(); }
    for (const m of [core.current!, hit.current!, halo.current!]) {
      m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [nodes, pos, sizes, base, hood, dim, frost, blueprint, workshop]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock, camera }) => {
    const c = core.current, h = halo.current; if (!c || !h || !n) return; // no stars yet: nothing to light
    const t = clock.elapsedTime;
    // Halos face the camera: undo the parent group's rotation.
    h.parent!.getWorldQuaternion(tmpQ).invert().multiply(camera.quaternion);
    const b = bright.current; b.length = n;
    for (let i = 0; i < n; i++) {
      const id = nodes[i].id;
      const lit = !hood || hood.has(id);
      const twinkle = 1 + 0.1 * Math.sin(t * (0.6 + phases[i] * 0.9) + phases[i] * 6.283);
      b[i] = (lit ? 1 : dim) * (i === hoverIndex || id === selectedId || picked?.has(id) ? 1.4 : 1) * twinkle;
      // Frost: a bauble doesn't glow; out of view it fades toward the snow, picked it catches the light.
      if (workshop) {
        // A painted gear (a hammer for a tool) faces the camera and turns slowly, neighbours the other way.
        const hot = i === hoverIndex || id === selectedId || picked?.has(id);
        const gone = hidden(id);
        const isTool = nodes[i].type === 'Tool';
        const p = pos.get(id)!;
        tmpP.set(p[0], p[1], p[2]);
        c.setColorAt(i, tmpC.copy(base[i]).lerp(bg, lit ? 0 : 1 - dim).lerp(WHITE, hot ? 0.2 : 0));
        const spin = (i % 2 ? 1 : -1) * (t * 0.35 + phases[i] * 6.283);
        tmpR.copy(tmpQ).multiply(tmpZ.setFromAxisAngle(Z_AXIS, isTool ? HAMMER.tilt : spin));
        tmpS.setScalar(gone || isTool ? 0 : sizes[i] * (hot ? 2.75 : 2.5));
        c.setMatrixAt(i, tmpM.compose(tmpP, tmpR, tmpS));
        if (handle.current && head.current) {
          tmpS.setScalar(gone || !isTool ? 0 : sizes[i] * (hot ? 2.8 : 2.5));
          tmpM.compose(tmpP, tmpR, tmpS);
          handle.current.setMatrixAt(i, tmpM); head.current.setMatrixAt(i, tmpM);
        }
      } else if (flat) {
        const hot = i === hoverIndex || id === selectedId || picked?.has(id);
        c.setColorAt(i, tmpC.copy(base[i]).lerp(bg, lit ? 0 : 1 - dim).lerp(WHITE, hot ? 0.18 : 0));
      } else c.setColorAt(i, tmpC.copy(base[i]).multiplyScalar(b[i]));
    }
    const g = lite ? glint.current : null;
    writeHalos(h, { nodes, pos, sizes, base, bright: b, hood, selectedId, hoverIndex, lite, t, facing: tmpQ, glint: g, hide: dim <= 0 });
    c.instanceColor!.needsUpdate = true; h.instanceColor!.needsUpdate = true; h.instanceMatrix.needsUpdate = true;
    if (workshop) {
      c.instanceMatrix.needsUpdate = true;
      if (handle.current && head.current) { handle.current.instanceMatrix.needsUpdate = true; head.current.instanceMatrix.needsUpdate = true; }
    }
    if (g) { g.instanceColor!.needsUpdate = true; g.instanceMatrix.needsUpdate = true; }
    if (frame.current++ % 3 === 0) placeLabels(camera);
  });

  // Never cluttered: labels are placed in priority order and any that would overlap one already placed is hidden.
  const placeLabels = (camera: import('three').Camera) => {
    const g = root.current; if (!g) return;
    const narrowNow = typeof window !== 'undefined' && window.innerWidth < 1000;
    const rank = (id: string, type: string, i: number) =>
      (id === selectedId || id === hoverId || picked?.has(id) ? -100 : 0) + (hood?.has(id) ? -50 : 0) + (TYPE_RANK[type] ?? 9) * 10 - sizes[i];
    const order = nodes.map((d, i) => [d, i] as const).filter(([d]) => labelEls.current.has(d.id))
      .sort((a, b) => rank(a[0].id, a[0].type, a[1]) - rank(b[0].id, b[0].type, b[1]));
    type Box = [number, number, number, number];
    const placed: Box[] = [];
    for (const [d, i] of order) {
      const el = labelEls.current.get(d.id)!;
      let wh = labelBox.current.get(d.id);
      if (!wh || wh[0] === 0) { wh = [el.offsetWidth, el.offsetHeight]; labelBox.current.set(d.id, wh); }
      const p = pos.get(d.id)!;
      tmpV.set(p[0], p[1], p[2]).applyMatrix4(g.matrixWorld).project(camera);
      const x = ((tmpV.x + 1) / 2) * size.width, y = ((1 - tmpV.y) / 2) * size.height;
      // Clear the star (and an idea's ring) however close the camera is.
      const dist = tmpW.set(p[0], p[1], p[2]).applyMatrix4(g.matrixWorld).distanceTo(camera.position);
      const fov = (camera as import('three').PerspectiveCamera).fov ?? 45;
      const rPx = (sizes[i] * size.height) / (2 * Math.tan((fov * Math.PI) / 360) * dist);
      const off = Math.max(12, rPx * (d.type === 'Idea' ? 2.1 : 1.3) + 6);
      el.style.setProperty('--off', `${off.toFixed(1)}px`);
      // Try the right of the star, then the left; hide only if both collide.
      const top = y - wh[1] / 2 + 2, bottom = y + wh[1] / 2 - 2;
      const right: Box = [x + off - 4, top, x + off + 2 + wh[0], bottom];
      const left: Box = [x - off - 2 - wh[0], top, x - off + 4, bottom];
      // Not under the side panels (unless Focus hides them, or the window is narrow and they are drawers).
      const panels = !focus && !narrowNow;
      // Full shows every label even where they overlap; Smart and None never let two overlap.
      const overlaps = !labelsMayOverlap(labels);
      const free = (b: Box) => labelSpotVisible(b[0], b[2], size.width, panels, size.width) && !(overlaps && placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]));
      const box = tmpV.z > 1 ? null : free(right) ? right : free(left) ? left : null;
      el.style.visibility = box ? 'visible' : 'hidden';
      el.classList.toggle('left', box === left);
      if (box) placed.push(box);
    }
  };

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : nodes[e.instanceId]?.id ?? null);

  return (
    <group ref={root}>
      <instancedMesh key={`core-${n}-${workshop}`} ref={core} args={[gearGeo ?? undefined, undefined, n]} frustumCulled={false}>
        {!workshop && <sphereGeometry args={blueprint ? [1, 12, 8] : lite ? [1, 16, 12] : [1, 24, 16]} />}
        {workshop
          ? <meshStandardMaterial key="painted" color="#ffffff" metalness={0.1} roughness={0.6} envMapIntensity={0.25} toneMapped={false} fog={false} />
          : blueprint
          ? <meshBasicMaterial key="draft" color="#ffffff" fog={false} toneMapped={false} />
          : frost
          ? <meshPhysicalMaterial key="bauble" color="#ffffff" metalness={0.3} roughness={0.2} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.15} />
          : <meshStandardMaterial key="star" color="#000000" emissive="#ffffff" emissiveIntensity={1.6} roughness={1} metalness={0} toneMapped={false} onUpdate={emissiveByInstance} />}
      </instancedMesh>
      {/* Workshop: a tool is a hammer, a wooden handle and a steel head. */}
      {workshop && hammerGeo && (
        <>
          <instancedMesh key={`handle-${n}`} ref={handle} args={[hammerGeo.handle, undefined, n]} frustumCulled={false} raycast={() => null}>
            <meshStandardMaterial color="#a8743f" roughness={0.7} metalness={0} />
          </instancedMesh>
          <instancedMesh key={`head-${n}`} ref={head} args={[hammerGeo.head, undefined, n]} frustumCulled={false} raycast={() => null}>
            <meshStandardMaterial color="#8e979f" roughness={0.3} metalness={0.85} envMapIntensity={1} />
          </instancedMesh>
        </>
      )}
      {/* Blueprint: a thin white drafting wireframe over each solid star. */}
      {blueprint && (
        <instancedMesh key={`wire-${n}`} ref={wire} args={[undefined, undefined, n]} frustumCulled={false} raycast={() => null}>
          <sphereGeometry args={[1.08, 12, 8]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.4} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      {frost && (
        <instancedMesh key={`cap-${n}`} ref={cap} args={[undefined, undefined, n]} frustumCulled={false}>
          <cylinderGeometry args={[1, 1, 1, 14]} />
          <meshStandardMaterial color="#c9a347" metalness={0.85} roughness={0.28} envMapIntensity={1.2} />
        </instancedMesh>
      )}
      <instancedMesh key={`halo-${n}`} ref={halo} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={2} visible={!flat}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={lite ? softHaloTexture() : haloTexture()} transparent opacity={lite ? LITE_HALO_OPACITY : 1} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      {lite && !flat && (
        <instancedMesh key={`glint-${n}`} ref={glint} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={3}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={haloTexture()} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      <instancedMesh
        key={`hit-${n}`} ref={hit} args={[undefined, undefined, n]}
        onPointerMove={(e) => { e.stopPropagation(); const id = pick(e); if (id !== hoverId) onHover(id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); if (e.delta > 5) return; const id = pick(e); if (id) onSelect(id, e.nativeEvent.ctrlKey || e.nativeEvent.metaKey); }}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </instancedMesh>
      {nodes.map((d, i) => d.type === 'Idea' && (
        <Billboard key={d.id} position={pos.get(d.id)}>
          <mesh>
            <ringGeometry args={[sizes[i] * 1.75, sizes[i] * 1.75 + 0.32, 64]} />
            <meshBasicMaterial color={ringColour(d, palette.ring)} transparent opacity={!hood || hood.has(d.id) ? 0.9 : dim} visible={!hidden(d.id)} depthWrite={false} toneMapped={false} />
          </mesh>
        </Billboard>
      ))}
      {nodes.map((d, i) => d.type === 'Tool' && d.attrs?.approved === false && (
        <Billboard key={`na-${d.id}`} position={pos.get(d.id)}>
          <Line points={RING_PTS} color="#f59e0b" lineWidth={1} dashed dashSize={0.12} gapSize={0.1} transparent opacity={!hood || hood.has(d.id) ? 0.95 : dim} visible={!hidden(d.id)} scale={sizes[i] * 1.75} />
        </Billboard>
      ))}
      {nodes.map((d) => {
        const lit = !hood || hood.has(d.id);
        const show = wantsLabel(labels, d, deg.get(d.id) ?? 0, { hover: d.id === hoverId, picked: d.id === selectedId || !!picked?.has(d.id), inView: hood !== null && hood.has(d.id) });
        if (!show || hidden(d.id)) return null;
        return (
          <Html key={`l-${d.id}`} position={pos.get(d.id)} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }} {...(lite ? LITE_LABEL : {})}>
            <div ref={(el) => { if (el) labelEls.current.set(d.id, el); else { labelEls.current.delete(d.id); labelBox.current.delete(d.id); } }} className={`star-label t-${d.type}${lit ? '' : ' dim'}${d.id === hoverId || d.id === selectedId || picked?.has(d.id) ? ' hot' : ''}`}>
              <div className="l1" title={d.label}>{starLabel(d.label)}</div>
              {d.type === 'Idea' && <div className="l2">{d.attrs?.closed ? `Closed · ${d.attrs.closed}` : String(d.attrs?.stageLabel ?? '')}</div>}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
