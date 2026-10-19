import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Group, Vector3 } from 'three';
import { Backdrop } from './Backdrop';
import { Stars } from './Stars';
import { Links } from './Links';
import { Flat2D } from './Flat2D';
import { useFlyTo } from './useFlyTo';
import { bounds, degrees, neighbourhood, type Graph, type Vec3 } from './graphView';

export interface UniverseProps {
  graph: Graph;
  layout: Record<string, Vec3>;
  selectedId: string | null;
  hoverId: string | null;
  labels: boolean;
  /** Bumped by Reset view. */
  viewNonce?: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

const SPIN = 0.03; // rad/s while idle
const IDLE_AFTER_MS = 8000;
const MAX_PAN = 400;

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // release the probe context at once
    return !!gl;
  } catch { return false; }
}

/** Fixed camera framing: the graph fits the centre gap between the panels (x 480–1440 of 1920). */
function homeFor(radius: number) {
  const d = Math.min(600, Math.max(60, radius * 2.85));
  return { position: new Vector3(0, 0.36, 1).normalize().multiplyScalar(d), target: new Vector3(0, -radius * 0.08, 0) };
}

export function Universe(props: UniverseProps) {
  const [webgl] = useState(hasWebGL);
  const [cursor, setCursor] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const onHover = (id: string | null) => { setCursor(!!id); props.onHover(id); };
  if (!webgl) return <div className="universe flat"><Flat2D {...props} /></div>;
  return (
    <div
      className="universe" data-testid="universe" style={{ cursor: cursor ? 'pointer' : 'default' }}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
    >
      <Canvas
        resize={{ offsetSize: true }}
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 45, near: 1, far: 4000, position: [0, 120, 400] }}
        onPointerMissed={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; // a drag, not a click
          props.onSelect(null);
        }}
      >
        <Scene {...props} onHover={onHover} />
      </Canvas>
      <div className="universe-vignette" />
    </div>
  );
}

function Scene({ graph, layout, selectedId, hoverId, labels, viewNonce = 0, onSelect, onHover }: UniverseProps) {
  const { centre, radius } = useMemo(() => bounds(layout), [layout]);
  const home = useMemo(() => homeFor(radius), [radius]);
  const pos = useMemo(() => {
    const m = new Map<string, Vec3>();
    for (const n of graph.nodes) {
      const p = layout[n.id]; if (!p) continue;
      m.set(n.id, [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]]);
    }
    return m;
  }, [graph.nodes, layout, centre]);
  const nodes = useMemo(() => graph.nodes.filter((n) => pos.has(n.id)), [graph.nodes, pos]);
  const deg = useMemo(() => degrees(graph), [graph]);
  const hood = useMemo(() => (selectedId ? neighbourhood(graph, selectedId) : null), [graph, selectedId]);

  const spin = useRef<Group>(null);
  const lastDown = useRef(-Infinity);
  const { camera, gl, controls } = useThree();
  const { flyTo, flyHome } = useFlyTo(home);

  // First frame: put the camera home.
  useEffect(() => {
    camera.position.copy(home.position); camera.lookAt(home.target);
    const c = controls as unknown as { target: Vector3; update: () => void } | null;
    if (c) { c.target.copy(home.target); c.update(); }
  }, [camera, controls, home]);

  useEffect(() => {
    const el = gl.domElement;
    const on = () => { lastDown.current = performance.now(); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('wheel', on, { passive: true });
    return () => { el.removeEventListener('pointerdown', on); el.removeEventListener('wheel', on); };
  }, [gl]);

  // Fly to the selected star.
  useEffect(() => {
    if (!selectedId || !spin.current) return;
    const p = pos.get(selectedId); if (!p) return;
    spin.current.updateMatrixWorld();
    // At least 70 units away, and far enough back that the whole neighbourhood stays in view.
    const reach = Math.max(0, ...[...neighbourhood(graph, selectedId)].map((id) => {
      const q = pos.get(id); return q ? Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) : 0;
    }));
    flyTo(spin.current.localToWorld(new Vector3(...p)), Math.min(260, Math.max(70, reach * 2.1)));
  }, [selectedId, pos, flyTo, graph]);

  // Reset view.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } flyHome(); }, [viewNonce, flyHome]);

  useFrame((_, dt) => {
    if (!spin.current || selectedId) return;
    if (performance.now() - lastDown.current < IDLE_AFTER_MS) return;
    spin.current.rotation.y += SPIN * Math.min(dt, 0.1);
  });

  return (
    <>
      <Backdrop floorY={-radius * 1.3} reach={radius * 4.5} />
      <ambientLight intensity={0.2} />
      <group ref={spin}>
        <Links edges={graph.edges} pos={pos} selectedId={selectedId} />
        <Stars nodes={nodes} pos={pos} deg={deg} hood={hood} selectedId={selectedId} hoverId={hoverId} labels={labels} onSelect={onSelect} onHover={onHover} />
      </group>
      <OrbitControls
        makeDefault enableDamping dampingFactor={0.08} rotateSpeed={0.55} zoomSpeed={0.7}
        minDistance={60} maxDistance={600}
        onChange={(e) => {
          const t = (e?.target as unknown as { target: Vector3 } | undefined)?.target;
          if (t && t.length() > MAX_PAN) t.setLength(MAX_PAN);
        }}
      />
      <EffectComposer multisampling={4}>
        <Bloom intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.25} mipmapBlur />
      </EffectComposer>
    </>
  );
}
