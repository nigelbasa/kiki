import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';

// 4-junction rectangle. Coordinates match the SUMO network: x→x (east),
// z→sumo_y (south). Square 100m × 100m centred at (50, 0, 50).
const INTERSECTIONS = {
  TL_00: { x: 0,   z: 0   },   // NW corner
  TL_01: { x: 100, z: 0   },   // NE corner
  TL_10: { x: 0,   z: 100 },   // SW corner
  TL_11: { x: 100, z: 100 },   // SE corner
};

const RECT_CENTER = { x: 50, z: 50 };

// Generic square junction pad. Used at all four corners — the rectangle is
// symmetric so the same shape works everywhere (translated by the corner pos).
const JUNCTION_HALF = 9.2;
const SQUARE_JUNCTION_SHAPE = [
  [-JUNCTION_HALF, -JUNCTION_HALF],
  [ JUNCTION_HALF, -JUNCTION_HALF],
  [ JUNCTION_HALF,  JUNCTION_HALF],
  [-JUNCTION_HALF,  JUNCTION_HALF],
];

// Perimeter edges (between corners) + outward stubs (50m from each corner's
// two free sides). Each polyline is rendered as a road in the canvas.
const STUB_LENGTH = 50;
const ROAD_PATHS = [
  // Perimeter
  { key: 'perim_top',    points: [[0,   0  ], [100, 0  ]] },
  { key: 'perim_right',  points: [[100, 0  ], [100, 100]] },
  { key: 'perim_bottom', points: [[100, 100], [0,   100]] },
  { key: 'perim_left',   points: [[0,   100], [0,   0  ]] },
  // TL_00 (NW) outward stubs
  { key: 'stub_NW_N', points: [[0,   0  ], [0,   -STUB_LENGTH]] },
  { key: 'stub_NW_W', points: [[0,   0  ], [-STUB_LENGTH, 0  ]] },
  // TL_01 (NE) outward stubs
  { key: 'stub_NE_N', points: [[100, 0  ], [100, -STUB_LENGTH]] },
  { key: 'stub_NE_E', points: [[100, 0  ], [100 + STUB_LENGTH, 0]] },
  // TL_10 (SW) outward stubs
  { key: 'stub_SW_S', points: [[0,   100], [0,   100 + STUB_LENGTH]] },
  { key: 'stub_SW_W', points: [[0,   100], [-STUB_LENGTH, 100]] },
  // TL_11 (SE) outward stubs
  { key: 'stub_SE_S', points: [[100, 100], [100, 100 + STUB_LENGTH]] },
  { key: 'stub_SE_E', points: [[100, 100], [100 + STUB_LENGTH, 100]] },
];

// Camera presets — overview centres on the rectangle from south-elevated
// isometric. Per-junction presets bring the camera close enough to read each
// signal head while keeping the rest of the network visible.
const FOCUS_POINTS = {
  overview: { camera: [50, 130, 220], target: [RECT_CENTER.x, 0, RECT_CENTER.z] },
  TL_00: { camera: [-30, 38, -30],  target: [0,   0, 0  ] },
  TL_01: { camera: [130, 38, -30],  target: [100, 0, 0  ] },
  TL_10: { camera: [-30, 38, 130],  target: [0,   0, 100] },
  TL_11: { camera: [130, 38, 130],  target: [100, 0, 100] },
};

const ROAD_WIDTH = 7.4;
const ROAD_SHOULDER = 0.9;
const LANE_MARK_WIDTH = 0.22;
const EDGE_MARK_WIDTH = 0.14;
const SIGNAL_COLORS = { green: '#4ade80', amber: '#fb923c', red: '#f87171' };
const VEHICLE_COLORS = {
  car: '#38bdf8',
  truck: '#ef4444',
  bus: '#f59e0b',
  motorcycle: '#0f172a',
  ambulance: '#ffffff',
};

function headingToRotation(heading) {
  return -(heading * Math.PI) / 180;
}

