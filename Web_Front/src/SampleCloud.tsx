import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

interface SampleCloudProps {
  data?: any[];
  xAxis?: string;
  yAxis?: string;
  zAxis?: string;
}

function CloudParticles({ data = [], xAxis = 'Pitch (Hz)', yAxis = 'Category', zAxis = 'Complexity / Timbre' }: { data: any[], xAxis: string, yAxis: string, zAxis: string }) {
  const pointsRef = useRef<THREE.Points>(null!)
  
  const count = data.length;

  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const item = data[i]
      
      // Determine X value
      let x = 0;
      if (xAxis === 'Pitch (Hz)') {
          x = ((item.pitch_hz || 0) / 50) - 15; // spread 0-2000Hz over -15 to +25
      } else if (xAxis === 'Spectral Centroid') {
          x = ((item.spectral_centroid_hz || 0) / 200) - 20; // spread 0-8000Hz
      } else if (xAxis === 'Length') {
          x = ((item.length_seconds || 0) * 5) - 10;
      }

      // Determine Y value
      let y = 0;
      if (yAxis === 'Name Group') {
          y = ((i % 40) - 20) * 0.5; // simple spread for now
      } else if (yAxis === 'Category') {
          // group into vertical bands based on 'group'
          const groups = ['Kick', 'Snare', 'Perc', 'Hihat', 'Bass', 'Keyboards', 'Loops/Patterns'];
          const groupIdx = groups.indexOf(item.group || 'Perc');
          const jitter = (Math.random() - 0.5) * 4;
          y = (groupIdx * 4) - 12 + jitter;
      }

      // Determine Z value
      let z = 0;
      if (zAxis === 'Complexity / Timbre') {
          z = ((item.complexity || 0) * 5) - 15;
      } else if (zAxis === 'Transient Count') {
          z = ((item.transient_count || 0) * 0.5) - 10;
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      // Color mapping
      const color = new THREE.Color()
      const hue = item.pitch_hz ? (item.pitch_hz % 1000) / 1000 : Math.random();
      color.setHSL(hue, 0.8, 0.6)
      
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    return [positions, colors]
  }, [count, data, xAxis, yAxis, zAxis])

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.05
    }
  })

  if (count === 0) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial 
        size={0.8} 
        vertexColors 
        transparent 
        opacity={0.9} 
        sizeAttenuation 
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export default function SampleCloud({ data = [], xAxis = 'Pitch (Hz)', yAxis = 'Category', zAxis = 'Complexity / Timbre' }: SampleCloudProps) {
  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0 }}>
      {data.length === 0 && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', zIndex: 10 }}>
          Upload a .PEAK file or scan a folder to visualize the cloud.
        </div>
      )}
      <Canvas camera={{ position: [0, 0, 40], fov: 60 }}>
        <color attach="background" args={['#0B0E14']} />
        <ambientLight intensity={0.5} />
        <CloudParticles data={data} xAxis={xAxis} yAxis={yAxis} zAxis={zAxis} />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={false} />
      </Canvas>
    </div>
  )
}
