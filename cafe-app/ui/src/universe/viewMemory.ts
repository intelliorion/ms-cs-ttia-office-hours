/**
 * Where the operator left the picture: the 3D camera (position, what it looks at, the slow spin) and the Flat zoom and pan.
 * Kept in this browser, so a new theme or quality (which makes a new canvas) and a reload start where the operator was.
 * Reset view flies home, and home is then what is remembered.
 */
export type Triple = [number, number, number];
export interface Camera3d { position: Triple; target: Triple; spin: number; selectedId: string | null }
export interface FlatView { k: number; x: number; y: number }
interface Memory { camera?: Camera3d; flat?: FlatView }

const KEY = 'cafe-view';
const SAVE_EVERY_MS = 800;
let memory: Memory | null = null;
let saved = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const finite = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => Number.isFinite(x));

function load(): Memory {
  if (memory) return memory;
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Memory;
    memory = {
      ...(m.camera && finite(m.camera.position, 3) && finite(m.camera.target, 3) && Number.isFinite(m.camera.spin)
        ? { camera: { ...m.camera, selectedId: typeof m.camera.selectedId === 'string' ? m.camera.selectedId : null } } : {}),
      ...(m.flat && finite([m.flat.k, m.flat.x, m.flat.y], 3) && m.flat.k > 0 ? { flat: m.flat } : {}),
    };
  } catch { memory = {}; }
  return memory;
}

const write = () => {
  if (timer) clearTimeout(timer);
  timer = null; saved = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(memory ?? {})); } catch { /* storage unavailable */ }
};
/** Write anything still waiting now (the page is closing or reloading). */
export function flushView() { if (timer) write(); }
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushView);

/** Write at most every SAVE_EVERY_MS: the camera moves every frame. */
function persist() {
  if (timer) return;
  const wait = SAVE_EVERY_MS - (Date.now() - saved);
  if (wait <= 0) write(); else timer = setTimeout(write, wait);
}

export const readCamera = (): Camera3d | undefined => load().camera;
export function saveCamera(c: Camera3d) {
  const old = load().camera;
  if (old && old.spin === c.spin && old.selectedId === c.selectedId && old.position.every((v, i) => v === c.position[i]) && old.target.every((v, i) => v === c.target[i])) return;
  memory = { ...load(), camera: c }; persist();
}
export const readFlat = (): FlatView | undefined => load().flat;
export function saveFlat(v: FlatView) { memory = { ...load(), flat: v }; persist(); }
/** Tests only. */
export function _resetViewMemory() { memory = null; saved = 0; if (timer) clearTimeout(timer); timer = null; }
