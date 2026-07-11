import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

function CloudParticles() {
  const pointsRef = useRef<THREE.Points>(null!)
  const count = 10000

  // Generate random data for 10,000 samples
  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    
    const colorA = new THREE.Color('#6366f1') // Primary accent
    const colorB = new THREE.Color('#0ea5e9') // Secondary accent
    const colorC = new THREE.Color('#f43f5e') // Red accent for contrast

    for (let i = 0; i < count; i++) {
      // Create a massive, glowing spherical cloud distribution
      const theta = Math.random() * 2 * Math.PI
      const phi = Math.acos((Math.random() * 2) - 1)
      const radius = 10 + (Math.random() * 15) // Spread between 10 and 25 units

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = radius * Math.cos(phi)

      // Mix colors based on position to simulate clustering
      const mixRatio = Math.random()
      const mixColor = mixRatio > 0.8 ? colorC : (mixRatio > 0.4 ? colorA : colorB)
      
      colors[i * 3] = mixColor.r
      colors[i * 3 + 1] = mixColor.g
      colors[i * 3 + 2] = mixColor.b
    }
    return [positions, colors]
  }, [count])

  // Slowly rotate the entire cloud in 3D space
  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.getElapsedTime() * 0.05
      pointsRef.current.rotation.z = state.clock.getElapsedTime() * 0.02
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute 
          attach="attributes-position" 
          count={positions.length / 3} 
          array={positions} 
          itemSize={3} 
        />
        <bufferAttribute 
          attach="attributes-color" 
          count={colors.length / 3} 
          array={colors} 
          itemSize={3} 
        />
      </bufferGeometry>
      <pointsMaterial 
        size={0.15} 
        vertexColors 
        transparent 
        opacity={0.8} 
        sizeAttenuation 
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export default function SampleCloud() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, zIndex: 0 }}>
      <Canvas camera={{ position: [0, 0, 40], fov: 60 }}>
        <color attach="background" args={['#0B0E14']} />
        <ambientLight intensity={0.5} />
        <CloudParticles />
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} autoRotate={false} />
      </Canvas>
    </div>
  )
}
