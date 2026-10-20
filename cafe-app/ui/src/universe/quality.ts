/** What the WebGL probe found: whether WebGL works, and the unmasked renderer name when the browser tells it. */
export interface GlProbe { webgl: boolean; renderer: string | null }

export function probeGl(): GlProbe {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return { webgl: false, renderer: null };
    let renderer: string | null = null;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null;
    } catch { /* no renderer name */ }
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // release the probe context at once
    return { webgl: true, renderer };
  } catch { return { webgl: false, renderer: null }; }
}

/**
 * The fps watchdog. Feed it frame times (ms); after a warm-up (shaders compile on the first frames) it averages
 * the next `windowMs` and says 'slow' when the average is over `slowMs`, else 'ok'. It answers once.
 * Frames over a second (a hidden tab, a debugger) are skipped.
 */
export function frameWatch({ warmup = 5, windowMs = 3000, slowMs = 50 } = {}) {
  let seen = 0, total = 0, count = 0, done = false;
  return (dtMs: number): 'slow' | 'ok' | null => {
    if (done) return null;
    if (seen++ < warmup || !(dtMs > 0) || dtMs > 1000) return null;
    total += dtMs; count++;
    if (total < windowMs) return null;
    done = true;
    return total / count > slowMs ? 'slow' : 'ok';
  };
}
