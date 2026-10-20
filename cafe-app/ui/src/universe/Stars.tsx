import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Html } from '@react-three/drei';
import { AdditiveBlending, Color, Group, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Material } from 'three';
import { DIM, NODE_COLOURS, labelAlways, phase, ringColour, starSize, type GNode, type Vec3 } from './graphView';
import { haloTexture } from './haloTexture';

export interface StarsProps {
  nodes: GNode[];
  pos: Map<string, Vec3>;
  deg: Map<string, number>;
  hood: Set<string> | null;
  selectedId: string | null;
  hoverId: string | null;
  labels: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

const HALO = 3; // halo diameter is 3× the star diameter
const tmpM = new Matrix4(); const tmpC = new Color(); const tmpQ = new Quaternion(); const tmpS = new Vector3(); const tmpP = new Vector3();
const dummy = new Object3D();
const tmpV = new Vector3(); const tmpW = new Vector3();
const TYPE_RANK: Record<string, number> = { Idea: 0, Team: 1, Entity: 2, Tool: 3, Capability: 4, System: 5, PainPoint: 6, Person: 7 };

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
export function Stars({ nodes, pos, deg, hood, selectedId, hoverId, labels, onSelect, onHover }: StarsProps) {
  const core = useRef<InstancedMesh>(null);
  const halo = useRef<InstancedMesh>(null);
  const hit = useRef<InstancedMesh>(null);
  const n = nodes.length;
  const sizes = useMemo(() => nodes.map((d) => starSize(d, deg.get(d.id) ?? 0)), [nodes, deg]);
  const base = useMemo(() => nodes.map((d) => new Color(NODE_COLOURS[d.type] ?? '#9fb0ae')), [nodes]);
  const phases = useMemo(() => nodes.map((d) => phase(d.id)), [nodes]);
  const hoverIndex = hoverId ? nodes.findIndex((d) => d.id === hoverId) : -1;
  const root = useRef<Group>(null);
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const labelBox = useRef(new Map<string, [number, number]>());
  const frame = useRef(0);
  const size = useThree((st) => st.size);

  useLayoutEffect(() => {
    nodes.forEach((d, i) => {
      const p = pos.get(d.id) ?? [0, 0, 0];
      dummy.position.set(...p); dummy.quaternion.identity();
      dummy.scale.setScalar(sizes[i]); dummy.updateMatrix();
      core.current!.setMatrixAt(i, dummy.matrix); core.current!.setColorAt(i, base[i]);
      dummy.scale.setScalar(Math.max(sizes[i] * 2.2, 4)); dummy.updateMatrix();
      hit.current!.setMatrixAt(i, dummy.matrix);
      halo.current!.setMatrixAt(i, dummy.matrix); halo.current!.setColorAt(i, base[i]);
    });
    for (const m of [core.current!, hit.current!, halo.current!]) {
      m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere();
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [nodes, pos, sizes, base]);

  useFrame(({ clock, camera }) => {
    const c = core.current, h = halo.current; if (!c || !h || !n) return; // no stars yet: nothing to light
    const t = clock.elapsedTime;
    // Halos face the camera: undo the parent group's rotation.
    h.parent!.getWorldQuaternion(tmpQ).invert().multiply(camera.quaternion);
    for (let i = 0; i < n; i++) {
      const id = nodes[i].id;
      const lit = !hood || hood.has(id);
      const twinkle = 1 + 0.1 * Math.sin(t * (0.6 + phases[i] * 0.9) + phases[i] * 6.283);
      const b = (lit ? 1 : DIM) * (i === hoverIndex || id === selectedId ? 1.4 : 1) * twinkle;
      c.setColorAt(i, tmpC.copy(base[i]).multiplyScalar(b));
      h.setColorAt(i, tmpC.copy(base[i]).multiplyScalar(b * (lit ? 0.85 : 0.5)));
      const p = pos.get(id)!;
      tmpS.setScalar(sizes[i] * 2 * HALO * (i === hoverIndex ? 1.15 : 1));
      h.setMatrixAt(i, tmpM.compose(tmpP.set(p[0], p[1], p[2]), tmpQ, tmpS));
    }
    c.instanceColor!.needsUpdate = true; h.instanceColor!.needsUpdate = true; h.instanceMatrix.needsUpdate = true;
    if (frame.current++ % 3 === 0) placeLabels(camera);
  });

  // Never cluttered: labels are placed in priority order and any that would overlap one already placed is hidden.
  const placeLabels = (camera: import('three').Camera) => {
    const g = root.current; if (!g) return;
    const rank = (id: string, type: string, i: number) =>
      (id === selectedId || id === hoverId ? -100 : 0) + (hood?.has(id) ? -50 : 0) + (TYPE_RANK[type] ?? 9) * 10 - sizes[i];
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
      const free = (b: Box) => !placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      const box = tmpV.z > 1 ? null : free(right) ? right : free(left) ? left : null;
      el.style.visibility = box ? 'visible' : 'hidden';
      el.classList.toggle('left', box === left);
      if (box) placed.push(box);
    }
  };

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : nodes[e.instanceId]?.id ?? null);

  return (
    <group ref={root}>
      <instancedMesh key={`core-${n}`} ref={core} args={[undefined, undefined, n]} frustumCulled={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color="#000000" emissive="#ffffff" emissiveIntensity={1.6} roughness={1} metalness={0} toneMapped={false} onUpdate={emissiveByInstance} />
      </instancedMesh>
      <instancedMesh key={`halo-${n}`} ref={halo} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={haloTexture()} transparent blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        key={`hit-${n}`} ref={hit} args={[undefined, undefined, n]}
        onPointerMove={(e) => { e.stopPropagation(); const id = pick(e); if (id !== hoverId) onHover(id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); if (e.delta > 5) return; const id = pick(e); if (id) onSelect(id); }}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial visible={false} />
      </instancedMesh>
      {nodes.map((d, i) => d.type === 'Idea' && (
        <Billboard key={d.id} position={pos.get(d.id)}>
          <mesh>
            <ringGeometry args={[sizes[i] * 1.75, sizes[i] * 1.75 + 0.32, 64]} />
            <meshBasicMaterial color={ringColour(d)} transparent opacity={!hood || hood.has(d.id) ? 0.9 : DIM} depthWrite={false} toneMapped={false} />
          </mesh>
        </Billboard>
      ))}
      {nodes.map((d) => {
        const lit = !hood || hood.has(d.id);
        const show = labels || labelAlways(d) || d.id === hoverId || (hood !== null && hood.has(d.id));
        if (!show) return null;
        return (
          <Html key={`l-${d.id}`} position={pos.get(d.id)} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div ref={(el) => { if (el) labelEls.current.set(d.id, el); else { labelEls.current.delete(d.id); labelBox.current.delete(d.id); } }} className={`star-label t-${d.type}${lit ? '' : ' dim'}${d.id === hoverId || d.id === selectedId ? ' hot' : ''}`}>
              <div className="l1" title={d.label}>{d.label}</div>
              {d.type === 'Idea' && <div className="l2">{d.attrs?.closed ? `Closed · ${d.attrs.closed}` : String(d.attrs?.stageLabel ?? '')}</div>}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
