import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard, OrbitControls, RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';

const INTERSECTIONS = {
  TL_00: { x: 0, z: 0 },
  TL_10: { x: 0, z: 72 },
  TL_11: { x: 150, z: 72 },
};

function relativePoints(points, center) {
  return points.map(([x, z]) => [x - center.x, z - center.z]);
}

const ROAD_PATHS = [
  {
    key: 'vertical_network',
    points: [
      [0, -90],
      [0, 162],
    ],
  },
  {
    key: 'borrowdale_network',
    points: [
      [-90, 72],
      [240, 72],
    ],
  },
  {
    key: 'samora_network',
    points: [
      [-90, 0],
      [0, 0],
      [150, 72],
    ],
  },
  {
    key: 'tl11_south_arm',
    points: [
      [150, 72],
      [150, 162],
    ],
  },
];

const JUNCTION_SHAPES = {
  TL_00: relativePoints([
    [-3.2, -7.2], [3.2, -7.2], [3.91, -3.98], [4.79, -2.55], [6.03, -1.23], [7.63, -0.03],
    [9.58, 1.05], [6.81, 6.82], [4.8, 6.3], [4.1, 6.52], [3.6, 7.06], [3.3, 7.91],
    [3.2, 9.09], [-3.2, 9.09], [-3.64, 5.82], [-4.2, 4.67], [-4.98, 3.85], [-5.98, 3.36],
    [-7.2, 3.2], [-7.2, -3.2], [-4.98, -3.64], [-4.2, -4.2], [-3.64, -4.98], [-3.31, -5.98],
  ], INTERSECTIONS.TL_00),
  TL_10: relativePoints([
    [-3.2, 64.8], [3.2, 64.8], [3.64, 67.02], [4.2, 67.8], [4.98, 68.36], [5.98, 68.69],
    [7.2, 68.8], [7.2, 75.2], [4.98, 75.64], [4.2, 76.2], [3.64, 76.98], [3.31, 77.98],
    [3.2, 79.2], [-3.2, 79.2], [-3.64, 76.98], [-4.2, 76.2], [-4.98, 75.64], [-5.98, 75.31],
    [-7.2, 75.2], [-7.2, 68.8], [-4.98, 68.36], [-4.2, 67.8], [-3.64, 67.02], [-3.31, 66.02],
  ], INTERSECTIONS.TL_10),
  TL_11: relativePoints([
    [157.2, 68.8], [157.2, 75.2], [154.98, 75.64], [154.2, 76.2], [153.64, 76.98], [153.31, 77.98],
    [153.2, 79.2], [146.8, 79.2], [145.15, 76.98], [143.08, 76.2], [140.19, 75.64], [136.48, 75.31],
    [131.94, 75.2], [131.94, 68.8], [132.33, 67.07], [135.1, 61.3], [139.58, 63.61], [142.91, 65.49],
    [145.72, 66.94], [148.62, 67.98], [152.24, 68.6],
  ], INTERSECTIONS.TL_11),
};

const FOCUS_POINTS = {
  overview: { camera: [92, 148, 196], target: [64, 0, 42] },
  TL_00: { camera: [18, 42, 42], target: [0, 0, 0] },
  TL_10: { camera: [18, 42, 116], target: [0, 0, 72] },
  TL_11: { camera: [176, 42, 116], target: [150, 0, 72] },
};

const INTERSECTION_PAD = 12;
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
      <mesh position={[64, -0.08, 36]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[520, 520]} />
        <meshStandardMaterial color="#4d7c0f" roughness={0.95} />
      </mesh>
      {[
        [8, 0, -30],
        [70, 0, -24],
        [-24, 0, 54],
        [122, 0, 88],
        [98, 0, 4],
        [24, 0, 112],
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

  return (
    <group position={[pos.x, 0, pos.z]}>
      <JunctionSurface points={JUNCTION_SHAPES[id]} />

      <SignalHead3D
        pos={[-ROAD_WIDTH * 0.28, 1.9, -INTERSECTION_PAD / 2 - 2.8]}
        rotation={[0, 0, 0]}
        phase={phases.NS}
        countdown={state?.approaches?.find((entry) => entry.direction === 'NS')?.countdown ?? 0}
      />
      <SignalHead3D
        pos={[ROAD_WIDTH * 0.28, 1.9, INTERSECTION_PAD / 2 + 2.8]}
        rotation={[0, Math.PI, 0]}
        phase={phases.NS}
        countdown={state?.approaches?.find((entry) => entry.direction === 'NS')?.countdown ?? 0}
      />
      <SignalHead3D
        pos={[-INTERSECTION_PAD / 2 - 2.8, 1.9, ROAD_WIDTH * 0.28]}
        rotation={[0, Math.PI / 2, 0]}
        phase={phases.EW}
        countdown={state?.approaches?.find((entry) => entry.direction === 'EW')?.countdown ?? 0}
      />
      <SignalHead3D
        pos={[INTERSECTION_PAD / 2 + 2.8, 1.9, -ROAD_WIDTH * 0.28]}
        rotation={[0, -Math.PI / 2, 0]}
        phase={phases.EW}
        countdown={state?.approaches?.find((entry) => entry.direction === 'EW')?.countdown ?? 0}
      />

      <Text
        position={[0, 0.4, INTERSECTION_PAD * 0.95]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={1.55}
        color="#e2e8f0"
        anchorX="center"
        anchorY="middle"
      >
        {id}
      </Text>

      {state?.spillback_active && (
        <mesh position={[0, 0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[INTERSECTION_PAD * 0.72, INTERSECTION_PAD * 0.84, 32]} />
          <meshBasicMaterial color="#fb923c" />
        </mesh>
      )}
      {state?.emergency_state && state.emergency_state !== 'idle' && <EmergencyRing />}
    </group>
  );
}

function SignalLamp({ y, active, color }) {
  return (
    <group position={[0, y, 0.22]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.16, 16]} />
        <meshStandardMaterial
          color={active ? color : '#111827'}
          emissive={active ? color : '#000000'}
          emissiveIntensity={active ? 1.6 : 0}
        />
      </mesh>
    </group>
  );
}

function SignalHead3D({ pos, rotation, phase, countdown }) {
  const lights = [
    { y: 0.52, key: 'red', color: SIGNAL_COLORS.red },
    { y: 0, key: 'amber', color: SIGNAL_COLORS.amber },
    { y: -0.52, key: 'green', color: SIGNAL_COLORS.green },
  ];

  return (
    <group position={pos} rotation={rotation}>
      <mesh castShadow receiveShadow position={[0, 0.1, 0]}>
        <boxGeometry args={[0.82, 1.72, 0.42]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh castShadow position={[0, -1.18, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 1.2, 10]} />
        <meshStandardMaterial color="#0f172a" />
      </mesh>
      {lights.map((light) => (
        <SignalLamp key={light.key} y={light.y} active={phase === light.key} color={light.color} />
      ))}
      <Billboard position={[1.7, 0.18, 0]}>
        <Text
          fontSize={1.18}
          color="#f8fafc"
          anchorX="left"
          anchorY="middle"
          outlineWidth={0.05}
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
      <torusGeometry args={[INTERSECTION_PAD * 0.8, 0.16, 12, 32]} />
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
          ['TL_00', 'TL_00'],
          ['TL_10', 'TL_10'],
          ['TL_11', 'TL_11'],
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
