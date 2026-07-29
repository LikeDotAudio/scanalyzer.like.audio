//! The 4D cloud: three acoustic axes plus category-as-geometry.
//!
//! The existing 3D cloud spends all three spatial dimensions on acoustic
//! features, which leaves the CATEGORY carried by colour alone — so categories
//! that happen to sound alike sit on top of each other and the clusters smear.
//!
//! Here the sample's response class is a fourth, non-spatial dimension realised
//! as a pull toward one of the 32 faces of a truncated icosahedron. At pull = 0
//! this is exactly the old free scatter; at pull = 1 every sample sits on its
//! own face and the ball reads like a panel of 32 separate small scatter plots.
//! Anywhere in between shows how much the acoustics agree with the taxonomy —
//! a sample that stays far from its face is one whose sound does not match the
//! category it was filed under.
import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  truncatedIcosahedron, validateSolid, RESPONSES, faceOfItem,
  type ResponseFamily, type Vec3,
} from '../../facialResponse';
import { adsrNumber } from '../../envelopeSlices';

/** World radius of the ball. */
const R = 26;
/** How far samples spread across their face, and how far they float above it. */
const FACE_SPREAD = 3.4;
const FACE_DEPTH = 2.2;
/** Half-width of the free (unpulled) scatter cube. */
const FREE_SPAN = 30;

/** One colour per response family, so the ball reads as regions at a glance. */
const FAMILY_COLOR: Record<ResponseFamily, string> = {
  Viseme: '#4dd0e1',
  Startle: '#ff5252',
  Effort: '#ffb74d',
  Aversion: '#ba68c8',
  Attend: '#81c784',
  Ambient: '#78909c',
};

/** Numeric readers for the three acoustic axes. Kept small and local: this view
 *  is about the 4th dimension, the other three just need to be reasonable. */
const AXES: Record<string, (it: any) => number> = {
  Brightness: (it) => it.spectral_features?.spectral_centroid_hz ?? 0,
  Harmonicity: (it) => it.spectral_features?.harmonicity ?? 0,
  Length: (it) => it.metadata?.length_seconds ?? 0,
  Transients: (it) => it.envelope?.transient_count ?? 0,
  Sustain: (it) => adsrNumber(it, 'envelope_sustain_level'),
  Attack: (it) => adsrNumber(it, 'envelope_attack_seconds'),
  Flatness: (it) => it.spectral_features?.spectral_flatness ?? 0,
  RMS: (it) => it.spectral_features?.root_mean_square_level ?? 0,
  Pitch: (it) => it.musicality?.pitch_hz ?? 0,
};
export const AXIS_NAMES = Object.keys(AXES);

