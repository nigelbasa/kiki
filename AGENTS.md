# Rwendo — Smart Traffic Control System

## What This Is
A web-based smart traffic signal control prototype for multi-intersection
networks. Built as a university capstone (University of Zimbabwe, AI & ML).
Two separate portals sharing one backend.

## Lead Engineer Notes
The human operator gives high-level direction in chat. Codex implements.
Always ask for clarification before making architectural decisions not covered here.
Prefer simple, working code over clever abstractions. Build incrementally.

---

## Repository Structure
v4/
├── AGENTS.md
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── simulation/
│   │   ├── engine.py            # Discrete-time simulation loop
│   │   ├── intersection.py      # IntersectionController class
│   │   ├── network.py           # Three-intersection network
│   │   ├── vehicles.py          # Vehicle generation + movement
│   │   ├── emergency.py         # Preemption logic
│   │   └── spillback.py         # Spillback detection + signaling
│   ├── detection/
│   │   ├── worker.py            # YOLO detection worker (separate process)
│   │   ├── zones.py             # Zone polygon management
│   │   └── annotator.py         # Bounding box annotation + output
│   ├── api/
│   │   ├── simulation_routes.py
│   │   ├── detection_routes.py
│   │   └── analytics_routes.py
│   ├── sockets/
│   │   └── events.py            # Socket.IO event definitions
│   └── models/
│       └── schemas.py           # Pydantic schemas
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── shared/                  # Shared components, hooks, utils
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/
│   ├── admin/                   # Admin portal entry point
│   │   ├── main-admin.jsx
│   │   ├── App.jsx
│   │   └── pages/
│   │       ├── SimulationPage.jsx
│   │       ├── DetectionPage.jsx
│   │       ├── AnalyticsPage.jsx
│   │       └── SettingsPage.jsx
│   └── public-portal/           # Public portal entry point
│       ├── main-public.jsx
│       ├── App.jsx
│       └── pages/
│           ├── LiveMapPage.jsx
│           └── AlertsPage.jsx
│
└── docs/
└── architecture.md

---

## Tech Stack (Fixed — Do Not Change Without Asking)

### Backend
- **Python 3.11+**
- **FastAPI** — async, WebSocket native
- **python-socketio** with **uvicorn** ASGI server
- **Ultralytics YOLOv11** — vehicle detection
- **OpenCV** — video frame processing, annotation
- **Pydantic v2** — data validation and schemas

### Frontend
- **React 18** + **Vite**
- **Two separate build entry points** — admin and public-portal
  - Admin bundle must NEVER contain public-portal code and vice versa
  - Shared code lives in `/shared/` only
- **React Three Fiber + Drei** — 3D simulation visualization (admin only)
- **Tailwind CSS** — styling
- **Socket.IO client** — real-time updates
- **Recharts** — analytics charts (admin only)

### No These — Do Not Use
- Redux (use React Context + useReducer)
- React Router v5 (use v6)
- Axios (use native fetch with a thin wrapper)
- SUMO / TraCI (simulation is custom-built)
- Express / Node backend

---

## Colour Palette (Rwendo Brand)
CSS custom properties — define in shared globals:
```css
--color-bg: #ffffff
--color-signal-green: #4ade80
--color-signal-amber: #fb923c
--color-signal-red: #f87171
--color-congestion-clear: #86efac
--color-congestion-moderate: #fde68a
--color-congestion-heavy: #fca5a5
--color-accent: #f97316   /* light orange — primary brand */
```

---

## Simulation — Core Concepts

### The Network
Three intersections in an L-shaped layout:
- **TL_00** — Samora Machel Ave / Julius Nyerere Way (top-left)
- **TL_10** — Harare Drive / Borrowdale Road (bottom-left)
- **TL_11** — Third intersection (bottom-right)

Road segments connect them:
- TL_00 → TL_10 (vehicles discharged south from TL_00 arrive at TL_10)
- TL_10 → TL_11 (vehicles discharged east from TL_10 arrive at TL_11)

### Simulation Loop
Discrete time steps (1 step = 1 second simulated time).
Each step:
1. Generate new vehicle arrivals (Poisson distribution, rate varies by scenario)
2. Advance vehicles along road segments
3. Update queues at each intersection approach
4. Evaluate signal phase (adaptive or fixed-time depending on mode)
5. Discharge vehicles through green phase
6. Check spillback conditions
7. Publish state snapshot via Socket.IO

