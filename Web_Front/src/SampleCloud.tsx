import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { groupColor, godColor, godCategory, subKey, ucsColor, ucsSubColor,
         taxonomyOf, taxonomyKeys } from './groupColors'
import type { Taxonomy } from './groupColors'

// Feature registry: label → how to read it. Numeric features are normalized
// across the dataset; categorical ones are spread into bands. Mirrors the
// desktop graph tab's ISO_FEATURES.
type Feature = { categorical?: boolean; key?: string; get?: (it: any) => string };
export const CLOUD_FEATURES: Record<string, Feature> = {
  Group: { categorical: true, get: (it) => it.group || 'Unclassified' },
  Subgroup: { categorical: true, get: (it) => it.subgroup || '—' },
  Timbre: { categorical: true, get: (it) => it.timbre || '?' },
  Length: { key: 'length_seconds' },
  Complexity: { key: 'complexity' },
  'Brightness (centroid)': { key: 'spectral_centroid_hz' },
  Harmonicity: { key: 'harmonicity' },
  Sustain: { key: 'envelope_sustain_level' },
  Attack: { key: 'attack_seconds' },
  Pitch: { key: 'pitch_hz' },
  BPM: { key: 'beats_per_minute' },
  RMS: { key: 'root_mean_square_level' },
  ZCR: { key: 'zero_crossings_per_second' },
};

export const AXIS_OPTIONS = Object.keys(CLOUD_FEATURES);
export const SIZE_OPTIONS = Object.entries(CLOUD_FEATURES)
  .filter(([, f]) => !f.categorical)
  .map(([label]) => label);
export const COLOR_OPTIONS = ['UCS Category', 'UCS Subcategory', 'Group', 'God Category', 'Subgroup'];
export const SHAPE_OPTIONS = ['Instrument', 'God Category', 'Timbre', 'Uniform'];

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
  const key = f.key!;
  let mn = Infinity, mx = -Infinity;
  for (const it of data) {
    const v = Number(it[key]);
    if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const range = mx - mn || 1;
  return (it) => {
    const v = Number(it[key]);
    const nv = Number.isFinite(v) ? (v - mn) / range : 0.5;
    return (nv - 0.5) * SPAN;
  };
}

function makeSize(data: any[], label: string): (it: any) => number {
  const f = CLOUD_FEATURES[label];
  if (!f || f.categorical || !f.key) return () => 0.7;
  const key = f.key;
  let mn = Infinity, mx = -Infinity;
  for (const it of data) {
    const v = Number(it[key]);
    if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const range = mx - mn || 1;
  return (it) => {
    const v = Number(it[key]);
    const nv = Number.isFinite(v) ? (v - mn) / range : 0.5;
    return 0.35 + nv * 1.6;
  };
}

function colorFor(item: any, colorBy: string): string {
  // The UCS taxonomy (82 categories, scored per file) — hue = parent category,
  // shade = subcategory. Distinct from the god categories, which are six
  // envelope buckets over the drum-pack name groups.
  if (colorBy === 'UCS Category') return ucsColor(item.ucs.category || '');
  if (colorBy === 'UCS Subcategory') {
    return ucsSubColor(item.ucs.category || '', item.ucs.subcategory || '');
  }
  const group = item.classification.group || 'Unclassified';
  if (colorBy === 'God Category') return godColor(godCategory(group));
  if (colorBy === 'Subgroup') return groupColor(group, item.metadata.subgroup || '');
  return groupColor(group, '');
}

function getShapeFor(it: any, shapeBy: string): string {
  if (shapeBy === 'Uniform') return 'sphere';

  const g = (it.group || '').toLowerCase();
  const god = (it.god_category || '').toLowerCase();
  const t = (it.timbre || '').toLowerCase();
  
  if (shapeBy === 'God Category') {
    if (god === 'percussive') return 'pyramid';
    if (god === 'impulsive with tail') return 'diamond';
    if (god === 'tonal') return 'cube';
    if (god === 'complex') return 'torus';
    return 'sphere';
  }

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
  if (g === 'ir' || god === 'impulsive with tail') return 'diamond';
  if (g === 'perc' || god === 'percussive') return 'pyramid';
  if (it.transient_count > 1 || god === 'complex' || g.includes('loop') || g === 'fx') return 'torus';
  if (g === 'bass' || g.includes('synth') || god === 'tonal') return 'cube';
  if (g === 'vocal' || g.includes('voice')) return 'icosahedron';
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

function CloudPoints({ data, xAxis, yAxis, zAxis, sizeAxis, colorBy, shapeBy, hiddenGroups, selectedIndex, onPick }: CloudProps) {
  const count = data.length
  // The legend, the filters and the colours must all read the same taxonomy.
  const taxonomy = taxonomyOf(colorBy);

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

  if (count === 0) return null;

  const selPos = selectedIndex != null && selectedIndex < allPositions.length ? allPositions[selectedIndex] : null;

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
        <mesh position={selPos} rotation={meshRot(selectedShape)} scale={(selectedSize || 0.7) * 0.5 + 0.6}>
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
}

export default function SampleCloud({
  data = [], xAxis = 'Pitch', yAxis = 'Group', zAxis = 'Complexity',
  sizeAxis = 'Length', colorBy = 'Group', shapeBy = 'Instrument', hiddenGroups = new Set(),
  selectedIndex = null, onPick = () => {}, showAxes = true,
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
          selectedIndex={selectedIndex} onPick={onPick}
        />
        <OrbitControls enablePan enableZoom enableRotate autoRotate={false} />
      </Canvas>
    </div>
  )
}
