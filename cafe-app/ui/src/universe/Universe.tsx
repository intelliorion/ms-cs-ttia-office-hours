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
import { readCamera, saveCamera } from './viewMemory';
import { frameWatch, probeGl } from './quality';
import type { Quality } from '../state/store';
import { DIM, bounds, degrees, dimFromHide, frameOf, litKey, neighbourhood, paletteFor, type Graph, type LabelMode, type Vec3 } from './graphView';
import { Snowfall } from './Snowfall';
import { DraftingTable } from './DraftingTable';
import { Workshop } from './Workshop';

export interface UniverseProps {
  graph: Graph;
  layout: Record<string, Vec3>;
  selectedId: string | null;
  /** Stars an answer rests on: lit, with the links between them, the rest dimmed. A selected star wins. */
  highlight?: string[] | null;
  /** How much of the universe outside a highlight is hidden, 0.5 to 1 (1: only what is in view shows). */
  hideUnlit?: number;
  hoverId: string | null;
  labels: LabelMode;
  /** Focus mode: the graph fits the whole stage instead of the centre gap. */
  focus?: boolean;
  /** Bumped by Reset view. */
  viewNonce?: number;
  onSelect: (id: string | null, additive?: boolean) => void;
  /** Two or more stars picked with Ctrl/⌘+click. */
  selectedIds?: string[];
  onHover: (id: string | null) => void;
  /** Full (bloom), Lite (no post-processing, soft halos) or Flat (the 2D map). Default full. */
  quality?: Quality;
  /** Told the WebGL renderer name once, before the first frame, so a software renderer can start in Lite. */
  onProbe?: (renderer: string | null) => void;
  /** Watch the frame rate in Full and call onSlow once if it averages under 20 fps. */
  watchFps?: boolean;
  onSlow?: () => void;
  /** 'default' (night sky) or 'frost' (baubles on a light winter morning). */
  theme?: string;
  /** What a chat change just did: these stars and threads pulse for a moment. No selection, no camera move. */
  flash?: { nodes: string[]; edges: string[] } | null;
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
  const flashAttrs = { 'data-flash-stars': props.flash?.nodes.join(' ') || undefined, 'data-flash-threads': props.flash?.edges.join(' ') || undefined };
  if (!webgl || quality === 'flat') return <div className="universe flat" data-quality={webgl ? 'flat' : 'no-webgl'} {...flashAttrs}><Flat2D {...props} /></div>;
  if (!probed) return <div className="universe" data-testid="universe" />;
  return (
    <div
      className="universe" data-testid="universe" data-quality={quality} style={{ cursor: cursor ? 'pointer' : 'default' }}
      {...flashAttrs}
      onPointerDown={(e) => { down.current = { x: e.clientX, y: e.clientY }; }}
    >
      <Canvas
        key={`${quality}-${props.theme ?? 'default'}` /* the context options differ, so a new quality or theme makes a new canvas; it starts where the camera was (viewMemory) */}
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

function Scene({ graph, layout, selectedId, selectedIds = [], highlight = null, hideUnlit, hoverId, labels, focus = false, viewNonce = 0, onSelect, onHover, quality = 'full', watchFps = false, onSlow, theme, flash = null }: UniverseProps) {
  const palette = paletteFor(theme);
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
  // What is in view: an answer's lit stars win (they are the newest thing asked for), else the selected star and its links.
  const pickedSet = useMemo(() => (selectedIds.length >= 2 ? new Set(selectedIds) : null), [selectedIds]);
  // Several stars picked: each with its links, so what they share shows.
  const multi = useMemo(() => (selectedIds.length >= 2 ? new Set(selectedIds.flatMap((id) => [...neighbourhood(graph, id)])) : null), [graph, selectedIds]);
  const hood = useMemo(() => lit ?? multi ?? (selectedId ? neighbourhood(graph, selectedId) : null), [graph, selectedId, lit, multi]);
  // A chat change: its stars and threads pulse where they are; a changed star stays in view even outside the selection's.
  const flashStars = useMemo(() => (flash?.nodes.length ? new Set(flash.nodes) : null), [flash]);
  const flashThreads = useMemo(() => (flash?.edges.length ? new Set(flash.edges) : null), [flash]);
  const starHood = useMemo(() => (hood && flashStars ? new Set([...hood, ...flashStars]) : hood), [hood, flashStars]);
  // The bottom bar's slider sets how much of the rest is hidden, for either.
  const dim = hood && hideUnlit !== undefined ? dimFromHide(hideUnlit) : DIM;

  const spin = useRef<Group>(null);
  const lastDown = useRef(-Infinity);
  const { camera, gl, controls } = useThree();
  const { flyTo, flyHome } = useFlyTo(home);

  // First frame: the camera where the operator left it (a new theme or quality makes a new canvas), else home.
  const flown = useRef<string | null>(null);
  const restored = useRef(false);
  useEffect(() => {
    const c = controls as unknown as { target: Vector3; update: () => void } | null;
    const m = restored.current ? undefined : readCamera();
    if (m) {
      camera.position.set(...m.position); camera.lookAt(new Vector3(...m.target));
      if (spin.current) spin.current.rotation.y = m.spin;
      // The star it was looking at is already in view: no fly to it again.
      if (m.selectedId && m.selectedId === selectedId) flown.current = selectedId;
      if (c) { c.target.set(...m.target); c.update(); restored.current = true; }
      return;
    }
    if (restored.current) return;
    camera.position.copy(home.position); camera.lookAt(home.target);
    if (c) { c.target.copy(home.target); c.update(); restored.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, home]);

  useEffect(() => {
    const el = gl.domElement;
    const on = () => { lastDown.current = performance.now(); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('wheel', on, { passive: true });
    return () => { el.removeEventListener('pointerdown', on); el.removeEventListener('wheel', on); };
  }, [gl]);

  // Fly to the selected star, once per selection: a refreshed graph keeps the camera where it is.
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

  // A new highlight (an answer's evidence, or Light them): one smooth move to frame its stars. A redraw, a new canvas
  // (theme, quality) or Clear does not move the camera.
  const flownLit = useRef(litKey(highlight));
  useEffect(() => {
    const key = litKey(highlight);
    if (key === flownLit.current) return;
    flownLit.current = key;
    if (!key || !spin.current) return;
    const frame = frameOf((highlight ?? []).map((id) => pos.get(id)).filter((p): p is Vec3 => !!p));
    if (!frame) return;
    spin.current.updateMatrixWorld();
    flyTo(spin.current.localToWorld(new Vector3(...frame.centre)), frame.distance);
  }, [highlight, pos, flyTo]);

  // Reset view.
  // Only when the button bumps the count: flyHome itself changes once the controls attach, and that is not a reset.
  const nonce = useRef(viewNonce);
  useEffect(() => { if (nonce.current === viewNonce) return; nonce.current = viewNonce; flyHome(); }, [viewNonce, flyHome]);

  // The fps watchdog (Full only): one verdict over the first few seconds of frames.
  const watch = useMemo(() => (watchFps ? frameWatch() : null), [watchFps]);
  useFrame((_, dt) => {
    if (watch && typeof document !== 'undefined' && document.visibilityState === 'visible' && watch(dt * 1000) === 'slow') onSlow?.();
  });

  // Remember where the camera is, for the next canvas.
  useFrame(() => {
    const c = controls as unknown as { target: Vector3 } | null;
    if (!restored.current || !c || !spin.current) return;
    const r = (v: number) => Math.round(v * 100) / 100;
    saveCamera({
      position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
      target: [r(c.target.x), r(c.target.y), r(c.target.z)], spin: Math.round(spin.current.rotation.y * 1e4) / 1e4, selectedId,
    });
  });
  useFrame((_, dt) => {
    // Still while a star is selected or an answer is lit, so what is in view stays in view.
    if (!spin.current || selectedId || lit) return;
    if (performance.now() - lastDown.current < IDLE_AFTER_MS) return;
    spin.current.rotation.y += SPIN * Math.min(dt, 0.1);
  });

  return (
    <>
      {palette.workshop
        ? <Workshop floorY={-radius * 1.3} reach={radius * 4.5} />
        : palette.blueprint
        ? <DraftingTable floorY={-radius * 1.3} reach={radius * 4.5} />
        : palette.frost
        ? <Snowfall floorY={-radius * 1.3} reach={radius * 4.5} lite={lite} />
        : <><Backdrop floorY={-radius * 1.3} reach={radius * 4.5} lite={lite} /><ambientLight intensity={0.2} /></>}
      <group ref={spin}>
        <Links edges={graph.edges} pos={pos} selectedId={lit || multi ? null : selectedId} lit={lit ?? multi} dim={dim} lite={lite} palette={palette} hood={lit || multi ? null : hood} flash={flashThreads} />
        <Stars nodes={nodes} pos={pos} deg={deg} hood={starHood} flash={flashStars} dim={dim} selectedId={selectedId} picked={pickedSet} hoverId={hoverId} labels={labels} focus={focus} lite={lite} palette={palette} onSelect={onSelect} onHover={onHover} />
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
      {/* Bloom makes light glow, which only works on dark: Frost has none. */}
      {!lite && !palette.frost && !palette.blueprint && !palette.workshop && (
        <EffectComposer multisampling={4}>
          <Bloom intensity={1.1} luminanceThreshold={0.2} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}