### Signal Modes (per intersection, independently switchable)
- **Fixed**: Preset green/amber durations, cycles unconditionally
- **Adaptive**: Green duration proportional to queue length,
  clamped to [min_green, max_green]. Checks downstream queue
  before releasing (spillback prevention).

### Emergency Preemption
States: `idle → injected → preempting → active → clearing → recovering → idle`
- On injection: all non-EV-path phases → red, EV path → green within 2s
- Propagates to downstream intersections ahead of the vehicle
- On clearance: controller resumes from last phase

### Spillback
TL_00 checks TL_10's queue before releasing eastbound/southbound green.
If TL_10 queue > spillback_threshold, TL_00 caps its green to minimum
to avoid flooding the segment.

---

## Vehicle Detection Module (Separate from Simulation)

This is a **demo module** — it does not drive the simulation.
Purpose: prove that the system can accurately detect and classify
vehicles from real video footage.

### What It Does
1. Operator uploads a video file via admin dashboard
2. Backend runs YOLOv11 on each frame
3. Annotated frames are returned with:
   - Bounding boxes per detected vehicle
   - Class label (car, truck, bus, motorcycle)
   - Confidence score
   - Zone-based vehicle counts (user defines polygon zones per approach)
4. Annotated video is available for download/playback in dashboard

### What It Does NOT Do (yet)
- It does not feed counts into the live simulation automatically
- (Future: could seed one intersection's arrival rate from extracted counts)

### Zone Configuration
Operator draws polygonal zones on the video frame (one per approach arm).
Detection counts only vehicles whose bounding box centroid falls inside a zone.

---

## API Conventions

### REST endpoints
- `GET /api/simulation/state` — current simulation state snapshot
- `POST /api/simulation/control` — pause/resume/reset/set-mode
- `POST /api/simulation/preempt` — trigger emergency preemption
- `POST /api/detection/upload` — upload video for detection
- `GET /api/detection/status/{job_id}` — detection job progress
- `GET /api/analytics/runs` — list past simulation runs
- `GET /api/analytics/runs/{run_id}` — detailed metrics for a run

### Socket.IO events (server → client)
- `simulation:tick` — full state snapshot every simulation step
- `simulation:alert` — spillback or preemption alert
- `detection:progress` — detection job frame progress
- `detection:complete` — annotated video ready

### Socket.IO events (client → server)
- `simulation:command` — {action: pause|resume|reset|set_mode}
- `simulation:preempt` — {intersection_id, approach}

---

## Code Style

### Python
- Type hints everywhere (functions, class attributes)
- Docstrings on all public classes and methods
- Dataclasses or Pydantic models for all data structures — no raw dicts
- Async functions for all FastAPI route handlers
- Simulation engine must be synchronous internally (runs in executor)

### JavaScript / JSX
- Functional components only, no class components
- Custom hooks in `/shared/hooks/` for all Socket.IO logic
- No inline styles — Tailwind classes only
- Component files: PascalCase. Utility files: camelCase.
- All API calls go through `/shared/api/client.js` — never fetch() directly in components

---

## What to Build First (Sprint Order)
1. Repo structure + backend skeleton (FastAPI up, sockets connected, dummy state)
2. Frontend skeleton (both entry points render, connect to socket, show dummy data)
3. Simulation engine core (vehicle generation, movement, fixed-time controller)
4. Adaptive controller + spillback logic
5. Emergency preemption
6. 3D visualization in React Three Fiber
7. Admin dashboard pages (metrics, controls, analytics)
8. Detection module (YOLO worker, zone config UI, annotated playback)
9. Public portal (live map SVG, alerts, route suggestions)
10. Analytics + reporting

---

## Running the Project

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev:admin      # admin portal on :5173
npm run dev:public     # public portal on :5174
```

---

## Important Constraints
- Simulation state must be serializable to JSON at every tick (for Socket.IO)
- Detection runs in a separate process — never block the FastAPI event loop with CV work
- The public bundle must not import anything from `/admin/`
- All magic numbers (min_green, max_green, spillback_threshold etc.)
  must be in a single `backend/config.py` — never hardcoded inline

