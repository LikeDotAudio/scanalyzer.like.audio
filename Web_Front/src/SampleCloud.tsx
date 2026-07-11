import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

interface SampleCloudProps {
  data?: any[];
}

function CloudParticles({ data = [] }: { data: any[] }) {
  const pointsRef = useRef<THREE.Points>(null!)
  
  // Use data length or fallback to 0
  const count = data.length;

  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const item = data[i]
      // Fallbacks in case properties are missing
      const pitch = item.pitch_hz || 0;
      const complexity = item.complexity || 0;

      // Map values to 3D space
      // X = pitch (scaled down a bit)
      // Y = depth (using index to spread them out somewhat evenly instead of random)
      // Z = complexity (scaled up)
      positions[i * 3] = (pitch / 100) - 10
      positions[i * 3 + 1] = ((i % 20) - 10) 
      positions[i * 3 + 2] = (complexity * 2) - 5

      // Color based on pitch/complexity
      const color = new THREE.Color()
      color.setHSL((pitch % 1000) / 1000, 0.8, 0.5)
      
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }
    return [positions, colors]
  }, [count, data])

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.05
    }
  })

  if (count === 0) {
    return null; // Don't render empty cloud
  }

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute 
          attach="attributes-position" 
          args={[positions, 3]} 
        />
        <bufferAttribute 
          attach="attributes-color" 
          args={[colors, 3]} 
        />
      </bufferGeometry>
      <pointsMaterial 
        size={0.5} 
        vertexColors 
        transparent 
        opacity={0.8} 
        sizeAttenuation 
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export default function SampleCloud({ data = [] }: SampleCloudProps) {
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
        <CloudParticles data={data} />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={false} />
      </Canvas>
    </div>
  )
}
