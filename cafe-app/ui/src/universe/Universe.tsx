import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Group, Vector3 } from 'three';
import { Backdrop } from './Backdrop';
import { Stars } from './Stars';
import { Links } from './Links';
import { Flat2D } from './Flat2D';
import { useFlyTo } from './useFlyTo';
import { frameWatch, probeGl } from './quality';
import type { Quality } from '../state/store';
import { DIM, bounds, degrees, dimFromHide, neighbourhood, type Graph, type Vec3 } from './graphView';

export interface UniverseProps {
  graph: Graph;
  layout: Record<string, Vec3>;
  selectedId: string | null;
  /** Stars an answer rests on: lit, with the links between them, the rest dimmed. A selected star wins. */
  highlight?: string[] | null;
  /** How much of the universe outside a highlight is hidden, 0.1 to 1 (1: only the lit stars show). */
  hideUnlit?: number;
  hoverId: string | null;
  labels: boolean;
  /** Focus mode: the graph fits the whole stage instead of the centre gap. */
  focus?: boolean;
  /** Bumped by Reset view. */
  viewNonce?: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Full (bloom), Lite (no post-processing, soft halos) or Flat (the 2D map). Default full. */
  quality?: Quality;
  /** Told the WebGL renderer name once, before the first frame, so a software renderer can start in Lite. */
  onProbe?: (renderer: string | null) => void;
  /** Watch the frame rate in Full and call onSlow once if it averages under 20 fps. */
  watchFps?: boolean;
  onSlow?: () => void;
}

const SPIN = 0.03; // rad/s while idle
const IDLE_AFTER_MS = 3000; // the slow spin resumes this long after the last click or wheel
const MAX_PAN = 400;

export function hasWebGL(): boolean { return probeGl().webgl; }

/**
 * Fixed camera framing: the graph fits the centre gap between the panels (x 480–1440 of 1920). Focus hides the panels
 * but keeps the same distance, so the whole graph stays in view with room around it.
 */
function homeFor(radius: number, _focus = false) {
  const d = Math.min(600, Math.max(60, radius * 2.85));
  return { position: new Vector3(0, 0.36, 1).normalize().multiplyScalar(d), target: new Vector3(0, -radius * 0.08, 0) };
}

export function Universe(input: UniverseProps) {
  // A selected star that is no longer in the graph (say its link was removed) clears the selection.
  const gone = !!input.selectedId && !input.graph.nodes.some((n) => n.id === input.selectedId);
  const { onSelect: select } = input;
  useEffect(() => { if (gone) select(null); }, [gone, select]);
  const props = gone ? { ...input, selectedId: null } : input;
  const empty = !props.graph.nodes.length;
  const [probe] = useState(probeGl);
  const webgl = probe.webgl;
  // Report the renderer before the canvas is made, so a first load on software graphics never builds Full first.
  const [probed, setProbed] = useState(false);
  const { onProbe } = props;
  useLayoutEffect(() => { if (webgl) onProbe?.(probe.renderer); setProbed(true); }, [webgl, probe.renderer, onProbe]);
  const [cursor, setCursor] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const onHover = (id: string | null) => { setCursor(!!id); props.onHover(id); };
  const quality = props.quality ?? 'full';
  const lite = quality === 'lite';
  if (!webgl || quality === 'flat') return <div className="universe flat" data-quality={webgl ? 'flat' : 'no-webgl'}><Flat2D {...props} /></div>;
  if (!probed) return <div className="universe" data-testid="universe" />;
  return (
    <div
      className="universe" data-testid="universe" data-quality={quality} style={{ cursor: cursor ? 'pointer' : 'default' }}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
    >
      <Canvas
        key={quality /* the context options differ, so a new quality makes a new canvas */}
        resize={{ offsetSize: true }}
        dpr={lite ? 1 : [1, 2]}
        gl={{ antialias: !lite, powerPreference: 'high-performance' }}
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
      {empty && <div className="flat2d-empty" data-testid="universe-empty" />}
    </div>
  );
}

function Scene({ graph, layout, selectedId, highlight = null, hideUnlit, hoverId, labels, focus = false, viewNonce = 0, onSelect, onHover, quality = 'full', watchFps = false, onSlow }: UniverseProps) {
  const lite = quality === 'lite';
  const { centre, radius } = useMemo(() => bounds(layout), [layout]);
  const home = useMemo(() => homeFor(radius, focus), [radius, focus]);
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
  const lit = useMemo(() => (highlight?.length ? new Set(highlight) : null), [highlight]);
  const hood = useMemo(() => (selectedId ? neighbourhood(graph, selectedId) : lit), [graph, selectedId, lit]);
  // The slider applies to a highlight only; a selected star keeps the usual dim.
  const dim = lit && !selectedId && hideUnlit !== undefined ? dimFromHide(hideUnlit) : DIM;

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

  // Fly to the selected star, once per selection: a refreshed graph keeps the camera where it is.
  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) { flown.current = null; return; }
    if (!spin.current || flown.current === selectedId) return;
    flown.current = selectedId;
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

  // The fps watchdog (Full only): one verdict over the first few seconds of frames.
  const watch = useMemo(() => (watchFps ? frameWatch() : null), [watchFps]);
  useFrame((_, dt) => {
    if (watch && typeof document !== 'undefined' && document.visibilityState === 'visible' && watch(dt * 1000) === 'slow') onSlow?.();
  });

  useFrame((_, dt) => {
    if (!spin.current || selectedId) return;
    if (performance.now() - lastDown.current < IDLE_AFTER_MS) return;
    spin.current.rotation.y += SPIN * Math.min(dt, 0.1);
  });

  return (
    <>
      <Backdrop floorY={-radius * 1.3} reach={radius * 4.5} lite={lite} />
      <ambientLight intensity={0.2} />
      <group ref={spin}>
        <Links edges={graph.edges} pos={pos} selectedId={selectedId} lit={selectedId ? null : lit} dim={dim} lite={lite} />
        <Stars nodes={nodes} pos={pos} deg={deg} hood={hood} dim={dim} selectedId={selectedId} hoverId={hoverId} labels={labels} focus={focus} lite={lite} onSelect={onSelect} onHover={onHover} />
      </group>
      <OrbitControls
        makeDefault enableDamping dampingFactor={0.08} rotateSpeed={0.55} zoomSpeed={0.7}
        minDistance={60} maxDistance={600}
        onChange={(e) => {
          const t = (e?.target as unknown as { target: Vector3 } | undefined)?.target;
          if (t && t.length() > MAX_PAN) t.setLength(MAX_PAN);
        }}
      />
      {/* Lite draws straight to the screen: no bloom passes, no multisampled buffers. */}
      {!lite && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}
