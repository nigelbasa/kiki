# Rwendo Adaptive Signal Algorithm

This document describes how the **adaptive** mode of the Rwendo signal controller
makes its decisions. Fixed mode just rotates through `["NS", "EW"]` with a
constant `(MIN_GREEN + MAX_GREEN) / 2` duration and is intentionally dumb so it
serves as a baseline — everything below applies to adaptive mode only.

Source of truth: [`backend/simulation/sumo_network.py`](../backend/simulation/sumo_network.py).

---

## 1. Network model

The simulated city is a 100 m × 100 m rectangle with four signalised corners:

```
TL_00 (NW) ────top edge──── TL_01 (NE)
   │                            │
 left                         right
 edge                          edge
   │                            │
TL_10 (SW) ───bottom edge──── TL_11 (SE)
```

Each corner has two **internal** approaches (from its perimeter neighbours) and
two **external stubs** (where vehicles enter/leave the network). The four
approaches at every junction are grouped into two signal plans:

- **NS plan** — green for traffic on the North + South arms.
- **EW plan** — green for traffic on the East + West arms.

SUMO's `netconvert` generates the underlying traffic-light program; the Python
controller drives it via TraCI (`traci.trafficlight.setPhase` /
`setPhaseDuration`). Phase indices are uniform across all four corners:
`0 = NS green`, `1 = NS yellow`, `2 = EW green`, `3 = EW yellow`.

---

## 2. Vehicle sensing

The controller never inspects individual vehicles to decide phases. Instead it
turns each approach into a single scalar **demand score** that's stable enough
to reason about.

### 2.1 Raw per-edge measurements

For every inbound edge `e` the controller asks TraCI two questions:

- **Presence** — `traci.edge.getLastStepVehicleNumber(e)`: how many vehicles
  occupied the edge during the last simulation step.
- **Halts** — `traci.edge.getLastStepHaltingNumber(e)`: how many of those were
  stopped (queueing at the stop bar).

### 2.2 Detection score

`_edge_detection_score(e) = presence(e) + 0.85 * halts(e)`

Halting vehicles are weighted slightly less than 1 because a halted vehicle is
already counted in `presence`. The 0.85 weight makes a queue of N stopped
vehicles read as ~1.85·N rather than 2·N, which empirically matches the
behaviour of inductive-loop detectors better than either pure presence or pure
halts.

### 2.3 EMA smoothing for sizing

Raw scores flicker tick-to-tick: a single vehicle joining the queue can move
the score by ±1 in one tick. The controller uses two flavours of the same
signal:

- **Raw `detection_score`** — used for *selection* (picking the next plan). Fast
  reaction is good here: when a platoon arrives, you want to notice
  immediately.
- **Smoothed `sizing_demand`** — used for *sizing* (computing green duration).
  An EMA with α = 0.35 absorbs noise so the green duration doesn't oscillate by
  several seconds between consecutive cycles.

```
smoothed_new = smoothed_prev + 0.35 * (raw - smoothed_prev)
```

---

## 3. Phase selection (per junction, per cycle)

Each adaptive controller goes through this loop independently:

```
            ┌──────────────────────────────┐
            │   green (active plan_id)     │
            └─────────────┬────────────────┘
                          │ stage_remaining → 0
                          ▼
            ┌──────────────────────────────┐
            │  amber (default 1.5–3.0 s)   │
            └─────────────┬────────────────┘
                          │
                          ▼
                   _select_next_plan()
                          │
                          ▼
            ┌──────────────────────────────┐
            │   green (new plan_id)        │
            └──────────────────────────────┘
```

### 3.1 `_select_next_plan`

1. **Honour pending priority.** If `_priority_group_from_upstream` (see §5)
   flagged a direction last cycle, take it now.
2. **Score both groups.** `ns = _approach_detection_score(jct, "NS")`,
   `ew = _approach_detection_score(jct, "EW")`.
3. **Anti-starvation hysteresis.** If we *just* served NS, multiply NS by 0.72
   so EW gets a fair shot even if NS is still slightly busier. (Same for EW.)
4. **Tie-breaker.** If `|ns − ew| ≤ 0.8`, alternate (whichever wasn't served
   last).
5. **Otherwise pick the larger.**

The result is the next `plan_id` (`"NS"` or `"EW"`).

### 3.2 Green sizing — `_green_duration_for_plan`

