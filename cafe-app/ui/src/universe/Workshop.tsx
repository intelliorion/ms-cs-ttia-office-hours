import { Grid } from '@react-three/drei';
import { StudioEnvironment } from './Snowfall';

/** Mech: a dark robot workshop. A dim cyan scanning grid for a floor, cool key light, a cyan rim light, the studio
 *  reflected in the metal. Only the LEDs are bright enough to bloom. */
export function Workshop({ floorY, reach }: { floorY: number; reach: number }) {
  return (
    <>
      <color attach="background" args={['#101317']} />
      <fog attach="fog" args={['#101317', 460, 1250]} />
      <StudioEnvironment />
      <ambientLight intensity={0.25} />
      <directionalLight position={[160, 240, 200]} intensity={1.3} color="#e8eef4" />
      <pointLight position={[-220, 60, -160]} intensity={0.9} distance={900} color="#3ee6ff" />
      <Grid
        position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={Math.max(280, reach)} fadeFrom={0} fadeStrength={1.5}
        cellSize={12} cellThickness={0.5} cellColor="#163038" sectionSize={60} sectionThickness={1.1} sectionColor="#2a6878"
      />
    </>
  );
}
