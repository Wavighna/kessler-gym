# Kessler

**An AI that teaches satellites to dodge space junk.** A reinforcement-learning environment and live mission dashboard for satellite collision avoidance in low Earth orbit.

### ▶ Live demo: **[trykessler.work](http://trykessler.work)** · guided tour: **[trykessler.work/?tour](http://trykessler.work/?tour)**

No install, no backend: it is one self-contained HTML page (you can also open `index.html` locally).

## For judges: the 60-second guided demo

Press **Watch the 60-second guided demo** at the top of the page (or open `/?tour`). The tour highlights each panel, explains it in plain English, and flies one showcase scenario (#3700) three times:

1. **No avoidance:** 3 of 5 passes are unsafe.
2. **Operator rule** (today's practice: burn when collision probability > 1e-4): 1 unsafe pass, and it burns its whole 4 m/s fuel tank.
3. **AI pilot:** all 5 cleared, 3.78 m/s of fuel, and it stays ~5× closer to its orbit than the rule.

It then shows the honest average over 300 held-out scenarios (where the rule still has fewer violations) and starts live in-browser training. Arrow keys move through the tour; Esc exits.

## Explore the demo

The mission dashboard shows the satellite, close-approach geometry, collision probability, fuel use and orbit deviation. Switch between **AI policy**, **Operator rule** and **No avoidance** to restart the same scenario with a different controller. **Replay** repeats that scenario; **New scenario** generates another. Completed missions stay on screen so you can review the outcome.

The policy comparison evaluates all three controllers on the same 300 scenarios. Expand **Research lab** to train a new controller in the browser and inspect the physics. Your trained policy is evaluated separately on 64 scenarios and labeled accordingly. All encounters are simulated.

```bash
node train.js 800   # retrain (~5 min) -> weights.json
node build.js       # rebuild index.html
```

## One-liner
A reinforcement-learning environment where an AI agent learns to fly a satellite through debris conjunctions in low Earth orbit. It uses real orbital mechanics and realistic tracking uncertainty, under a fuel budget.

## The problem (30 s)
- LEO now holds more than 10,000 active satellites and tens of thousands of tracked debris objects.
- Starlink alone reports tens of thousands of collision-avoidance maneuvers per half-year, and that count roughly doubles every six months.
- Today most of this work is threshold rules plus human operators. That doesn't scale, and every unnecessary burn costs fuel, which means satellite lifetime.
- If avoidance fails, the result is a debris cascade (Kessler syndrome) that could close off whole orbital shells.

## What we built
1. **A Gym-style RL environment** (`core.js`, with the same reset/step API as Gymnasium):
   - Clohessy–Wiltshire relative dynamics, propagated with the closed-form state-transition matrix.
   - Debris arriving at 2–14 km/s. Each encounter is scored in the B-plane, which is how real conjunction analysis works.
   - Tracking uncertainty that shrinks as closest approach nears (400 m to 25 m). Collision probability Pc comes from the Rice distribution, computed with Bessel-function quadrature.
   - A 28-dim observation that includes a physics-informed feature, the STM sensitivity ∂|miss|/∂Δv.
   - Reward: keep-out violations, a proximity penalty, Δv cost, and slot-keeping cost.
2. **A learned policy**: a 2,083-parameter MLP trained with OpenAI-style Evolution Strategies (antithetic sampling, rank shaping, Adam). The distributed design follows Salimans et al.: workers exchange only random seeds and scalar fitness values.
3. **Baselines** for an honest comparison: no maneuvers, and an operator-style rule (Pc > 1e-4 trigger at a 25-min decision point, then a CW two-impulse return to slot).
4. **A live mission-ops dashboard**: a WebGL globe with ~6,000 debris objects propagated on the GPU in a shader, a live B-plane view, a Hill-frame trajectory plot, a conjunction timeline, a benchmark that runs 900 episodes in a Web Worker, and **live in-browser training across 8 parallel Web Workers**.

## Results (300 held-out scenarios, ~1,040 conjunctions)
| Policy | Violations | Mean Δv | Return |
|---|---|---|---|
| No maneuvers | 43.8% | 0 | −70.0 |
| Operator rule | 1.7% | 2.96 m/s | −33.6 |
| **RL agent (ES)** | 5.9% | 3.82 m/s | **−20.0** |

Read these honestly on stage. The RL agent scores best on the overall objective (return) and keeps the satellite closer to its slot (296 m vs 501 m). The hand-tuned rule still has fewer violations. The agent cut violations 7× versus doing nothing, learning only from reward. Closing that gap is the obvious next step: residual RL on top of the rule, PPO, and more training.

## Demo script (3 min, split across teammates)
1. **Problem** (teammate A): globe on screen. "Every dot is a tracked object. Ours is the amber one."
2. **Environment** (teammate B): point at the B-plane. The red disk is the keep-out zone. The amber dot is where we will pass. The dashed circle is the uncertainty, and it shrinks as tracking improves. That shrinking is the core trade-off: burn early (cheap, uncertain) or burn late (certain, expensive).
3. **Agent** (teammate C): switch between "No maneuvers", "Operator rule" and "RL agent" on the same scenario with Replay. Watch the CLEARED / VIOLATION outcome and the Δv bars.
4. **Learning live** (teammate D): press "Start training". The curve climbs past the no-maneuver line within about a minute, across 8 Web Workers. Then pick "RL agent (trained here)" and fly it.
5. **Close**: the benchmark table, then what we learned.

## What we learned (for the "Learning" criterion)
- Orbital relative motion: the CW equations, why an along-track burn turns into radial and along-track drift (the 3·Δv·τ rule), and B-plane geometry.
- Conjunction risk: Pc from Gaussian uncertainty, and why operators use 1e-4 thresholds.
- RL engineering: reward shaping, observation design (adding physics-informed features made learning possible), and why ES parallelizes better than policy gradients for cheap simulators.
- Systems: GPU-propagated particles in WebGL shaders, and seed-based communication between Web Workers.

## Prize mapping
- **Best ML / AI**: a custom RL environment, distributed ES, evaluation against baselines on held-out data, and live training in the browser.
- **Space track ("best leap in space")**: real astrodynamics (CW/STM, B-plane, Pc), aimed at a real, growing operational problem.
- **Overall / Technical difficulty**: physics simulator + ML + parallel compute + WebGL in one self-contained page, with no backend.
- **Impact**: space sustainability. Fewer wasted burns mean longer satellite lifetimes and a lower Kessler-cascade risk.
- **Creativity / Design**: a mission-ops console UI and an interactive B-plane, a view most people have never seen.
- **Functionality**: a single HTML file that works offline once loaded, and the benchmark reruns live on every load.

## Files
- `core.js`: environment, physics, policies, ES (shared by Node and the browser)
- `train.js`: offline multi-threaded training (`node train.js 800`, about 5 min) → `weights.json`
- `template.html` + `build.js` → `index.html` (self-contained demo)
