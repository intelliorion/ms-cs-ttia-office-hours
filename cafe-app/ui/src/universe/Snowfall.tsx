import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { useLayoutEffect } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, PMREMGenerator, type Points } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Frost: how many flakes drift in the scene (Lite: a third). */
export const SNOW = { full: 260, lite: 90 };

let flake: CanvasTexture | null = null;
/** A six-armed snowflake, drawn once on a small canvas. */
function flakeTexture(): CanvasTexture {
  if (flake) return flake;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.translate(32, 32); g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineWidth = 3;
    for (let k = 0; k < 6; k++) {
      g.save(); g.rotate((k * Math.PI) / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26);
      g.moveTo(0, -14); g.lineTo(-7, -21); g.moveTo(0, -14); g.lineTo(7, -21);
      g.stroke(); g.restore();
    }
  }
  flake = new CanvasTexture(c);
  return flake;
}

/** A winter morning behind the baubles: pale sky, soft fog, a faint frosted floor and slowly falling snowflakes. */
export function Snowfall({ floorY, reach, lite = false }: { floorY: number; reach: number; lite?: boolean }) {
  const count = lite ? SNOW.lite : SNOW.full;
  const ref = useRef<Points>(null);
  const { geo, speed } = useMemo(() => {
    const p = new Float32Array(count * 3); const v = new Float32Array(count);
    // Deterministic scatter, so the scene looks the same on every load.
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < count; i++) {
      p[i * 3] = (rnd() - 0.5) * 900; p[i * 3 + 1] = (rnd() - 0.5) * 600; p[i * 3 + 2] = (rnd() - 0.5) * 900;
      v[i] = 4 + rnd() * 8;
    }
    const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(p, 3));
    return { geo, speed: v };
  }, [count]);
  useFrame(({ clock }, dt) => {
    const pts = ref.current; if (!pts) return;
    const a = pts.geometry.getAttribute('position') as BufferAttribute;
    const arr = a.array as Float32Array; const step = Math.min(dt, 0.1);
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speed[i] * step;
      arr[i * 3] += Math.sin(clock.elapsedTime * 0.3 + i) * 0.04;
      if (arr[i * 3 + 1] < -300) arr[i * 3 + 1] = 300;
    }
    a.needsUpdate = true;
  });
  return (
    <>
      <color attach="background" args={['#eef3f8']} />
      <fog attach="fog" args={['#eef3f8', 480, 1300]} />
      <FrostLight />
      <points ref={ref} geometry={geo} frustumCulled={false}>
        <pointsMaterial map={flakeTexture()} color="#9fb6cf" size={lite ? 9 : 7} sizeAttenuation transparent opacity={0.75} depthWrite={false} alphaTest={0.05} />
      </points>
      <Grid
        position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={Math.max(260, reach)} fadeFrom={0} fadeStrength={1.6}
        cellSize={12} cellThickness={0.5} cellColor="#dbe4ed" sectionSize={60} sectionThickness={1} sectionColor="#c2d1df"
      />
    </>
  );
}

/** Soft daylight plus a room reflected in the baubles' gloss (built in code: no image to download). */
function FrostLight() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pm = new PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const before = scene.environment;
    scene.environment = env;
    return () => { scene.environment = before; env.dispose(); pm.dispose(); };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={['#ffffff', '#c9d6e3', 0.9]} />
      <directionalLight position={[120, 260, 180]} intensity={1.1} />
    </>
  );
}
