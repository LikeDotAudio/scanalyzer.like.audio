import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { groupColor, godColor, godCategory, subKey } from './groupColors'

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
export const COLOR_OPTIONS = ['Group', 'God Category', 'Subgroup'];

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
  const group = item.group || 'Unclassified';
  if (colorBy === 'God Category') return godColor(godCategory(group));
  if (colorBy === 'Subgroup') return groupColor(group, item.subgroup || '');
  return groupColor(group, '');
}

interface CloudProps {
  data: any[];
  xAxis: string; yAxis: string; zAxis: string; sizeAxis: string; colorBy: string;
  hiddenGroups: Set<string>;
  selectedIndex: number | null;
  onPick: (index: number) => void;
}

function CloudPoints({ data, xAxis, yAxis, zAxis, sizeAxis, colorBy, hiddenGroups, selectedIndex, onPick }: CloudProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const count = data.length

  const { positions, colors, sizes } = useMemo(() => {
    const xf = makeAxis(data, xAxis);
    const yf = makeAxis(data, yAxis);
    const zf = makeAxis(data, zAxis);
    const sf = makeSize(data, sizeAxis);
    const positions: [number, number, number][] = [];
    const colors: THREE.Color[] = [];
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const it = data[i];
      positions.push([xf(it, i), yf(it, i), zf(it, i)]);
      colors.push(new THREE.Color(colorFor(it, colorBy)));
      sizes.push(sf(it));
    }
    return { positions, colors, sizes };
  }, [data, count, xAxis, yAxis, zAxis, sizeAxis, colorBy]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < count; i++) {
      const [x, y, z] = positions[i];
      const g = data[i].group || 'Unclassified';
      const sg = data[i].subgroup || '';
      // Hidden if the whole group is hidden, or this specific subgroup is.
      const hidden = hiddenGroups.has(g) || (!!sg && hiddenGroups.has(subKey(g, sg)));
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(hidden ? 0.0001 : sizes[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions, colors, sizes, hiddenGroups, data, count, dummy]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) onPick(e.instanceId);
  };

  if (count === 0) return null;

  const sel = selectedIndex != null && selectedIndex < positions.length ? positions[selectedIndex] : null;

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, count]} onClick={handleClick}>
        <sphereGeometry args={[0.5, 10, 10]} />
        {/* Unlit: the per-instance colour IS the colour, no shading darkening. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {sel && (
        <mesh position={sel}>
          <sphereGeometry args={[(sizes[selectedIndex!] || 0.7) * 0.5 + 0.5, 16, 16]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.9} />
        </mesh>
      )}
    </>
  );
}

interface SampleCloudProps {
  data?: any[];
  xAxis?: string; yAxis?: string; zAxis?: string; sizeAxis?: string; colorBy?: string;
  hiddenGroups?: Set<string>;
  selectedIndex?: number | null;
  onPick?: (index: number) => void;
}

export default function SampleCloud({
  data = [], xAxis = 'Pitch', yAxis = 'Group', zAxis = 'Complexity',
  sizeAxis = 'Length', colorBy = 'Group', hiddenGroups = new Set(),
  selectedIndex = null, onPick = () => {},
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
        <CloudPoints
          data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis}
          sizeAxis={sizeAxis} colorBy={colorBy} hiddenGroups={hiddenGroups}
          selectedIndex={selectedIndex} onPick={onPick}
        />
        <OrbitControls enablePan enableZoom enableRotate autoRotate={false} />
      </Canvas>
    </div>
  )
}
