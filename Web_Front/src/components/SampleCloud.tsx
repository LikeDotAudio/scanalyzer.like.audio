import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { musicProdCategory, subKey, ucsColor, ucsSubColor, taxonomyKeys } from '../groupColors'
import type { Taxonomy } from '../groupColors'

// Feature registry: label → how to read it. Numeric features are normalized
// across the dataset; categorical ones are spread into bands. Mirrors the
// desktop graph tab's ISO_FEATURES.
type Feature = { categorical?: boolean; get: (it: any) => number | string };
export const CLOUD_FEATURES: Record<string, Feature> = {
  Group: { categorical: true, get: (it) => it.classification?.group || 'Unclassified' },
  Subgroup: { categorical: true, get: (it) => it.classification?.subgroup || '—' },
  Timbre: { categorical: true, get: (it) => it.classification?.timbre || '?' },
  Length: { get: (it) => it.metadata?.length_seconds ?? 0 },
  Complexity: { get: (it) => it.spectral_features?.complexity ?? 0 },
  'Brightness (centroid)': { get: (it) => it.spectral_features?.spectral_centroid_hz ?? 0 },
  Harmonicity: { get: (it) => it.spectral_features?.harmonicity ?? 0 },
  Sustain: { get: (it) => it.envelope?.envelope_sustain_level ?? 0 },
  Attack: { get: (it) => it.envelope?.attack_seconds ?? 0 },
  Pitch: { get: (it) => it.musicality?.pitch_hz ?? 0 },
  BPM: { get: (it) => it.musicality?.beats_per_minute ?? 0 },
  RMS: { get: (it) => it.spectral_features?.root_mean_square_level ?? 0 },
  ZCR: { get: (it) => it.spectral_features?.zero_crossings_per_second ?? 0 },
};

export const AXIS_OPTIONS = Object.keys(CLOUD_FEATURES);
export const SIZE_OPTIONS = Object.entries(CLOUD_FEATURES)
  .filter(([, f]) => !f.categorical)
  .map(([label]) => label);
// UCS is the only taxonomy the cloud speaks. Category = hue, Subcategory = shade within it.
export const COLOR_OPTIONS = ['UCS Category', 'UCS Subcategory'];
export const SHAPE_OPTIONS = ['Instrument', 'Timbre', 'Uniform'];

const SPAN = 30; // world units each axis is spread over

