import { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import gsap from 'gsap';

type Controls = { target: Vector3; update: () => void } | null;

/** Camera tweens: fly to a point (70 units away, looking at it) and fly home. */
export function useFlyTo(home: { position: Vector3; target: Vector3 }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls;

  const tween = useCallback((pos: Vector3, target: Vector3, duration = 0.9) => {
    if (!controls) return;
    gsap.killTweensOf(camera.position); gsap.killTweensOf(controls.target);
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power2.out' });
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, duration, ease: 'power2.out', onUpdate: () => controls.update() });
  }, [camera, controls]);

  const flyTo = useCallback((point: Vector3, distance = 70) => {
    if (!controls) return;
    const dir = camera.position.clone().sub(point);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    tween(point.clone().add(dir.normalize().multiplyScalar(distance)), point);
  }, [camera, controls, tween]);

  const flyHome = useCallback(() => tween(home.position, home.target, 1.1), [home, tween]);
  return { flyTo, flyHome };
}
