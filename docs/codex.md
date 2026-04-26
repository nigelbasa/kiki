
> Read CLAUDE.md fully before starting. Work through sections in order — later sections depend on earlier ones.
>
> ---
>
> ## SECTION 1 — Engine: Run Metric Tracking (`backend/simulation/engine.py` + `backend/simulation/network.py`)
>
> The `RunSummary` schema exists but nothing populates it yet. Fix that.
>
> ### In `network.py` — add a `MetricsAccumulator` class:
> ```
> class MetricsAccumulator:
>     Tracks per-tick data for one simulation run.
>
>     Fields:
>       total_wait_ticks_adaptive: int = 0
>       total_wait_ticks_fixed: int = 0   # fixed = same network but hypothetical baseline
>       vehicles_served: int = 0
>       spillback_events: int = 0
>       preemption_events: int = 0
>       tick_count: int = 0
>       green_wave_hits: int = 0          # ticks where TL_10 NS was green when vehicles arrived from TL_00
>
>     Methods:
>       record_tick(state: SimulationTickState) -> None
>         - Accumulate wait times from all intersection queues (sum of ticks_in_queue
>           for all vehicles currently in any queue)
>         - Increment spillback_events if any alert in state.alerts contains "spillback"
>         - Increment preemption_events if any alert contains "preemption"
>         - Increment tick_count
>
>       to_run_summary(run_id: str, started_at: str, scenario: str) -> RunSummary
>         avg_wait_time_adaptive = total_wait_ticks_adaptive / max(vehicles_served, 1)
>         avg_wait_time_fixed = avg_wait_time_adaptive * 1.35  # placeholder ratio until
>                                                               # parallel fixed sim added
>         green_wave_success_rate = green_wave_hits / max(tick_count, 1)
>         return RunSummary(...)
>
>       reset() -> None
> ```
>
> ### In `engine.py` — wire up accumulator:
> - Add `self._metrics = MetricsAccumulator()` and `self._run_start: str` (ISO timestamp)
> - In `_run_loop`: after each tick, call `self._metrics.record_tick(state)`
> - On `reset()`: finalise current run → call `_metrics.to_run_summary(...)`, append to
>   `run_history` (trim to `RUNS_RETENTION`), then `_metrics.reset()`, reset network
> - Expose `get_run_history() -> list[RunSummary]` — used by analytics routes
> - Update `analytics_routes.py` to call `engine.get_run_history()` instead of
>   accessing `engine.run_history` directly
>
> Also add to `SimulationTickState` schema (in `schemas.py`):
> ```python
> green_wave_success_rate: float = 0.0   # rolling rate for current run
> current_run_ticks: int = 0
> ```
> And emit these fields from the engine each tick.
>
> ---
>
> ## SECTION 2 — 3D Visualization (`frontend/admin/pages/SimulationPage.jsx`)
>
> Replace the current HTML-only SimulationPage with one that has a **3D canvas as the centrepiece** plus the existing control panels on the sides.
>
> ### Layout
> ```
> ┌─────────────────────────────────────────────────────┐
> │  Top bar: scenario badge | tick | run time | status │
> ├──────────────┬──────────────────────┬───────────────┤
> │  Left panel  │   3D Canvas (R3F)    │  Right panel  │
> │  (controls)  │                      │  (metrics)    │
> └──────────────┴──────────────────────┴───────────────┘
> │  Bottom: Pause | Resume | Reset | Scenario | Alerts │
> └─────────────────────────────────────────────────────┘
> ```
>
> ### 3D Scene — `frontend/admin/components/SimulationCanvas3D.jsx`
>
> Create this as a separate component, imported into SimulationPage.
>
> ```
> Props: { state: SimulationTickState | null }
>
> Camera: OrthographicCamera from @react-three/drei, top-down view.
>   zoom=60, position=[0, 15, 0], looking straight down.
>
> Road network geometry (static, does not change each tick):
>   L-shaped layout. Use these world coordinates:
>     TL_00 centre: (-4, 0, -3)
>     TL_10 centre: (-4, 0,  3)
>     TL_11 centre: ( 4, 0,  3)
>
>   Road segments as flat BoxGeometry planks (width=1, height=0.05, length=6):
>     TL_00 → TL_10: vertical plank between the two Y positions, at X=-4
>     TL_10 → TL_11: horizontal plank between the two X positions, at Z=3
>
>   Road colour: #374151 (dark grey)
>
> Intersection pads:
>   For each intersection: BoxGeometry(2, 0.1, 2) at its centre.
>   Colour by worst phase across approaches:
>     any RED → #f87171, any AMBER and no RED → #fb923c, all GREEN → #4ade80
>   On spillback_active: pulse the pad opacity between 0.6 and 1.0 (use useFrame)
>
> Signal lights:
>   For each approach of each intersection, render a small SphereGeometry(0.15)
>   offset from the intersection pad (NS approaches: ±Z offset, EW: ±X offset).
>   Colour matches SignalPhase: green/amber/red using the palette.
>   Add a PointLight of the same colour with intensity 0.8 at the sphere position.
>
> Queue length bars:
>   For each approach, render a thin BoxGeometry bar whose height = queue_length * 0.05
>   (clamped to max 2 units). Positioned just outside the intersection pad on the
>   approach side. Colour: white, semi-transparent.
>   Use useSpring from @react-spring/three for smooth height transitions.
>   Install @react-spring/three — add it to package.json.
>
> Vehicles in transit on segments:
>   For each segment, render up to 5 small BoxGeometry(0.2, 0.15, 0.2) vehicles
>   evenly spaced along the segment length. The number shown =
>   min(state.segments[i].vehicles_in_transit, 5).
>   Colour by vehicle count: 0=none, 1-2=#86efac, 3-4=#fde68a, 5=#fca5a5
>   (matches congestion palette). Animate them sliding along the segment with
>   useFrame (increment position each frame, loop back to start).
>
> Text labels:
>   Use Text from @react-three/drei for intersection names and queue counts.
>   Font size 0.3. Colour white. Rendered above each intersection pad.
>   Label format: "{name}\nNS:{ns_queue} EW:{ew_queue}"
>
> Emergency indicator:
>   When any intersection has emergency_state != "idle": render a red ring
>   (TorusGeometry) around that intersection pad, rotating on Y axis.
>
> Lighting:
>   AmbientLight intensity=0.4
>   DirectionalLight position=[5,10,5] intensity=0.8
>   (Plus the signal PointLights above)
>
> Performance:
>   Wrap the entire Canvas in React.Suspense.
>   Use instancedMesh for vehicles if count > 10 total.
>   The scene must not re-create geometries on every tick — use useMemo for
>   all static geometry. Only material colors and positions update per tick.
> ```
>
> ### Left panel (controls — move from current SimulationPage):
> - Mode toggle per intersection (FIXED | ADAPTIVE)
> - Preemption trigger buttons per intersection (NS / EW)
>
> ### Right panel (live metrics):
> - Per intersection: avg wait time this run (rolling), throughput count
> - Green wave success rate (%) from state.green_wave_success_rate
> - Spillback event count (from state.alerts, counted cumulatively on frontend)
> - Current run duration (from state.current_run_ticks, formatted as mm:ss)
>
> ---
>
> ## SECTION 3 — Analytics Page (`frontend/admin/pages/AnalyticsPage.jsx`)
>
> Build a functional page using Recharts. Fetches from `/api/analytics/runs` on mount (REST, not socket).
>
> ```
> Layout:
>   Header: "Simulation Analytics"
>   If no runs yet: empty state message "No completed runs yet. Reset the simulation to record a run."
>
>   Run selector: dropdown listing all RunSummary entries by run_id + scenario + date.
>   Compare toggle: checkbox "Compare two runs side by side"
>   When comparing, show a second dropdown for run B.
>
>   Charts (use Recharts ResponsiveContainer, width="100%"):
>
>   1. Bar chart: "Average Wait Time (seconds)"
>      Bars: avg_wait_time_adaptive (green) vs avg_wait_time_fixed (grey)
>      If comparing: grouped bars for run A and run B
>
>   2. Bar chart: "Spillback Events vs Preemption Events"
>      Two bars per run
>
>   3. Single stat cards (no chart needed):
>      - Duration (ticks → mm:ss)
>      - Scenario badge
>      - Green wave success rate formatted as percentage
>
>   Refresh button: re-fetches from API
> ```
>
> Add a nav link to AnalyticsPage in the admin App.jsx (simple tab bar: Simulation | Analytics | Detection | Settings).
>
> ---
>
> ## SECTION 4 — Detection Backend
>
> ### `backend/detection/zones.py`
> ```python
> from dataclasses import dataclass, field
> from typing import List, Tuple
>
> @dataclass
> class DetectionZone:
>     name: str              # e.g. "North approach"
>     polygon: List[Tuple[float, float]]   # normalised 0-1 coordinates
>
> @dataclass
> class ZoneConfig:
>     zones: List[DetectionZone] = field(default_factory=list)
>
>     def point_in_zone(self, zone: DetectionZone, x_norm: float, y_norm: float) -> bool:
>         """Ray-casting polygon containment test."""
>         ...implement ray-casting...
>
>     def classify_detection(self, x_norm: float, y_norm: float) -> str | None:
>         """Return zone name if point falls in any zone, else None."""
> ```
>
> ### `backend/detection/annotator.py`
> ```python
> """
> Takes a video file path + ZoneConfig.
> Runs YOLOv11 (ultralytics YOLO("yolo11n.pt")) frame by frame.
> For each frame:
>   - Run model(frame, classes=[2,3,5,7]) — car, motorcycle, bus, truck
>   - Draw bounding boxes with colour per class:
>       car=#4ade80, truck=#f87171, bus=#fb923c, motorcycle=#a78bfa
>   - Draw class label + confidence above each box
>   - Draw zone polygons as semi-transparent overlays (blue, 30% opacity)
>   - Draw per-zone vehicle count in top-left of each zone polygon
> Writes annotated frames to output video (cv2.VideoWriter, mp4v codec).
> Reports progress via a callback(frame_idx, total_frames).
> Returns: path to output file, list of per-frame ZoneCountRecord
> """
>
> @dataclass
> class ZoneCountRecord:
>     frame_idx: int
>     timestamp_sec: float
>     counts: dict[str, int]   # zone_name → vehicle count
> ```
>
> ### `backend/detection/worker.py`
> ```python
> """
> Manages detection jobs. Runs annotator in a ProcessPoolExecutor
> (not thread — CV/YOLO work must be off the GIL entirely).
>
> class DetectionWorker:
>     _jobs: dict[str, JobStatus]
>     _executor: ProcessPoolExecutor(max_workers=1)
>
>     async def submit_job(job_id, video_path, zone_config, progress_callback) -> str
>       Submits annotator to executor. Returns job_id.
>       Progress callback is called per frame — use asyncio.run_coroutine_threadsafe
>       to emit socket event from the executor process.
>
> @dataclass
> class JobStatus:
>     job_id: str
>     status: Literal["queued", "processing", "complete", "error"]
>     progress: float        # 0.0 to 1.0
>     output_path: str | None
>     zone_counts: list[ZoneCountRecord] | None
>     error: str | None
> ```
>
> ### `backend/api/detection_routes.py` — replace stub:
> ```
> POST /api/detection/upload
>   Accepts: multipart form — video file + zones JSON string
>   Saves video to /tmp/rwendo_uploads/{job_id}.mp4
>   Parses zones into ZoneConfig
>   Submits job to DetectionWorker singleton
>   Returns: { job_id: str }
>
> GET /api/detection/status/{job_id}
>   Returns: JobStatus as JSON
>
> GET /api/detection/result/{job_id}
>   Streams annotated video file back (FileResponse)
>   Returns 404 if not complete
>
> GET /api/detection/counts/{job_id}
>   Returns: list of ZoneCountRecord (JSON)
> ```
>
> Add `DetectionWorker` singleton to `main.py` startup (same pattern as engine).
> Wire Socket.IO progress event: on each frame, emit `detection:progress` with
> `{job_id, progress, frame_idx, total_frames}`. On complete emit `detection:complete`
> with `{job_id}`.
>
> Add to `useSimulation.js` hook (or create `frontend/shared/hooks/useDetection.js`):
> ```javascript
> // useDetection.js — separate hook, same socket instance
> // Listens for detection:progress and detection:complete events
> // Returns { jobProgress, jobComplete, jobId }
> // uploadVideo(file, zones) → POSTs to /api/detection/upload, stores job_id
> // fetchCounts(jobId) → GETs /api/detection/counts/{job_id}
> ```
>
> ---
>
> ## SECTION 5 — Detection Frontend (`frontend/admin/pages/DetectionPage.jsx`)
>
> ```
> Layout (three steps, shown sequentially):
>
> STEP 1 — Upload & Zone Configuration
>   File input: accepts video/* only. Shows filename when selected.
>   Once a file is selected, display the first frame as a preview image:
>     POST first frame extraction is too complex — instead show a grey placeholder
>     canvas (640×360) with text "Frame preview — draw zones below"
>
>   Zone drawing canvas (HTML5 Canvas, 640×360, overlaid on preview):
>     User clicks to add polygon points. Double-click closes a polygon → creates a zone.
>     Each zone gets an auto-name: "Zone A", "Zone B", etc.
>     Render completed zones as semi-transparent blue polygons with white labels.
>     "Clear zones" button resets all polygons.
>     Zones state stored in component: array of {name, polygon: [{x,y}]} where
>     x and y are normalised 0-1 (divide pixel coords by canvas dimensions).
>
>   "Start Detection" button:
>     Disabled until file selected and at least one zone drawn.
>     On click: calls uploadVideo(file, zones), advances to Step 2.
>
> STEP 2 — Processing
>   Progress bar (0–100%) driven by jobProgress from useDetection hook.
>   "Processing video... frame X of Y" text.
>   Animated pulse on the progress bar.
>   Auto-advances to Step 3 when jobComplete fires.
>
> STEP 3 — Results
>   Two-column layout:
>     Left: HTML5 <video> element with controls, src = /api/detection/result/{jobId}
>           (annotated video, streams from backend)
>     Right:
>       Per-zone count summary table:
>         Zone | Peak Count | Avg Count | Total Frames
>         Data computed from ZoneCountRecord list fetched via fetchCounts(jobId)
>
>       Line chart (Recharts): vehicle count over time per zone.
>         X axis: timestamp_sec. Y axis: count. One line per zone.
>         Use the Rwendo accent colours per zone line.
>
>   "Run another video" button → resets to Step 1.
> ```
>
> ---
>
> ## SECTION 6 — Admin App Navigation (`frontend/admin/App.jsx`)
>
> Replace placeholder with a real layout:
> ```
> Left sidebar (fixed, narrow):
>   Logo area: "Rwendo" in accent orange, small signal-light icon (SVG inline)
>   Nav links: Simulation | Analytics | Detection | Settings
>   Each link: icon (use simple inline SVG — no icon library) + label
>   Active link: accent orange background, white text
>   Inactive: grey text, transparent bg, hover: light grey bg
>
> Main content area (fills remaining width):
>   Renders active page component based on selected nav item
>   State managed with useState (no router needed for this scale)
>
> Connected indicator in sidebar footer:
>   Green dot + "Live" when socket connected, grey dot + "Offline" when not
>   connected value from useSimulation hook
> ```
>
> ---
>
> ## SECTION 7 — Public Portal polish (`frontend/public-portal/pages/LiveMapPage.jsx`)
>
> Update the existing LiveMapPage (do not rewrite from scratch):
>
> 1. Add a header bar: "Rwendo Traffic — Harare" with a small signal-light SVG icon
> 2. Add estimated delay display: for each segment, if congestion_level is "moderate"
>    show "+2–5 min" and if "heavy" show "+7+ min" as text alongside the segment line
> 3. Add an alternative routes panel below alerts:
>    When any alert exists, show:
>    "Suggested alternative: Mazowe Street southbound to Rotten Row. Estimated saving: 5 min."
>    (static text for now — the real routing engine is future work, be honest about this
>    with a small grey note "Route suggestions are indicative")
> 4. Add a simple account stub: "Sign in" button top-right (no auth logic — just a
>    disabled button with tooltip "Account features coming soon")
>
> ---
>
> ## Acceptance Criteria
> - [ ] `uvicorn main:app --reload` starts cleanly with DetectionWorker initialised
> - [ ] `GET /api/analytics/runs` returns an empty list `[]` on a fresh start and a populated list after one reset
> - [ ] `POST /api/detection/upload` with a video file + zones JSON returns a job_id
> - [ ] `GET /api/detection/status/{job_id}` returns status progression while processing
> - [ ] Admin app shows four nav items; each renders its page
> - [ ] SimulationPage has a visible 3D canvas with road geometry and signal lights
> - [ ] Queue bars visibly change height as queues grow and shrink
> - [ ] DetectionPage zone canvas accepts polygon drawing (click to add points, double-click to close)
> - [ ] AnalyticsPage shows empty state when no runs, and charts after a reset
> - [ ] No import errors in either frontend bundle
>
> List every file created or modified when done.