// Deterministic jitter in [-1,1] from an integer index (stable across renders).
function jitter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function makeAxis(data: any[], label: string): (it: any, i: number) => number {
  const f = CLOUD_FEATURES[label];
  if (!f) return () => 0;
  if (f.categorical) {
    const cats = Array.from(new Set(data.map((it) => f.get!(it)))).sort();
    const n = Math.max(1, cats.length - 1);
    return (it, i) => ((cats.indexOf(f.get!(it)) / n) - 0.5) * SPAN + jitter(i) * 1.4;
  }
  let mn = Infinity, mx = -Infinity;
  for (const it of data) {
    const v = Number(f.get(it));
    if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const range = mx - mn || 1;
  return (it) => {
    const v = Number(f.get(it));
    const nv = Number.isFinite(v) ? (v - mn) / range : 0.5;
    return (nv - 0.5) * SPAN;
  };
}

function makeSize(data: any[], label: string): (it: any) => number {
  const f = CLOUD_FEATURES[label];
  if (!f || f.categorical) return () => 0.7;
  let mn = Infinity, mx = -Infinity;
  for (const it of data) {
    const v = Number(f.get(it));
    if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const range = mx - mn || 1;
  return (it) => {
    const v = Number(f.get(it));
    const nv = Number.isFinite(v) ? (v - mn) / range : 0.5;
    return 0.35 + nv * 1.6;
  };
}

function colorFor(item: any, colorBy: string): string {
  // The UCS taxonomy (82 categories, scored per file) — hue = parent category,
  // shade = subcategory. Distinct from the god categories, which are six
  // envelope buckets over the drum-pack name groups.
  if (colorBy === 'UCS Subcategory') {
    return ucsSubColor(item.ucs?.category || '', item.ucs?.subcategory || '');
  }
  // Default and 'UCS Category': hue by UCS category.
  return ucsColor(item.ucs?.category || '');
}

function getShapeFor(it: any, shapeBy: string): string {
  if (shapeBy === 'Uniform') return 'sphere';

  const g = (it.classification?.group || '').toLowerCase();
  // Not a scope taxonomy — just a shape heuristic. Instrument-family shapes lean on the
  // production role where the group name is ambiguous.
  const role = it.classification?.music_production_category
    || musicProdCategory(it.classification?.group || '');
  const t = (it.classification?.timbre || '').toLowerCase();
  const transient_count = it.envelope?.transient_count ?? 0;

  if (shapeBy === 'Timbre') {
    if (t === 'percussive') return 'pyramid';
    if (t === 'loop') return 'torus';
    if (t === 'bass') return 'cylinder';
    if (t === 'tonal') return 'cube';
    if (t === 'noise') return 'diamond';
    if (t === 'bright') return 'icosahedron';
    if (t === 'pad') return 'dodecahedron';
    return 'sphere';
  }

  // Instrument (default)
  if (g.includes('kick') || g.includes('snare') || g.includes('tom') || g.includes('clap')) return 'cylinder';
  if (g.includes('cymbal') || g.includes('hi-hat') || g.includes('ride') || g.includes('crash') || g.includes('hihat')) return 'disc';
  if (g === 'ir' || role === 'IMPULSE RESPONSE') return 'diamond';
  if (g === 'perc' || role === 'PERCUSSION' || role === 'PERCUSSION TUNED' || role === 'SHAKEN') return 'pyramid';
  if (transient_count > 1 || role === 'LOOP' || role === 'EXPERIMENTAL' || g.includes('loop') || g === 'fx') return 'torus';
  if (g === 'bass' || g.includes('synth') || role === 'SYNTHESIZED' || role === 'KEYED' || role === 'INSTRUMENT') return 'cube';
  if (g === 'voice' || g.includes('voice') || role === 'PERFORMANCE') return 'icosahedron';
  return 'sphere'; // default for unclassified
}

// 3D axis lines through the origin + DOM labels at their ends.
function Axes({ xLabel, yLabel, zLabel }: { xLabel: string; yLabel: string; zLabel: string }) {
  const L = SPAN / 2 + 2;
  const label: React.CSSProperties = { fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none', textShadow: '0 0 3px #000' };
  return (
    <group>
      <Line points={[[-L, 0, 0], [L, 0, 0]]} color="#f4902c" lineWidth={1} transparent opacity={0.4} />
      <Line points={[[0, -L, 0], [0, L, 0]]} color="#0ea5e9" lineWidth={1} transparent opacity={0.4} />
      <Line points={[[0, 0, -L], [0, 0, L]]} color="#aaaaaa" lineWidth={1} transparent opacity={0.4} />
      <Html position={[L + 1, 0, 0]} center><span style={{ ...label, color: '#f4902c' }}>X · {xLabel}</span></Html>
      <Html position={[0, L + 1, 0]} center><span style={{ ...label, color: '#0ea5e9' }}>Y · {yLabel}</span></Html>
      <Html position={[0, 0, L + 1]} center><span style={{ ...label, color: '#cbd5e1' }}>Z · {zLabel}</span></Html>
    </group>
  );
}

interface CloudProps {
  data: any[];
  xAxis: string; yAxis: string; zAxis: string; sizeAxis: string; colorBy: string; shapeBy: string;
  hiddenGroups: Set<string>;
  selectedIndex: number | null;
  onPick: (index: number) => void;
  playing: boolean;
}

interface ShapeData {
  positions: [number, number, number][];
  colors: THREE.Color[];
  sizes: number[];
  origIndex: number[];
}

function ShapeMesh({ shape, sData, hiddenGroups, allData, taxonomy, onPick }: { shape: string, sData: ShapeData, hiddenGroups: Set<string>, allData: any[], taxonomy: Taxonomy, onPick: (i: number) => void }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || sData.positions.length === 0) return;
    for (let i = 0; i < sData.positions.length; i++) {
      const origIdx = sData.origIndex[i];
      const [x, y, z] = sData.positions[i];
      const origIt = allData[origIdx];
      const [g, sg] = taxonomyKeys(origIt, taxonomy);
      const hidden = hiddenGroups.has(g) || (!!sg && hiddenGroups.has(subKey(g, sg)));
      
      dummy.position.set(x, y, z);
      if (shape === 'pyramid') dummy.rotation.set(Math.PI/2, Math.PI/4, 0);
      else if (shape === 'diamond' || shape === 'cube' || shape === 'icosahedron' || shape === 'dodecahedron') dummy.rotation.set(Math.PI/4, 0, Math.PI/4);
      else if (shape === 'cylinder' || shape === 'disc' || shape === 'torus') dummy.rotation.set(Math.PI/2, 0, 0);
      else dummy.rotation.set(0, 0, 0);

      dummy.scale.setScalar(hidden ? 0.0001 : sData.sizes[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, sData.colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [sData, hiddenGroups, allData, dummy, shape, taxonomy]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) onPick(sData.origIndex[e.instanceId]);
  };

  if (sData.positions.length === 0) return null;

  let geom;
  if (shape === 'cylinder') geom = <cylinderGeometry args={[0.5, 0.5, 0.9, 16]} />;
  else if (shape === 'disc') geom = <cylinderGeometry args={[0.6, 0.6, 0.15, 16]} />;
  else if (shape === 'diamond') geom = <octahedronGeometry args={[0.6, 0]} />;
  else if (shape === 'pyramid') geom = <coneGeometry args={[0.6, 0.9, 4]} />;
  else if (shape === 'cube') geom = <boxGeometry args={[0.8, 0.8, 0.8]} />;
  else if (shape === 'torus') geom = <torusGeometry args={[0.5, 0.2, 12, 16]} />;
  else if (shape === 'icosahedron') geom = <icosahedronGeometry args={[0.6, 0]} />;
  else if (shape === 'dodecahedron') geom = <dodecahedronGeometry args={[0.55, 0]} />;
  else geom = <sphereGeometry args={[0.5, 10, 10]} />;

  return (
    <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, sData.positions.length]} onClick={handleClick}>
      {geom}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function CloudPoints({ data, xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy, hiddenGroups, selectedIndex, onPick, playing }: CloudProps) {
  const count = data.length
  // UCS is the only taxonomy the cloud speaks.
  const taxonomy = 'UCS' as const;

  const { shapeData, allPositions, selectedSize, selectedShape } = useMemo(() => {
    const xf = makeAxis(data, xAxis);
    const yf = makeAxis(data, yAxis);
    const zf = makeAxis(data, zAxis);
    const sf = makeSize(data, sizeAxis);
    
    const shapes: Record<string, ShapeData> = {
      sphere: { positions: [], colors: [], sizes: [], origIndex: [] },
      cylinder: { positions: [], colors: [], sizes: [], origIndex: [] },
      disc: { positions: [], colors: [], sizes: [], origIndex: [] },
      diamond: { positions: [], colors: [], sizes: [], origIndex: [] },
      pyramid: { positions: [], colors: [], sizes: [], origIndex: [] },
      cube: { positions: [], colors: [], sizes: [], origIndex: [] },
      torus: { positions: [], colors: [], sizes: [], origIndex: [] },
      icosahedron: { positions: [], colors: [], sizes: [], origIndex: [] },
      dodecahedron: { positions: [], colors: [], sizes: [], origIndex: [] },
    };

    const allPositions: [number, number, number][] = [];
    let selectedSize = 0.7;
    let selectedShape = 'sphere';

    for (let i = 0; i < count; i++) {
      const it = data[i];
      const pos: [number, number, number] = [xf(it, i), yf(it, i), zf(it, i)];
      allPositions.push(pos);
      
      const shape = getShapeFor(it, shapeBy);
      const sh = shapes[shape];
      sh.positions.push(pos);
      sh.colors.push(new THREE.Color(colorFor(it, colorBy)));
      const size = sf(it);
      sh.sizes.push(size);
      sh.origIndex.push(i);

      if (i === selectedIndex) {
        selectedSize = size;
        selectedShape = shape;
      }
    }
    return { shapeData: shapes, allPositions, selectedSize, selectedShape };
  }, [data, count, xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy, selectedIndex]);



  // Arrow keys move the selection to the nearest point in that screen direction.
  const { camera } = useThree();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (selectedIndex == null || selectedIndex >= allPositions.length) return;
      e.preventDefault();
      const sel = new THREE.Vector3(...allPositions[selectedIndex]).project(camera);
      const p = new THREE.Vector3();
      let best = -1, bestScore = Infinity;
      for (let i = 0; i < allPositions.length; i++) {
        if (i === selectedIndex) continue;
        const [g, sg] = taxonomyKeys(data[i], taxonomy);
        if (hiddenGroups.has(g) || (sg && hiddenGroups.has(subKey(g, sg)))) continue;
        p.set(...allPositions[i]).project(camera);
        const dx = p.x - sel.x, dy = p.y - sel.y;
        let along = 0, perp = 0;
        if (e.key === 'ArrowRight') { along = dx; perp = Math.abs(dy); }
        else if (e.key === 'ArrowLeft') { along = -dx; perp = Math.abs(dy); }
        else if (e.key === 'ArrowUp') { along = dy; perp = Math.abs(dx); }
        else { along = -dy; perp = Math.abs(dx); }
        if (along <= 0 || perp > along) continue; // outside a 45° cone toward the key
        const score = Math.hypot(dx, dy);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) onPick(best);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allPositions, selectedIndex, hiddenGroups, data, onPick, camera, taxonomy]);

  // The wireframe highlight over the selected point. While its sample is playing
  // it breathes — scale + opacity swing on a ~1.6 Hz sine — so the cloud shows,
  // not just the top-left readout, which dot you're hearing. Idle, it sits static.
  const selMeshRef = useRef<THREE.Mesh>(null!);
  const baseScaleRef = useRef(1);
  useFrame(({ clock }) => {
    const m = selMeshRef.current;
    if (!m) return;
    const base = baseScaleRef.current;
    if (playing) {
      const s = 0.5 + 0.5 * Math.sin(clock.getElapsedTime() * 10);
      m.scale.setScalar(base * (1 + 0.35 * s));
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat) mat.opacity = 0.5 + 0.45 * s;
    } else {
      m.scale.setScalar(base);
      const mat = m.material as THREE.MeshBasicMaterial;
      if (mat) mat.opacity = 0.9;
    }
  });

  if (count === 0) return null;

  const selPos = selectedIndex != null && selectedIndex < allPositions.length ? allPositions[selectedIndex] : null;
  baseScaleRef.current = (selectedSize || 0.7) * 0.5 + 0.6;

  let selGeom;
  if (selectedShape === 'cylinder') selGeom = <cylinderGeometry args={[0.6, 0.6, 1.1, 16]} />;
  else if (selectedShape === 'disc') selGeom = <cylinderGeometry args={[0.7, 0.7, 0.2, 16]} />;
  else if (selectedShape === 'diamond') selGeom = <octahedronGeometry args={[0.7, 0]} />;
  else if (selectedShape === 'pyramid') selGeom = <coneGeometry args={[0.7, 1.1, 4]} />;
  else if (selectedShape === 'cube') selGeom = <boxGeometry args={[1.0, 1.0, 1.0]} />;
  else if (selectedShape === 'torus') selGeom = <torusGeometry args={[0.6, 0.25, 12, 16]} />;
  else if (selectedShape === 'icosahedron') selGeom = <icosahedronGeometry args={[0.7, 0]} />;
  else if (selectedShape === 'dodecahedron') selGeom = <dodecahedronGeometry args={[0.65, 0]} />;
  else selGeom = <sphereGeometry args={[0.6, 12, 12]} />;

  const meshRot = (shape: string): [number, number, number] => {
    if (shape === 'pyramid') return [Math.PI/2, Math.PI/4, 0];
    if (shape === 'diamond' || shape === 'cube' || shape === 'icosahedron' || shape === 'dodecahedron') return [Math.PI/4, 0, Math.PI/4];
    if (shape === 'cylinder' || shape === 'disc' || shape === 'torus') return [Math.PI/2, 0, 0];
    return [0, 0, 0];
  };

  return (
    <>
      {Object.entries(shapeData).map(([shape, sData]) => (
        <ShapeMesh key={shape} shape={shape} sData={sData} hiddenGroups={hiddenGroups} allData={data} taxonomy={taxonomy} onPick={onPick} />
      ))}
      {selPos && (
        <mesh ref={selMeshRef} position={selPos} rotation={meshRot(selectedShape)} scale={baseScaleRef.current}>
          {selGeom}
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

interface SampleCloudProps {
  data?: any[];
  xAxis?: string; yAxis?: string; zAxis?: string; sizeAxis?: string; colorBy?: string; shapeBy?: string;
  hiddenGroups?: Set<string>;
  selectedIndex?: number | null;
  onPick?: (index: number) => void;
  showAxes?: boolean;
  playing?: boolean;
}

export default function SampleCloud({
  data = [], xAxis = 'Pitch', yAxis = 'Group', zAxis = 'Complexity',
  sizeAxis = 'Length', colorBy = 'Group', shapeBy = 'Instrument', hiddenGroups = new Set(),
  selectedIndex = null, onPick = () => {}, showAxes = true, playing = false,
}: SampleCloudProps) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0 }}>
      {data.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', zIndex: 10 }}>
          Upload a .PEAK file or scan a folder to visualize the cloud.
        </div>
      )}
      <Canvas camera={{ position: [0, 0, 45], fov: 60 }} raycaster={{ params: { Points: { threshold: 0.6 } } as any }}>
        <color attach="background" args={['#0B0E14']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 10, 10]} intensity={0.6} />
        {showAxes && <Axes xLabel={xAxis} yLabel={yAxis} zLabel={zAxis} />}
        <CloudPoints
          data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
          sizeAxis={sizeAxis} colorBy={colorBy} shapeBy={shapeBy} hiddenGroups={hiddenGroups}
          selectedIndex={selectedIndex} onPick={onPick} playing={playing}
        />
        <OrbitControls enablePan enableZoom enableRotate autoRotate={false} />
      </Canvas>
    </div>
  )
}