function RoadSegment({ from, to, width, color, y }) {
  const { position, rotation, length } = useMemo(() => {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    return {
      position: [(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2],
      rotation: [0, Math.atan2(dx, dz), 0],
      length: Math.hypot(dx, dz),
    };
  }, [from, to, y]);

  return (
    <mesh position={position} rotation={rotation} receiveShadow>
      <boxGeometry args={[width, 0.08, length]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function RoadJoint({ point, radius, color, y }) {
  return (
    <mesh position={[point[0], y, point[1]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <circleGeometry args={[radius, 28]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function RoadPolyline({ points, width = ROAD_WIDTH }) {
  const segments = useMemo(
    () => points.slice(0, -1).map((point, index) => [point, points[index + 1]]),
    [points],
  );

  return (
    <group>
      {segments.map(([from, to], index) => (
        <RoadSegment key={`outer-${index}`} from={from} to={to} width={width + ROAD_SHOULDER * 2} color="#3a322c" y={0.06} />
      ))}
      {points.map((point, index) => (
        <RoadJoint key={`outer-joint-${index}`} point={point} radius={(width + ROAD_SHOULDER * 2) / 2} color="#3a322c" y={0.06} />
      ))}
      {segments.map(([from, to], index) => (
        <RoadSegment key={`inner-${index}`} from={from} to={to} width={width} color="#2f3642" y={0.1} />
      ))}
      {points.map((point, index) => (
        <RoadJoint key={`inner-joint-${index}`} point={point} radius={width / 2} color="#2f3642" y={0.1} />
      ))}
      {segments.map(([from, to], index) => (
        <RoadSegment key={`centre-${index}`} from={from} to={to} width={LANE_MARK_WIDTH} color="#fbbf24" y={0.12} />
      ))}
      {points.map((point, index) => (
        <RoadJoint key={`centre-joint-${index}`} point={point} radius={LANE_MARK_WIDTH / 2} color="#fbbf24" y={0.12} />
      ))}
      {segments.flatMap(([from, to], index) => {
        const dx = to[0] - from[0];
        const dz = to[1] - from[1];
        const length = Math.hypot(dx, dz) || 1;
        const nx = -dz / length;
        const nz = dx / length;
        const offset = width * 0.5 - 0.38;
        return [
          <RoadSegment
            key={`edge-left-${index}`}
            from={[from[0] + nx * offset, from[1] + nz * offset]}
            to={[to[0] + nx * offset, to[1] + nz * offset]}
            width={EDGE_MARK_WIDTH}
            color="#e5e7eb"
            y={0.12}
          />,
          <RoadSegment
            key={`edge-right-${index}`}
            from={[from[0] - nx * offset, from[1] - nz * offset]}
            to={[to[0] - nx * offset, to[1] - nz * offset]}
            width={EDGE_MARK_WIDTH}
            color="#e5e7eb"
            y={0.12}
          />,
        ];
      })}
    </group>
  );
}

function Ground() {
  return (
    <group>
      <mesh position={[RECT_CENTER.x, -0.08, RECT_CENTER.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[360, 360]} />
        <meshStandardMaterial color="#4d7c0f" roughness={0.95} />
      </mesh>
      {[
        [-20, 0, -30],
        [120, 0, -30],
        [-30, 0, 130],
        [130, 0, 130],
        [50, 0, -40],
        [50, 0, 140],
      ].map((entry, index) => (
        <mesh key={index} position={entry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[14 + (index % 3) * 3, 24]} />
          <meshStandardMaterial color={index % 2 === 0 ? '#3f6212' : '#65a30d'} transparent opacity={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function JunctionSurface({ points }) {
  const shape = useMemo(() => {
    const [first, ...rest] = points;
    const s = new THREE.Shape();
    s.moveTo(first[0], first[1]);
    for (const [x, z] of rest) s.lineTo(x, z);
    s.closePath();
    return s;
  }, [points]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color="#1f2937" />
    </mesh>
  );
}

function IntersectionPad({ id, pos, state }) {
  const phases = useMemo(() => {
    const out = { NS: 'red', EW: 'red' };
    if (state?.approaches) {
      for (const approach of state.approaches) out[approach.direction] = approach.phase;
    }
    return out;
  }, [state]);

  const nsCountdown = state?.approaches?.find((entry) => entry.direction === 'NS')?.countdown ?? 0;
  const ewCountdown = state?.approaches?.find((entry) => entry.direction === 'EW')?.countdown ?? 0;

  // Place one signal head on each of the four stop-bar corners of the junction.
  // The lamp face is billboarded toward the camera so all four are readable.
  const SIGNAL_OFFSET = JUNCTION_HALF + 1.6;
  const SIGNAL_INSET = ROAD_WIDTH * 0.42;

  return (
    <group position={[pos.x, 0, pos.z]}>
      <JunctionSurface points={SQUARE_JUNCTION_SHAPE} />

      {/* North approach signal: post at NW corner of the junction pad */}
      <SignalHead3D pos={[-SIGNAL_INSET, 1.9, -SIGNAL_OFFSET]} phase={phases.NS} countdown={nsCountdown} />
      {/* South approach signal: post at SE corner of the junction pad */}
      <SignalHead3D pos={[ SIGNAL_INSET, 1.9,  SIGNAL_OFFSET]} phase={phases.NS} countdown={nsCountdown} />
      {/* West approach signal: post at SW corner of the junction pad */}
      <SignalHead3D pos={[-SIGNAL_OFFSET, 1.9,  SIGNAL_INSET]} phase={phases.EW} countdown={ewCountdown} />
      {/* East approach signal: post at NE corner of the junction pad */}
      <SignalHead3D pos={[ SIGNAL_OFFSET, 1.9, -SIGNAL_INSET]} phase={phases.EW} countdown={ewCountdown} />

      <Text
        position={[0, 0.4, JUNCTION_HALF * 0.85]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={1.7}
        color="#e2e8f0"
        anchorX="center"
        anchorY="middle"
      >
        {id}
      </Text>

      {state?.spillback_active && (
        <mesh position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[JUNCTION_HALF * 0.85, JUNCTION_HALF * 1.0, 32]} />
          <meshBasicMaterial color="#fb923c" />
        </mesh>
      )}
      {state?.emergency_state && state.emergency_state !== 'idle' && <EmergencyRing />}
    </group>
  );
}

function SignalHead3D({ pos, phase, countdown }) {
  const lights = [
    { y: 0.62, key: 'red', color: SIGNAL_COLORS.red },
    { y: 0, key: 'amber', color: SIGNAL_COLORS.amber },
    { y: -0.62, key: 'green', color: SIGNAL_COLORS.green },
  ];

  return (
    <group position={pos}>
      {/* Mast pole, planted in the ground beside the stop bar */}
      <mesh castShadow position={[0, -1.18, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 2.6, 10]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      {/* Lamp head — billboarded so the lit face always points at the viewer.
          This makes the active signal colour readable from any orbit angle. */}
      <Billboard position={[0, 0.15, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.05, 2.0, 0.45]} />
          <meshStandardMaterial color="#0b1220" />
        </mesh>
        {lights.map((light) => (
          <group key={light.key} position={[0, light.y, 0.24]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.26, 0.26, 0.18, 20]} />
              <meshStandardMaterial
                color={phase === light.key ? light.color : '#1f2937'}
                emissive={phase === light.key ? light.color : '#000000'}
                emissiveIntensity={phase === light.key ? 1.9 : 0}
              />
            </mesh>
          </group>
        ))}
        <Text
          position={[1.45, 0.05, 0.3]}
          fontSize={1.05}
          color="#f8fafc"
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.06}
          outlineColor="#020617"
        >
          {String(Math.max(0, countdown))}
        </Text>
      </Billboard>
    </group>
  );
}

function EmergencyRing() {
  const ref = useRef();
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 2.2;
  });
  return (
    <mesh ref={ref} position={[0, 0.52, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[JUNCTION_HALF * 1.1, 0.16, 12, 32]} />
      <meshStandardMaterial color="#f87171" emissive="#f87171" emissiveIntensity={1.1} />
    </mesh>
  );
}

function Wheel({ position, scale = 1 }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
      <cylinderGeometry args={[0.3 * scale, 0.3 * scale, 0.24 * scale, 12]} />
      <meshStandardMaterial color="#111827" roughness={0.8} />
    </mesh>
  );
}

function WindowGlass({ args, position, opacity = 0.62 }) {
  return (
    <RoundedBox args={args} radius={0.12} position={position}>
      <meshStandardMaterial color="#bfdbfe" metalness={0.75} roughness={0.08} transparent opacity={opacity} />
    </RoundedBox>
  );
}

function CarBody({ type = 'car', color = '#7dd3fc', emergency = false }) {
  const col = emergency ? '#38bdf8' : color;
  if (type === 'ambulance') {
    return (
      <group>
        <RoundedBox args={[2.35, 1.45, 5.7]} radius={0.18} position={[0, 1.0, 0]}>
          <meshStandardMaterial color="#f8fafc" metalness={0.22} roughness={0.42} />
        </RoundedBox>
        <RoundedBox args={[2.1, 0.92, 2.15]} radius={0.14} position={[0, 2.02, -0.78]}>
          <meshStandardMaterial color="#f8fafc" metalness={0.2} roughness={0.34} />
        </RoundedBox>
        <WindowGlass args={[1.72, 0.56, 1.44]} position={[0, 2.18, -0.82]} opacity={0.74} />
        <mesh position={[0, 1.26, 2.88]}>
          <boxGeometry args={[1.36, 0.34, 0.1]} />
          <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.44} />
        </mesh>
        <mesh position={[0, 1.26, 2.88]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[1.36, 0.34, 0.1]} />
          <meshStandardMaterial color="#dc2626" emissive="#dc2626" emissiveIntensity={0.44} />
        </mesh>
        <mesh position={[0, 2.74, -0.38]}>
          <boxGeometry args={[1.08, 0.18, 0.42]} />
          <meshStandardMaterial color="#2563eb" emissive="#2563eb" emissiveIntensity={1.8} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`stripe-${side}`} position={[side * 1.16, 1.05, 0.35]}>
            <boxGeometry args={[0.1, 0.78, 4.28]} />
            <meshStandardMaterial color="#dc2626" />
          </mesh>
        ))}
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz], i) => (
          <Wheel key={i} position={[sx * 1.0, 0.24, sz * 1.92]} scale={1.02} />
        ))}
      </group>
    );
  }
  if (type === 'motorcycle') {
    return (
      <group>
        <Wheel position={[0, 0.22, -0.88]} scale={0.82} />
        <Wheel position={[0, 0.22, 0.88]} scale={0.82} />
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[0.18, 0.18, 1.72]} />
          <meshStandardMaterial color="#475569" metalness={0.35} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.78, 0.08]} rotation={[0.5, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.18, 1.24, 10]} />
          <meshStandardMaterial color={col} metalness={0.48} roughness={0.28} />
        </mesh>
        <mesh position={[0, 1.18, -0.16]}>
          <sphereGeometry args={[0.24, 12, 12]} />
          <meshStandardMaterial color="#111827" roughness={0.52} />
        </mesh>
        <mesh position={[0, 0.98, -0.56]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, 0.84, 8]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.55} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.88, 0.96]} rotation={[0.9, 0, 0]}>
          <boxGeometry args={[0.12, 0.12, 0.34]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.35} />
        </mesh>
      </group>
    );
  }

  if (type === 'bus') {
    return (
      <group>
        <RoundedBox args={[2.45, 2.2, 8.35]} radius={0.2} position={[0, 1.22, 0]}>
          <meshStandardMaterial color={col} metalness={0.28} roughness={0.38} />
        </RoundedBox>
        <WindowGlass args={[2.02, 0.72, 6.1]} position={[0, 2.02, -0.1]} opacity={0.58} />
        <mesh position={[0, 1.48, 3.96]}>
          <boxGeometry args={[1.9, 0.18, 0.08]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        <mesh position={[0, 1.48, -3.96]}>
          <boxGeometry args={[1.9, 0.18, 0.08]} />
          <meshStandardMaterial color="#e2e8f0" />
        </mesh>
        {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz], i) => (
          <Wheel key={i} position={[sx * 1.06, 0.3, sz * 2.62]} scale={1.05} />
        ))}
      </group>
    );
  }

  if (type === 'truck') {
    return (
      <group>
        <RoundedBox args={[2.26, 1.42, 3.16]} radius={0.18} position={[0, 0.98, -1.16]}>
          <meshStandardMaterial color={col} metalness={0.34} roughness={0.38} />
        </RoundedBox>
        <RoundedBox args={[2.14, 1.8, 3.88]} radius={0.18} position={[0, 1.22, 1.66]}>
          <meshStandardMaterial color="#e5e7eb" metalness={0.16} roughness={0.46} />
        </RoundedBox>
        <WindowGlass args={[1.84, 0.62, 1.2]} position={[0, 1.52, -2.0]} opacity={0.72} />
        {[[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]].map(([sx, row], i) => (
          <Wheel key={i} position={[sx * 1.0, 0.26, -1.5 + row * 1.52]} scale={0.98} />
        ))}
      </group>
    );
  }

  return (
    <group>
      <RoundedBox args={[1.92, 0.92, 4.38]} radius={0.22} position={[0, 0.66, 0.06]}>
        <meshStandardMaterial color={col} metalness={0.5} roughness={0.35} />
      </RoundedBox>
      <RoundedBox args={[1.72, 0.54, 1.86]} radius={0.18} position={[0, 1.12, -0.22]}>
        <meshStandardMaterial color={col} metalness={0.48} roughness={0.3} />
      </RoundedBox>
      <WindowGlass args={[1.48, 0.34, 1.12]} position={[0, 1.2, -0.28]} opacity={0.72} />
      <mesh position={[0, 0.96, 1.68]}>
        <boxGeometry args={[1.2, 0.08, 0.14]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz], i) => (
        <Wheel key={i} position={[sx * 0.86, 0.24, sz * 1.46]} scale={0.9} />
      ))}
      {emergency && (
        <mesh position={[0, 1.72, 0]}>
          <boxGeometry args={[0.6, 0.15, 0.3]} />
          <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  );
}