/** Normalize a feature across the dataset to [-1, 1]; absent reads as centre. */
function normalizer(data: any[], name: string): (it: any) => number {
  const get = AXES[name] ?? (() => 0);
  let mn = Infinity, mx = -Infinity;
  for (const it of data) {
    const v = Number(get(it));
    if (Number.isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
  }
  const range = mx - mn || 1;
  return (it) => {
    const v = Number(get(it));
    if (!Number.isFinite(v)) return 0;
    return ((v - mn) / range) * 2 - 1;
  };
}

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

interface Props {
  data: any[];
  selectedItem?: any;
  onSelect?: (item: any) => void;
  /** Pull toward the response face: 0 = free acoustic scatter, 1 = fully anchored. */
  pull: number;
  axes: [string, string, string];
  /** Faces to draw; empty means all. */
  visibleFaces: Set<number>;
}

/** The wireframe ball: the real 90 edges between the real 60 vertices. */
function Wireframe({ solid }: { solid: ReturnType<typeof truncatedIcosahedron> }) {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    for (const [a, b] of solid.edges) {
      const va = solid.vertices[a], vb = solid.vertices[b];
      pts.push(va[0] * R, va[1] * R, va[2] * R, vb[0] * R, vb[1] * R, vb[2] * R);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [solid]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#3a4750" transparent opacity={0.55} />
    </lineSegments>
  );
}

/** A marker + label at each face centre, coloured by response family. */
function FaceMarkers({
  solid, hovered, onHover, visibleFaces,
}: {
  solid: ReturnType<typeof truncatedIcosahedron>;
  hovered: number | null;
  onHover: (i: number | null) => void;
  visibleFaces: Set<number>;
}) {
  return (
    <group>
      {solid.faces.map((f) => {
        const shown = visibleFaces.size === 0 || visibleFaces.has(f.index);
        if (!shown) return null;
        const r = RESPONSES[f.index];
        const p = v3(f.center).multiplyScalar(R);
        const isHovered = hovered === f.index;
        return (
          <group key={f.index} position={p}>
            <mesh
              onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(f.index); }}
              onPointerOut={() => onHover(null)}
            >
              {/* A pentagon face gets 5 sides, a hexagon 6 — the marker states
                  which kind of face it is without needing a legend. */}
              <circleGeometry args={[isHovered ? 1.5 : 1.0, f.kind === 'pentagon' ? 5 : 6]} />
              <meshBasicMaterial
                color={FAMILY_COLOR[r.family]}
                transparent
                opacity={isHovered ? 0.95 : 0.5}
                side={THREE.DoubleSide}
              />
            </mesh>
            {isHovered && (
              <Html distanceFactor={40} style={{ pointerEvents: 'none' }}>
                <div style={{
                  background: 'rgba(10,14,18,0.92)', border: `1px solid ${FAMILY_COLOR[r.family]}`,
                  borderRadius: 4, padding: '4px 8px', color: '#e8eef2', fontSize: 11,
                  whiteSpace: 'nowrap', transform: 'translate(-50%,-160%)',
                }}>
                  <b>{r.name}</b> <span style={{ opacity: 0.6 }}>({f.kind})</span>
                  <div style={{ opacity: 0.7, fontSize: 10 }}>{r.categories.join(' · ')}</div>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** The samples, one instanced sphere each. */
function Samples({ data, selectedItem, onSelect, pull, axes, visibleFaces }: Props) {
  const solid = useMemo(() => truncatedIcosahedron(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { positions, colors, items } = useMemo(() => {
    const nx = normalizer(data, axes[0]);
    const ny = normalizer(data, axes[1]);
    const nz = normalizer(data, axes[2]);
    const positions: THREE.Vector3[] = [];
    const colors: THREE.Color[] = [];
    const items: any[] = [];

    for (const it of data) {
      const fi = faceOfItem(it);
      if (visibleFaces.size && !visibleFaces.has(fi)) continue;
      const face = solid.faces[fi];
      const a = nx(it), b = ny(it), c = nz(it);

      // Free position: the plain acoustic scatter, unchanged from the 3D cloud.
      const free = new THREE.Vector3(a * FREE_SPAN * 0.5, b * FREE_SPAN * 0.5, c * FREE_SPAN * 0.5);
      // Anchored position: on the face's tangent plane, floating by the 3rd axis.
      const anchored = v3(face.center).multiplyScalar(R + c * FACE_DEPTH)
        .add(v3(face.tangentU).multiplyScalar(a * FACE_SPREAD))
        .add(v3(face.tangentV).multiplyScalar(b * FACE_SPREAD));

      positions.push(free.lerp(anchored, pull));
      colors.push(new THREE.Color(FAMILY_COLOR[RESPONSES[fi].family]));
      items.push(it);
    }
    return { positions, colors, items };
  }, [data, pull, axes, visibleFaces, solid]);

  // Write the instance transforms whenever the layout changes.
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (mesh.userData.written === positions) return;
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.written = positions;
  });

  const selectedIndex = items.indexOf(selectedItem);

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined as any, undefined as any, Math.max(1, positions.length)]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId != null && items[e.instanceId]) onSelect?.(items[e.instanceId]);
        }}
      >
        <sphereGeometry args={[0.32, 8, 8]} />
        <meshBasicMaterial vertexColors />
      </instancedMesh>
      {selectedIndex >= 0 && (
        <mesh position={positions[selectedIndex]}>
          <sphereGeometry args={[0.75, 16, 16]} />
          <meshBasicMaterial color="#ffffff" wireframe />
        </mesh>
      )}
    </>
  );
}

export default function FaceBall(props: Props) {
  const solid = useMemo(() => truncatedIcosahedron(), []);
  const [hovered, setHovered] = useState<number | null>(null);

  // The construction is arithmetic, not a coordinate table, so a regression
  // would otherwise show up as a subtly wrong ball rather than an error.
  const geometryError = useMemo(() => validateSolid(solid), [solid]);
  if (geometryError) {
    return (
      <div style={{ padding: '2rem', color: '#ff8a80' }}>
        Truncated icosahedron failed to build: {geometryError}
      </div>
    );
  }

  return (
    <Canvas camera={{ position: [0, 0, 78], fov: 50 }} style={{ background: '#0a0e12' }}>
      <ambientLight intensity={1} />
      <Wireframe solid={solid} />
      <FaceMarkers
        solid={solid}
        hovered={hovered}
        onHover={setHovered}
        visibleFaces={props.visibleFaces}
      />
      <Samples {...props} />
      <OrbitControls enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