```python
demand        = Σ sizing_demand(e) for e in plan.queue_edges   # smoothed
base          = MIN_GREEN + min(demand * 0.9, MAX_GREEN − MIN_GREEN)
coord_bonus   = min(5.0, upstream_segment_vehicles * 0.45)    # see §5
cap           = MIN_GREEN + 4.0   if spillback_active   else MAX_GREEN
duration      = clamp(base + coord_bonus, MIN_GREEN, cap)
```

So in practice:

- A near-empty approach gets ~`MIN_GREEN` (configurable, default 8 s).
- A heavily loaded approach maxes out at `MAX_GREEN` (default 28 s).
- If the *downstream* neighbour is congested (`spillback_active = True`), the
  green is aggressively capped at `MIN_GREEN + 4` so we don't dump more
  vehicles into a full receiver.
- An upstream neighbour already pushing a platoon toward us earns up to a
  +5 s **coordination bonus** so the platoon clears in one cycle.

### 3.3 Mid-cycle truncation — `_apply_adaptive_green_adjustments`

Phase sizing is decided at the *start* of green. But situations change. After
`MIN_GREEN` seconds elapsed, the controller re-checks every tick:

- If the active approach has ≤ 1 vehicle present AND the opposing approach has
  ≥ active + 3 vehicles present → truncate `stage_remaining` to ≤ 1 s. We're
  giving green to an empty road.
- Same with the EMA-smoothed demand: if `active_demand ≤ 2.2` AND
  `opposing_demand ≥ active + 3.2`, truncate.
- If `_priority_group_from_upstream` newly flags a priority group different
  from the current one, set `pending_priority_group` and clip `stage_remaining`
  to ≤ 2 s so we hand over after a quick clearance.

This is what makes the average-wait curve in adaptive mode dip below the fixed
baseline once load picks up.

---

## 4. Emergency vehicle handling

There are two ways an ambulance enters the network:

1. **Background spawn.** ~2 % of all generated vehicles are ambulances (weights
   table in `VEHICLE_WEIGHTS`).
2. **Manual injection.** The **Inject Emergency Vehicle** button on the
   simulation page calls `POST /api/simulation/spawn_emergency_random`, which
   picks a random junction + approach and adds an ambulance on that edge.

### 4.1 Detection (`_detect_waiting_ambulance_plan`)

Each tick, for every junction in adaptive mode:

1. For each plan group (NS, EW), find the leading vehicle on the approach
   edges. "Leading" means closest to the stop bar.
2. An ambulance qualifies for preemption when **all** of these hold:
   - It's actually an ambulance (`vehicle_id.endswith("ambulance")`).
   - It's the front-most vehicle in its lane (rank ≤ 1).
   - It's within 28 m of the stop bar.
   - It's moving slower than 1.5 m/s (i.e. queued, not free-flowing).
3. Among qualifying ambulances, pick the one closest to the stop bar.

### 4.2 Preemption state machine

```
IDLE ──ambulance detected──▶ INJECTED
                                  │
                                  ▼  next tick
                              ACTIVE  (green forced on ambulance's approach,
                                       hold = PREEMPTION_HOLD_SECONDS, min 4s)
                                  │
                          ┌───────┴───────┐
                          ▼               ▼
            ambulance left           hold expires
            stop-bar AND
            stage_elapsed ≥ 2 s
                          │               │
                          ▼               ▼
                       IDLE (return to normal phase selection)
```

Once `ACTIVE`, the controller calls `_set_green_plan(jct, ambulance_group, hold)`
which jumps the SUMO TLS straight to the green phase for that group. The
preemption is then maintained until either (a) the ambulance clears the
intersection or (b) the hold timer expires.

Fixed mode does NOT auto-preempt. An ambulance there just queues normally.

---

## 5. Green-wave coordination

Each junction makes its decisions locally, but the controller layers a small
**inter-junction priority signal** on top so platoons released by one corner
get caught by the next.

### 5.1 Topology table

The rectangle has 8 directional perimeter segments. The controller stores them
as a flat list (see `_PERIMETER_DIRECTIONAL_FLOWS` in `SumoMetricsAccumulator`
and `_UPSTREAM_FOR_GROUP` in `SumoNetwork`):