function Vehicle({ vehicle }) {
  return (
    <group position={[vehicle.x, 0, vehicle.z]} rotation={[0, vehicle.renderRotation ?? headingToRotation(vehicle.heading), 0]}>
      <CarBody
        type={vehicle.vehicle_type}
        color={VEHICLE_COLORS[vehicle.vehicle_type] || '#7dd3fc'}
        emergency={vehicle.is_emergency || vehicle.vehicle_type === 'ambulance'}
      />
    </group>
  );
}

function RoadNetwork() {
  return (
    <group>
      <Ground />
      {ROAD_PATHS.map((path) => (
        <RoadPolyline key={path.key} points={path.points} />
      ))}
    </group>
  );
}

function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight position={[50, 90, 40]} intensity={1.05} castShadow />
      <hemisphereLight args={['#d9f99d', '#1e293b', 0.5]} />
    </>
  );
}

function CameraRig({ focus, controlsRef }) {
  const { camera } = useThree();
  const transitionRef = useRef(null);

  useEffect(() => {
    const targetView = FOCUS_POINTS[focus] || FOCUS_POINTS.overview;
    transitionRef.current = {
      camera: new THREE.Vector3(...targetView.camera),
      target: new THREE.Vector3(...targetView.target),
    };
  }, [focus]);

  useFrame(() => {
    if (!transitionRef.current) return;
    camera.position.lerp(transitionRef.current.camera, 0.12);
    if (controlsRef.current?.target) {
      controlsRef.current.target.lerp(transitionRef.current.target, 0.12);
      controlsRef.current.update();
    }
    const done =
      camera.position.distanceTo(transitionRef.current.camera) < 0.2 &&
      controlsRef.current?.target?.distanceTo(transitionRef.current.target) < 0.2;
    if (done) transitionRef.current = null;
  });

  return null;
}

