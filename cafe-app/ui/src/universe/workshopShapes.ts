import { BoxGeometry, ExtrudeGeometry, Path, Shape } from 'three';

/** Workshop: every star is a gear with this many teeth; tools are hammers. */
export const GEAR_TEETH = 10;

/** A gear's outline as [x, y] points (radius 1): flat-topped teeth on a root circle. */
export function gearOutline(teeth = GEAR_TEETH, outer = 1, root = 0.78): [number, number][] {
  const pts: [number, number][] = [];
  const step = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    for (const [f, r] of [[0, root], [0.12, outer], [0.42, outer], [0.54, root]] as const) {
      pts.push([Math.cos(a + f * step) * r, Math.sin(a + f * step) * r]);
    }
  }
  return pts;
}

/** The gear as a solid with a hole, centred, about 0.36 thick, for an instanced mesh. */
export function gearGeometry(): ExtrudeGeometry {
  const pts = gearOutline();
  const s = new Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  const hole = new Path(); hole.absarc(0, 0, 0.3, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new ExtrudeGeometry(s, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 1, curveSegments: 16 });
  g.center();
  return g;
}

/** A hammer in two parts, unit size: the wooden handle and the steel head, each placed by its own local offset. */
export const HAMMER = {
  handle: () => new BoxGeometry(0.2, 1.7, 0.2).translate(0, -0.15, 0),
  head: () => new BoxGeometry(1.0, 0.34, 0.34).translate(0.12, 0.78, 0),
  /** Leaning, so it reads as a hammer and not a T. */
  tilt: -0.45,
};

/** Flat: the gear as an SVG path at (cx, cy), radius r, with its centre hole. */
export function gearPath(cx: number, cy: number, r: number, teeth = GEAR_TEETH, turn = 0): string {
  const pts = gearOutline(teeth).map(([x, y]) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    return [cx + (x * c - y * s) * r, cy + (x * s + y * c) * r];
  });
  const outline = `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
  const h = r * 0.3;
  return `${outline} M${(cx + h).toFixed(1)},${cy.toFixed(1)} a${h.toFixed(1)},${h.toFixed(1)} 0 1,0 ${(-2 * h).toFixed(1)},0 a${h.toFixed(1)},${h.toFixed(1)} 0 1,0 ${(2 * h).toFixed(1)},0Z`;
}
