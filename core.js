// KESSLER-GYM core: orbital-mechanics RL environment + policy + evolution strategies.
// Runs unchanged in Node (offline training), the browser main thread (simulation)
// and Web Workers (distributed ES training).
(function (root) {
  'use strict';

  // ---------- Physics constants (SI) ----------
  const MU = 3.986004418e14;      // Earth GM, m^3/s^2
  const RE = 6378137;             // Earth radius, m
  const ALT = 550e3;              // reference orbit altitude (Starlink-like shell)
  const R0 = RE + ALT;
  const N = Math.sqrt(MU / (R0 * R0 * R0)); // mean motion, rad/s

  const CFG = {
    DT: 60,          // s per decision step
    T_MAX: 240,      // steps per episode (4 h, ~2.5 orbits)
    R_KO: 200,       // keep-out radius in the B-plane, m
    DV_MAX: 0.08,    // max delta-v per axis per step, m/s
    FUEL: 4,         // delta-v budget per episode, m/s
    SIG0: 400,       // 1-sigma position uncertainty 60 min before TCA, m
    SIGMIN: 25,      // floor of the uncertainty at TCA, m
    AIM: 180,        // spread of true miss distances (debris aimed at you), m
    W_FUEL: 2,       // reward cost per m/s of delta-v
    W_SLOT: 0.05,    // cost per step per km^2 of slot error
    P_VIOL: 30,      // penalty for a keep-out violation
    P_SHAPE: 10,     // shaped penalty, scaled by gaussian proximity
  };
  const N_OBS_CONJ = 2, OWN_DIM = 8, CONJ_DIM = 10;
  const OBS_DIM = OWN_DIM + CONJ_DIM * N_OBS_CONJ;
  const HID = 32, ACT_DIM = 3;

  // ---------- RNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const u = mulberry32((seed >>> 0) ^ 0x9E3779B9);
    let spare = null;
    return {
      u,
      n() {
        if (spare !== null) { const s = spare; spare = null; return s; }
        let a, b, r;
        do { a = 2 * u() - 1; b = 2 * u() - 1; r = a * a + b * b; } while (r >= 1 || r === 0);
        const f = Math.sqrt(-2 * Math.log(r) / r);
        spare = b * f; return a * f;
      },
    };
  }

  // ---------- Small vector helpers ----------
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => Math.sqrt(dot(a, a));
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => scale(a, 1 / (norm(a) || 1));
  const mv = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  const mtv = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    const k = 1 / det;
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
            B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
            C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
  }

  // ---------- Clohessy-Wiltshire state transition matrix ----------
  // Hill frame: x radial, y along-track, z cross-track.
  function stm(tau) {
    const nt = N * tau, s = Math.sin(nt), c = Math.cos(nt);
    return {
      rr: [4 - 3 * c, 0, 0, 6 * (s - nt), 1, 0, 0, 0, c],
      rv: [s / N, 2 * (1 - c) / N, 0, -2 * (1 - c) / N, (4 * s - 3 * nt) / N, 0, 0, 0, s / N],
      vr: [3 * N * s, 0, 0, 6 * N * (c - 1), 0, 0, 0, 0, -N * s],
      vv: [c, 2 * s, 0, -2 * s, 4 * c - 3, 0, 0, 0, c],
    };
  }
  function propagate(p, v, tau) {
    const S = stm(tau);
    return { p: add(mv(S.rr, p), mv(S.rv, v)), v: add(mv(S.vr, p), mv(S.vv, v)) };
  }

  // ---------- Collision probability (2D isotropic Gaussian over a disk) ----------
  function i0e(x) { // exp(-|x|) * I0(x), Abramowitz & Stegun 9.8.1/9.8.2
    const ax = Math.abs(x);
    if (ax < 3.75) {
      const y = (x / 3.75) * (x / 3.75);
      return Math.exp(-ax) * (1 + y * (3.5156229 + y * (3.0899424 + y * (1.2067492 + y * (0.2659732 + y * (0.0360768 + y * 0.0045813))))));
    }
    const y = 3.75 / ax;
    return (1 / Math.sqrt(ax)) * (0.39894228 + y * (0.01328592 + y * (0.00225319 + y * (-0.00157565 + y * (0.00916281 + y * (-0.02057706 + y * (0.02635537 + y * (-0.01647633 + y * 0.00392377))))))));
  }
  // P(|m| < R) for m ~ N(mean with |mean| = d, sig^2 I) — Rice distribution CDF via Simpson.
  function collisionProb(d, sig, R) {
    const K = 24, h = R / K, s2 = sig * sig;
    let sum = 0;
    for (let i = 0; i <= K; i++) {
      const r = i * h;
      const f = (r / s2) * Math.exp(-(r - d) * (r - d) / (2 * s2)) * i0e(r * d / s2);
      sum += (i === 0 || i === K ? 1 : (i % 2 ? 4 : 2)) * f;
    }
    return Math.max(0, Math.min(1, sum * h / 3));
  }

  // ---------- Environment ----------
  class Env {
    constructor(cfg) { this.c = Object.assign({}, CFG, cfg || {}); }

    reset(seed) {
      const c = this.c, R = makeRng(seed);
      this.seed = seed; this.t = 0;
      this.p = [R.n() * 50, R.n() * 100, R.n() * 50];
      this.v = [0, -1.5 * N * this.p[0], 0]; // drift-free initial condition
      this.fuel = c.FUEL; this.dvUsed = 0; this.slotErr = 0;
      const nC = 2 + Math.floor(R.u() * 4);
      this.conj = [];
      for (let i = 0; i < nC; i++) {
        const tca = 35 + Math.floor(R.u() * (c.T_MAX - 45));
        const lead = 15 + Math.floor(R.u() * 46);
        const speed = 2000 + R.u() * 12000;
        const ang = R.u() * 2 * Math.PI;
        const vhat = unit([0.15 * R.n(), Math.cos(ang), Math.sin(ang)]);
        const e1 = unit(sub([1, 0, 0], scale(vhat, vhat[0])));
        const e2 = cross(vhat, e1);
        this.conj.push({
          id: i, tca, tdet: Math.max(0, tca - lead), speed, vhat, e1, e2,
          mt: [R.n() * c.AIM, R.n() * c.AIM], noise: [R.n(), R.n()],
          pd: null, done: false, miss: null, viol: false,
        });
      }
      this.conj.sort((a, b) => a.tca - b.tca);
      this._detect();
      return this.obs();
    }

    _detect() {
      for (const k of this.conj) {
        if (!k.pd && this.t >= k.tdet) {
          const pr = propagate(this.p, this.v, (k.tca - this.t) * this.c.DT).p;
          // debris crosses the satellite's *current* predicted position, offset by the true miss
          k.pd = sub(pr, add(scale(k.e1, k.mt[0]), scale(k.e2, k.mt[1])));
        }
      }
    }

    sigma(tau) {
      const c = this.c;
      return c.SIGMIN + (c.SIG0 - c.SIGMIN) * Math.min(1.5, tau / 3600);
    }

    // What the operator / agent can see about a conjunction (noisy, uncertainty-aware).
    assess(k) {
      const c = this.c, tau = (k.tca - this.t) * c.DT, S = stm(tau);
      const pp = add(mv(S.rr, this.p), mv(S.rv, this.v));
      const dd = sub(pp, k.pd);
      const sig = this.sigma(tau);
      const q = [dot(dd, k.e1) + sig * k.noise[0], dot(dd, k.e2) + sig * k.noise[1]];
      const m3 = add(scale(k.e1, q[0]), scale(k.e2, q[1]));
      const dist = Math.hypot(q[0], q[1]);
      const mhat = scale(m3, 1 / (dist || 1));
      const g = mtv(S.rv, mhat); // d|miss| / d(delta-v): physics-informed sensitivity
      return { tau, q, m3, dist, sig, g, pc: collisionProb(dist, sig, c.R_KO) };
    }

    upcoming() {
      return this.conj.filter((k) => k.pd && !k.done && k.tca > this.t);
    }

    obs() {
      const c = this.c, o = new Float64Array(OBS_DIM);
      o[0] = this.p[0] / 1000; o[1] = this.p[1] / 1000; o[2] = this.p[2] / 1000;
      o[3] = this.v[0] / 0.3; o[4] = this.v[1] / 0.3; o[5] = this.v[2] / 0.3;
      o[6] = this.fuel / c.FUEL; o[7] = this.t / c.T_MAX;
      const up = this.upcoming();
      this.lastAssess = [];
      for (let j = 0; j < N_OBS_CONJ && j < up.length; j++) {
        const a = this.assess(up[j]); a.k = up[j];
        this.lastAssess.push(a);
        const b = OWN_DIM + j * CONJ_DIM;
        o[b] = 1; o[b + 1] = a.tau / 3600;
        o[b + 2] = a.m3[0] / (2 * c.R_KO); o[b + 3] = a.m3[1] / (2 * c.R_KO); o[b + 4] = a.m3[2] / (2 * c.R_KO);
        o[b + 5] = a.g[0] / 3000; o[b + 6] = a.g[1] / 3000; o[b + 7] = a.g[2] / 3000;
        o[b + 8] = a.sig / c.SIG0; o[b + 9] = a.pc;
      }
      return o;
    }

    step(a) {
      const c = this.c;
      let dv = [clip(a[0]) * c.DV_MAX, clip(a[1]) * c.DV_MAX, clip(a[2]) * c.DV_MAX];
      let mag = norm(dv);
      if (mag > this.fuel) { dv = scale(dv, this.fuel / mag); mag = this.fuel; }
      this.fuel -= mag; this.dvUsed += mag; this.lastDv = dv;
      this.v = add(this.v, dv);
      let r = -c.W_FUEL * mag;
      const st = propagate(this.p, this.v, c.DT);
      this.p = st.p; this.v = st.v; this.t++;
      const events = [];
      for (const k of this.conj) {
        if (!k.done && k.tca === this.t) {
          const dd = sub(this.p, k.pd);
          const d = Math.hypot(dot(dd, k.e1), dot(dd, k.e2));
          k.miss = d; k.viol = d < c.R_KO; k.done = true;
          r -= (k.viol ? c.P_VIOL : 0) + c.P_SHAPE * Math.exp(-d * d / (2 * c.R_KO * c.R_KO));
          events.push(k);
        }
      }
      const e = norm(this.p) / 1000;
      this.slotErr += e;
      r -= c.W_SLOT * e * e + (e > 5 ? 1 : 0);
      this._detect();
      const done = this.t >= c.T_MAX;
      return { obs: this.obs(), r, done, events };
    }
  }
  const clip = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);

  // ---------- Policies ----------
  const N_PARAMS = OBS_DIM * HID + HID + HID * HID + HID + HID * ACT_DIM + ACT_DIM;

  function initTheta(seed) {
    const R = makeRng(seed), th = new Float64Array(N_PARAMS);
    let i = 0;
    const layer = (fin, fout, gain) => {
      const s = gain / Math.sqrt(fin);
      for (let k = 0; k < fin * fout; k++) th[i++] = R.n() * s;
      i += fout; // biases start at zero
    };
    layer(OBS_DIM, HID, 1); layer(HID, HID, 1); layer(HID, ACT_DIM, 0.1);
    return th;
  }

  // MLP: obs -> tanh(32) -> tanh(32) -> tanh(3)
  const h1 = new Float64Array(HID), h2 = new Float64Array(HID);
  function mlpAct(th, o) {
    let i = 0;
    for (let j = 0; j < HID; j++) h1[j] = 0;
    for (let k = 0; k < OBS_DIM; k++) { const x = o[k]; for (let j = 0; j < HID; j++) h1[j] += x * th[i++]; }
    for (let j = 0; j < HID; j++) h1[j] = Math.tanh(h1[j] + th[i++]);
    for (let j = 0; j < HID; j++) h2[j] = 0;
    for (let k = 0; k < HID; k++) { const x = h1[k]; for (let j = 0; j < HID; j++) h2[j] += x * th[i++]; }
    for (let j = 0; j < HID; j++) h2[j] = Math.tanh(h2[j] + th[i++]);
    const out = [0, 0, 0];
    for (let k = 0; k < HID; k++) { const x = h2[k]; for (let j = 0; j < ACT_DIM; j++) out[j] += x * th[i++]; }
    for (let j = 0; j < ACT_DIM; j++) out[j] = Math.tanh(out[j] + th[i++]);
    return out;
  }

  const noopPolicy = () => [0, 0, 0];

  // Operator-style collision avoidance: wait for the decision point (Pc > 1e-4 inside 25 min),
  // then burn along the sensitivity direction until predicted miss >= R + 2.5 sigma.
  // Between threats, return to slot with a CW two-impulse targeting burn.
  function rulePolicy(env) {
    const c = env.c, A = env.lastAssess || [];
    for (const a of A) {
      if (a.pc > 1e-4 && a.tau <= 1500) {
        const target = c.R_KO + 2.5 * a.sig;
        if (a.dist >= target) return [0, 0, 0];
        const gn = norm(a.g) || 1;
        const need = (target - a.dist) / gn;
        const mag = Math.min(need, c.DV_MAX);
        const d = scale(a.g, mag / gn / c.DV_MAX);
        return [clip(d[0]), clip(d[1]), clip(d[2])];
      }
    }
    const busy = A.some((a) => a.tau < 1500 && a.pc > 1e-5);
    if (!busy && norm(env.p) > 250) {
      const S = stm(1800);
      const vreq = scale(mv(inv3(S.rv), mv(S.rr, env.p)), -1);
      let dv = sub(vreq, env.v);
      const m = norm(dv), lim = c.DV_MAX * 0.5;
      if (m > lim) dv = scale(dv, lim / m);
      return [dv[0] / c.DV_MAX, dv[1] / c.DV_MAX, dv[2] / c.DV_MAX];
    }
    return [0, 0, 0];
  }

  function rollout(actFn, seed, cfg) {
    const env = new Env(cfg);
    let o = env.reset(seed), ret = 0;
    for (;;) {
      const s = env.step(actFn(o, env));
      ret += s.r; o = s.obs;
      if (s.done) break;
    }
    let viol = 0;
    for (const k of env.conj) if (k.viol) viol++;
    return { ret, viol, nConj: env.conj.length, dv: env.dvUsed, slot: env.slotErr / env.c.T_MAX };
  }

  function evaluate(actFn, seeds, cfg) {
    let ret = 0, viol = 0, nConj = 0, dv = 0, slot = 0;
    for (const s of seeds) {
      const r = rollout(actFn, s, cfg);
      ret += r.ret; viol += r.viol; nConj += r.nConj; dv += r.dv; slot += r.slot;
    }
    const n = seeds.length;
    return { ret: ret / n, violRate: viol / nConj, viol, nConj, dv: dv / n, slot: slot / n };
  }

  // ---------- Evolution Strategies (Salimans et al. 2017) ----------
  // Perturbations are regenerated from integer seeds, so workers only exchange scalars.
  function noiseVec(epsSeed) {
    const R = makeRng(epsSeed), e = new Float64Array(N_PARAMS);
    for (let i = 0; i < N_PARAMS; i++) e[i] = R.n();
    return e;
  }
  function perturbed(theta, epsSeed, sign, sigma) {
    const e = noiseVec(epsSeed), th = new Float64Array(N_PARAMS);
    for (let i = 0; i < N_PARAMS; i++) th[i] = theta[i] + sign * sigma * e[i];
    return th;
  }
  function fitness(theta, envSeeds, cfg) {
    let s = 0;
    for (const es of envSeeds) s += rollout((o) => mlpAct(theta, o), es, cfg).ret;
    return s / envSeeds.length;
  }
  // One job = one antithetic pair. Returns [f(+), f(-)].
  function evalPair(theta, epsSeed, sigma, envSeeds, cfg) {
    return [fitness(perturbed(theta, epsSeed, +1, sigma), envSeeds, cfg),
            fitness(perturbed(theta, epsSeed, -1, sigma), envSeeds, cfg)];
  }

  class ES {
    constructor(opts) {
      this.o = Object.assign({ pairs: 24, sigma: 0.04, lr: 0.03, episodes: 4, wd: 0.002, seed: 1 }, opts || {});
      this.theta = opts && opts.theta ? Float64Array.from(opts.theta) : initTheta(this.o.seed);
      this.m = new Float64Array(N_PARAMS); this.v = new Float64Array(N_PARAMS);
      this.gen = 0;
    }
    jobs() {
      const o = this.o, base = 1000003 * (this.gen + 1) + o.seed * 7919;
      const envSeeds = [];
      for (let k = 0; k < o.episodes; k++) envSeeds.push(base + 31 * k + 17);
      const epsSeeds = [];
      for (let k = 0; k < o.pairs; k++) epsSeeds.push(base * 3 + 101 * k + 5);
      return { envSeeds, epsSeeds };
    }
    // results: array of [f+, f-] aligned with epsSeeds
    update(epsSeeds, results) {
      const o = this.o, P = results.length;
      const all = [];
      results.forEach((r, i) => { all.push({ i, s: 1, f: r[0] }); all.push({ i, s: -1, f: r[1] }); });
      all.sort((a, b) => a.f - b.f);
      const util = new Float64Array(P * 2);
      // centred ranks in [-0.5, 0.5]
      all.forEach((a, rank) => { util[a.i * 2 + (a.s > 0 ? 0 : 1)] = rank / (2 * P - 1) - 0.5; });
      const grad = new Float64Array(N_PARAMS);
      for (let i = 0; i < P; i++) {
        const w = util[i * 2] - util[i * 2 + 1];
        const e = noiseVec(epsSeeds[i]);
        for (let j = 0; j < N_PARAMS; j++) grad[j] += w * e[j];
      }
      const b1 = 0.9, b2 = 0.999, t = ++this.gen;
      for (let j = 0; j < N_PARAMS; j++) {
        const g = grad[j] / (2 * P * o.sigma) - o.wd * this.theta[j];
        this.m[j] = b1 * this.m[j] + (1 - b1) * g;
        this.v[j] = b2 * this.v[j] + (1 - b2) * g * g;
        const mh = this.m[j] / (1 - Math.pow(b1, t)), vh = this.v[j] / (1 - Math.pow(b2, t));
        this.theta[j] += o.lr * mh / (Math.sqrt(vh) + 1e-8);
      }
      let mean = 0;
      for (const r of results) mean += r[0] + r[1];
      return mean / (2 * P);
    }
  }

  const API = {
    MU, RE, ALT, R0, N, CFG, OBS_DIM, ACT_DIM, HID, N_PARAMS,
    makeRng, stm, propagate, collisionProb, Env, mlpAct, noopPolicy, rulePolicy,
    initTheta, rollout, evaluate, evalPair, fitness, ES, vec: { dot, norm, add, sub, scale, cross, unit },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.KG = API;
})(typeof self !== 'undefined' ? self : this);