export default function SimulationCanvas3D({ state }) {
  const [focus, setFocus] = useState('overview');
  const controlsRef = useRef(null);
  const motionRef = useRef(new Map());
  const intersections = state?.intersections || [];
  const byId = useMemo(() => Object.fromEntries(intersections.map((entry) => [entry.id, entry])), [intersections]);
  const vehicles = useMemo(() => {
    const next = [];
    const now = new Map();
    for (const vehicle of state?.visual_vehicles || []) {
      const previous = motionRef.current.get(vehicle.id);
      let renderRotation = previous?.renderRotation ?? headingToRotation(vehicle.heading);
      const dx = previous ? vehicle.x - previous.x : 0;
      const dz = previous ? vehicle.z - previous.z : 0;
      if (Math.hypot(dx, dz) > 0.02) {
        renderRotation = Math.atan2(dx, dz);
      }
      const enriched = { ...vehicle, renderRotation };
      next.push(enriched);
      now.set(vehicle.id, { x: vehicle.x, z: vehicle.z, renderRotation });
    }
    motionRef.current = now;
    return next;
  }, [state?.visual_vehicles]);

  useEffect(() => {
    if (!state?.started) {
      setFocus('overview');
    }
  }, [state?.started]);

  return (
    <div className="relative h-[760px] w-full overflow-hidden rounded-[28px] bg-[#0a1220]">
      <div className="absolute left-4 top-4 z-10 flex flex-wrap gap-2">
        {[
          ['overview', 'Overview'],
          ['TL_00', 'NW (TL_00)'],
          ['TL_01', 'NE (TL_01)'],
          ['TL_10', 'SW (TL_10)'],
          ['TL_11', 'SE (TL_11)'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFocus(id)}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition ${
              focus === id
                ? 'bg-white text-slate-900'
                : 'bg-slate-900/70 text-slate-100 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="absolute bottom-4 left-4 z-10 rounded-2xl bg-slate-950/65 px-4 py-3 text-xs text-slate-200 backdrop-blur">
        Drag to orbit. Scroll to zoom. Use the focus buttons to jump between intersections.
      </div>

      <Canvas
        shadows
        camera={{ position: FOCUS_POINTS.overview.camera, fov: 42, near: 0.5, far: 700 }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#1f5f2b']} />
        <Suspense fallback={null}>
          <SceneLights />
          <RoadNetwork />
          <CameraRig focus={focus} controlsRef={controlsRef} />
          {Object.entries(INTERSECTIONS).map(([id, pos]) => (
            <IntersectionPad key={id} id={id} pos={pos} state={byId[id]} />
          ))}
          {vehicles.map((vehicle) => (
            <Vehicle key={vehicle.id} vehicle={vehicle} />
          ))}
          <OrbitControls
            ref={controlsRef}
            makeDefault
            target={FOCUS_POINTS.overview.target}
            enablePan
            enableZoom
            enableRotate
            rotateSpeed={0.65}
            panSpeed={0.9}
            zoomSpeed={0.85}
            minDistance={18}
            maxDistance={280}
            maxPolarAngle={Math.PI * 0.49}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
