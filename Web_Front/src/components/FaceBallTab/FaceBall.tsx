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
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  truncatedIcosahedron, validateSolid, RESPONSES, faceOfItem,
  type ResponseFamily, type Vec3,
} from '../../facialResponse';
import { ucsColor, ucsSubColor, taxonomyKeys } from '../../groupColors';
import { AXES, AXIS_GROUPS, AXIS_NAMES, CORNER_SCHEMES, normalizer } from './axes';

export { AXIS_GROUPS, AXIS_NAMES, CORNER_SCHEMES } from './axes';
export const CORNER_SCHEME_NAMES = Object.keys(CORNER_SCHEMES);

/** World radius of the ball. */
const R = 26;
/** The cage's natural colour at intensity 1. */
const WIREFRAME_COLOR = '#6b7d8c';
/** How far samples spread across their face, and how far they float above it. */
const FACE_SPREAD = 3.4;
const FACE_DEPTH = 2.2;
/** Half-width of the free (unpulled) scatter cube. */
const FREE_SPAN = 30;

/** One colour per response family, so the ball reads as regions at a glance.
 *  This paints the FACES; the samples on them get their own scheme below. */
const FAMILY_COLOR: Record<ResponseFamily, string> = {
  Viseme: '#4dd0e1',
  Startle: '#ff5252',
  Effort: '#ffb74d',
  Aversion: '#ba68c8',
  Attend: '#81c784',
  Ambient: '#78909c',
};

/** How the sample dots are coloured.
 *
 * Six family colours would waste the palette: the face a sample sits on already
 * states its family, so colouring the dot the same says nothing a second time.
 * Colouring by UCS subcategory instead makes the dot carry the finer taxonomy
 * the geometry cannot — which is what gives the ball the many-hued look, with
 * each face showing the internal variety of the categories that route to it. */
export const COLOR_MODES = ['UCS Subcategory', 'UCS Category', 'Response Family'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

function sampleColor(item: any, mode: ColorMode, faceIndex: number): string {
  if (mode === 'Response Family') return FAMILY_COLOR[RESPONSES[faceIndex].family];
  const [category, subcategory] = taxonomyKeys(item);
  return mode === 'UCS Category' ? ucsColor(category) : ucsSubColor(category, subcategory);
}

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

interface Props {
  data: any[];
  selectedItem?: any;
  onSelect?: (item: any) => void;
  /** Pull toward the response face: 0 = free acoustic scatter, 1 = fully anchored,
   *  and beyond 1 the samples OVERSHOOT their face — the categories fly apart, which
   *  separates neighbouring faces that overlap at 1. `lerp` extrapolates, so no
   *  special case is needed for t > 1. */
  pull: number;
  /** Wireframe brightness, 0..2. See `Wireframe`. */
  outline: number;
  axes: [string, string, string];
  /** Faces to draw; empty means all. */
  visibleFaces: Set<number>;
  colorBy: ColorMode;
}

/** The wireframe ball: the real 90 edges between the real 60 vertices.
 *
 *  `intensity` runs 0..2 rather than 0..1 so the cage can be pushed past its
 *  natural brightness. Up to 1 it fades the line in; beyond 1 the line is already
 *  fully opaque, so the extra range lifts the COLOUR toward white instead —
 *  otherwise the top half of the slider would do nothing. */
function Wireframe({
  solid, intensity,
}: {
  solid: ReturnType<typeof truncatedIcosahedron>;
  intensity: number;
}) {
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
  const color = useMemo(() => {
    const c = new THREE.Color(WIREFRAME_COLOR);
    if (intensity > 1) c.lerp(new THREE.Color('#ffffff'), Math.min(1, intensity - 1));
    return c;
  }, [intensity]);

  if (intensity <= 0) return null; // fully down: no cage at all
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={Math.min(1, intensity)}
        toneMapped={false}
      />
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
        // A circleGeometry lies in the XY plane. Left unrotated it points at the
        // camera's Z regardless of where on the ball it sits, so 30 of the 32
        // faces render edge-on as slivers. Turn each one to face outward along
        // its own normal so it lies flat ON the face it represents.
        const facing = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          v3(f.center),
        );
        // Inradius of the real face, so the disc fills its polygon instead of
        // floating as a dot in the middle of it.
        const span = f.kind === 'pentagon' ? 2.6 : 3.2;
        return (
          <group key={f.index} position={p} quaternion={facing}>
            <mesh
              onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(f.index); }}
              onPointerOut={() => onHover(null)}
            >
              {/* A pentagon face gets 5 sides, a hexagon 6 — the marker states
                  which kind of face it is without needing a legend. */}
              <circleGeometry args={[isHovered ? span * 1.15 : span, f.kind === 'pentagon' ? 5 : 6]} />
              <meshBasicMaterial
                color={FAMILY_COLOR[r.family]}
                transparent
                opacity={isHovered ? 0.55 : 0.22}
                side={THREE.DoubleSide}
                depthWrite={false}
                toneMapped={false}
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
function Samples({ data, selectedItem, onSelect, pull, axes, visibleFaces, colorBy }: Props) {
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
      colors.push(new THREE.Color(sampleColor(it, colorBy, fi)));
      items.push(it);
    }
    return { positions, colors, items };
  }, [data, pull, axes, visibleFaces, solid, colorBy]);

  // Write the instance transforms and colours BEFORE the first paint.
  //
  // This has to be a layout effect, not `useFrame`. `setColorAt` is what
  // allocates `instanceColor`, and three decides whether to compile the
  // instancing-colour path into the shader from whether that attribute exists
  // when the material's program is built (`WebGLPrograms.js`: `instancingColor:
  // IS_INSTANCEDMESH && object.instanceColor !== null`). Filling it on the first
  // animation frame is one beat too late — the program is already compiled
  // without the path.
  //
  // Necessary but NOT sufficient: this timing was right and the dots still
  // rendered black, because the material also carried `vertexColors`. See the
  // note on the material below for what actually zeroed them.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[i]);
    });
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // The attribute may have come into existence just now, so let the material
    // recompile against it rather than keep the colourless program.
    (mesh.material as THREE.Material).needsUpdate = true;
  }, [positions, colors]);

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
        {/* Unlit, so a dot renders at its literal colour rather than being
            dimmed toward black by the scene's lighting.

            NO `vertexColors` here, and that is the whole reason the dots render
            in colour. Per-INSTANCE colour comes from `instanceColor` (written by
            setColorAt below), which three enables on its own via
            USE_INSTANCING_COLOR. `vertexColors` asks for something different —
            per-VERTEX colour from a `color` attribute on the geometry — and the
            two defines are wired asymmetrically (WebGLProgram.js): the fragment
            shader gets USE_COLOR from `vertexColors || instancingColor`, but the
            VERTEX shader gets it from `vertexColors` alone. Setting it therefore
            compiles `attribute vec3 color; ... vColor.rgb *= color;` into the
            vertex shader, and sphereGeometry has no `color` attribute — only
            position, normal, uv. An unbound attribute reads as (0,0,0,1), so
            every instance colour was multiplied by zero one line before
            `vColor.rgb *= instanceColor.rgb` ever ran. Hence: black dots. */}
        <sphereGeometry args={[0.42, 8, 8]} />
        <meshBasicMaterial toneMapped={false} />
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
      <Wireframe solid={solid} intensity={props.outline} />
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