| Segment | Upstream sends with | Edge id | Downstream catches with |
|---|---|---|---|
| TL_00 → TL_01 | EW | `TL_00__TL_01` | EW |
| TL_01 → TL_00 | EW | `TL_01__TL_00` | EW |
| TL_10 → TL_11 | EW | `TL_10__TL_11` | EW |
| TL_11 → TL_10 | EW | `TL_11__TL_10` | EW |
| TL_00 → TL_10 | NS | `TL_00__TL_10` | NS |
| TL_10 → TL_00 | NS | `TL_10__TL_00` | NS |
| TL_01 → TL_11 | NS | `TL_01__TL_11` | NS |
| TL_11 → TL_01 | NS | `TL_11__TL_01` | NS |

Top + bottom edges carry EW flow, left + right edges carry NS flow.

### 5.2 Inbound priority — `_priority_group_from_upstream`

For each of my two perimeter neighbours, the controller asks:

> *Is the upstream junction currently green on the plan that pushes traffic
> toward me, AND is the segment carrying ≥ 3 vehicles?*

If yes for either neighbour, that group becomes my `pending_priority_group`
and (a) the current green is truncated to ≤ 2 s if it's a different group, and
(b) the next phase selection picks that group regardless of the local detection
scores. The effect is that a platoon released by an upstream green tends to
find my green already on by the time it arrives.

### 5.3 Green-duration coordination — `_compute_green_duration`

When I'm about to start a green that matches the direction of an inbound
platoon, I add a **coordination bonus** of up to 5 s
(`min(5.0, segment_vehicles × 0.45)`) on top of the demand-sized green so the
platoon clears in one cycle rather than getting split across two.

### 5.4 Downstream spillback — `_update_spillback_flag`

Coordination cuts both ways. Before I open a green that dumps traffic into a
downstream neighbour, the controller checks the downstream junction's approach
queues. If `Σ queues > SPILLBACK_THRESHOLD` (default 8 vehicles per neighbour
direction), I'm flagged `spillback_active`. That caps my green at
`MIN_GREEN + 4` to slow the rate I push vehicles into the bottleneck. This is
the reason congestion in adaptive mode tends to plateau where fixed mode keeps
climbing.

### 5.5 Green-wave success metric

`_record_green_wave` iterates the topology table once per tick. For every
segment where the upstream is currently green on its push-direction AND the
segment is carrying ≥ 1 vehicle, that's one **opportunity**. If the downstream
is also green on the matching direction at that moment, it's a **hit**. The
"Green wave success rate" the dashboard shows is `hits / opportunities`.

A run that consistently coordinates four corners on the same direction will
show this metric pegged at 100 %.

---

## 6. Tunable knobs (Settings page)

| Key | Default | What it controls |
|---|---|---|
| `MIN_GREEN` | 8 s | Lower bound on every green phase |
| `MAX_GREEN` | 28 s | Upper bound (also cap on demand-sized portion) |
| `AMBER_DURATION` | 3 s | Yellow time between phases |
| `TICK_RATE_HZ` | 20 Hz | Wall-clock target for the engine loop |
| `SPILLBACK_THRESHOLD` | 8 veh | Downstream queue size that flags spillback |
| `PREEMPTION_HOLD_SECONDS` | 4 s | Minimum forced-green duration for an ambulance |
| `RUNS_RETENTION` | 50 | How many completed runs to keep in memory |

Every knob is read from `config_runtime.cfg.get(...)` on each call so live edits
from the Settings page take effect within one tick.

---

## 7. Potential next improvements

1. **MARL / RL controller.** The current logic is a hand-tuned ruleset. A
   reinforcement-learning policy trained against the same SUMO network could
   discover better truncation/sizing trade-offs.
2. **Wider priority horizon.** Today only the *immediate* perimeter neighbour
   contributes to greenwave bonuses. Two-hop look-ahead would let a corner
   anticipate platoons that haven't yet arrived at its neighbour.
3. **Per-lane detection.** All decisions today aggregate over the whole edge.
   Per-lane scoring could exploit dedicated turning lanes once we move beyond
   1-lane roads.
4. **Probabilistic emergency dispatch.** The current detector is binary
   (ambulance within 28 m and slow → preempt). A probability-of-arrival model
   based on speed + distance would smooth out late preemptions.
5. **Cooperative platooning.** When two neighbours both have heavy demand in
   the same direction, they could pick a **shared cycle offset** instead of
   reactively coordinating, eliminating the start-up lost time per cycle.
