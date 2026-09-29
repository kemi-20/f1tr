# Race engineering evidence and implementation

Research reviewed on 2026-09-29. Eight research agents were assigned as requested:
two GPT-6 Sol (medium), three GPT-6 Luna (max), and three MiniMax M3.1 Flash Preview
(ultra). The concurrency limit was six, so the final two started when slots freed up.
The implementation owner reviewed their findings rather than merging their proposals verbatim.

## Research synthesis

| Assignment | Adopted direction |
| --- | --- |
| Sol: race strategy and engineer responsibilities | One driver-facing recommendation, executable alternatives, deadlines and contingency plans. |
| Sol: physical location and timing | Separate timing-sheet performance, race classification, cumulative distance and racing-loop proximity. |
| Luna: practice and qualifying | Purposeful practice runs, clock-based qualifying plans, evidence-based lap phases and timely traffic warnings. |
| Luna: tyres and fuel | Use actual game distance and observed consumption; expose sensitivity ranges, not universal wear thresholds. |
| Luna: telemetry/tool audit | Check source freshness and availability; expose map geometry and independent timing/position measures. |
| MiniMax: GP communication | Concise calls should follow a prepared decision; driver feedback is evidence, not disobedience. |
| MiniMax: Bono/Ferrari communication | Distinguish immediate instruction, recommendation and contingent plan; do not invent transcripts or current team roles. |
| MiniMax: orchestration and evaluation | Test false warnings, obsolete calls, missing data and repeated strategy demands; distinguish trigger review from a radio order. |

## Primary evidence

- [Mercedes: trackside engineering roles](https://www.mercedesamgf1.com/news/insight-the-trackside-engineers).
  Race engineering is the driver-facing link between multiple technical disciplines and cockpit feedback.
  F1TR combines their evidence without pretending it has a real crew or separate strategists.
- [F1: strategists](https://www.formula1.com/en/latest/article/watch-the-insiders-guide-to-f1-strategists.6VT3445ugVd0bh85Pw5slO).
  Preparatory scenario work makes rapid decisions possible. F1TR's preset now asks for the event that
  changes a plan and the deadline for acting, rather than waiting indefinitely for perfect data.
- [McLaren: Singapore 2022 strategy debrief](https://www.mclaren.com/racing/formula-1/2022/singapore-grand-prix/strategy-debrief/).
  Rival out-laps, tyre warm-up and driver feedback informed the crossover decision. This supports
  conditional strategy and the use of an observed reference, not fixed SC discounts or automatic undercuts.
- [F1: preparing a car through practice](https://www.formula1.com/en/latest/article/the-insiders-guide-to-preparing-a-car-through-practice.5xWpgp8nsTh6PCowm7bDEE).
  Practice should answer a performance question. Short game sessions require feasible priorities rather
  than copying a full real-world programme.
- [FIA: Hamilton impeding Verstappen, Monaco 2025](https://www.fia.com/system/files/decision-document/2025_monaco_grand_prix_-_infringement_-_car_44_-_impeding_of_car_1.pdf).
  Incorrect information about a car's push-lap state can lead to an unsafe traffic decision. Fresh phase
  and motion evidence must survive the delay between requesting and speaking a warning.
- [F1: GP/Verstappen radio at Spa 2023](https://www.formula1.com/en/latest/article/use-your-head-a-bit-more-relive-the-terse-radio-messages-between-verstappen.2j7fFfxfs3bqOFCaVbmGOx).
  The published exchange illustrates tension between tyre observations and cockpit judgement. Use the
  engineering feedback loop, not confrontational wording or imitation of a real person.
- [F1: Hamilton/Mercedes pit dilemma, Turkey 2021](https://www.formula1.com/en/latest/article/watch-hamilton-and-mercedes-pit-stop-dilemma-at-the-2021-turkish-grand-prix.5frEjBXU4SanVBiT6bPQ2Q).
  Driver preference and pit-wall assessment may differ. F1TR should revise the actionable plan without
  repeatedly demanding an unchanged stop.

These are selective published accounts, not complete team transcripts or access to private strategy
models. Examples in the preset are original hypothetical scenarios, not copied radio scripts.

## Decisions and rejected suggestions

- Keep engineering judgement in the native DSH agent preset; communication styles remain preferences.
- Fix evidence contracts as well as instructions: a broken timing chain must remain broken for all
  more distant cars. A local timing link cannot restart a player-relative total.
- Invalid order in a new LapData packet clears the old position and excludes the car from the timing
  chain; it must not refresh an old classification. Physical proximity remains independently usable.
  Across differing lap counters, timing remains conservatively unavailable (including a brief start-line
  crossing); this is missing evidence, not a zero-second gap.
- Use session lap metres for physical arcs even when reference-map length differs. Withhold calibrated
  sector/zone mapping on mismatch. Never replace live position with the nearest point on a parallel straight.
  The existing 1% map-length tolerance remains; responses disclose the length difference and warn that
  reference zone boundaries within that tolerance are approximate, not live game availability signals.
- Provide a 160-point JSON-derived full-loop reference with its resolution. It is not road-edge geometry,
  a surveyed corner-number map, or precise lane-clearance information.
- Require at least three coherent observations for relative-motion estimates. Thresholds are application
  heuristics, not FIA limits. A catch ETA is not a race gap or future pit-rejoin prediction.
- Keep user-specified 3/5-lap game and sprint rule exceptions. Do not reinterpret those as FIA rules or
  import historical Monaco-specific regulations into every game/year.
- Reject suggestions to treat every wear-trigger wakeup as a pit command, ban all cooling-lap radio,
  enforce arbitrary safety percentages, or equate real radio publication rules with this app's privacy.
- Exclude unrelated or unverified citations proposed during research. No claim of complete verified
  Ferrari/Bono transcripts is made.

## Validation boundaries

Deterministic tests cover fastest-lap versus physical gaps, race/UI signs, whole-lap and start-line cases,
broken timing chains, stale/future/asynchronous samples, pit routes, flashbacks, passes, missing maps,
calibration mismatch, old Motion coordinates and invalid tool arguments. Playback tests check that a
previously approaching car still approaches before the warning is spoken.

Prompt policy is not deterministic enforcement. The changes do not train model weights, prove a numeric
intelligence improvement, or guarantee correct live strategy. Real UDP replay and in-game sessions are
still needed to calibrate false-alarm rates, latency, estimates and model adherence. Production packaging
is performed in CI, not locally.
