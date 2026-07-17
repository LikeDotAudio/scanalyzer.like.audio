import { Component, type ReactNode } from 'react';

/** Whether the browser/webview can actually create a WebGL context. Some environments —
 *  headless runs, a sandboxed webview with the GPU disabled, hardware acceleration turned
 *  off — hand back no context, and three.js throws when it can't make a renderer. Checking
 *  first lets the 3D view degrade to a message instead of an uncaught error. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Free the probe context so it doesn't count against the browser's context limit.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

interface Props {
  /** What to show when a render error is caught. A function form receives the error and a
   *  retry callback, so the fallback can name the real failure instead of guessing. */
  fallback: ReactNode | ((error: Error, retry: () => void) => ReactNode);
  /** When this value changes while failed, the boundary retries the children. A crash
   *  caused by one dataset (e.g. a scope selection) must not permanently kill the tab —
   *  the next selection deserves a fresh attempt. */
  resetKey?: unknown;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Backstop for a throw inside the 3D subtree — a WebGL/three.js init failure that slips
 *  past the pre-check, or a plain rendering bug. Renders the fallback instead of taking
 *  down the app, and retries when `resetKey` changes or the fallback asks to. */
export class WebGLBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('WebGLBoundary caught an error:', error, info);
  }
  componentDidUpdate(prevProps: Props) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === 'function'
      ? fallback(error, () => this.setState({ error: null }))
      : fallback;
  }
}
