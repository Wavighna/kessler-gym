// Offline ES training with Node worker_threads. Usage: node train.js [generations]
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const KG = require('./core.js');

if (!isMainThread) {
  parentPort.on('message', ({ theta, epsSeeds, sigma, envSeeds }) => {
    const th = Float64Array.from(theta);
    parentPort.postMessage(epsSeeds.map((s) => KG.evalPair(th, s, sigma, envSeeds)));
  });
  return;
}

const GENS = +process.argv[2] || 300;
const EVAL_SEEDS = Array.from({ length: 300 }, (_, i) => 900000 + i);
const nW = Math.max(1, os.cpus().length - 1);
const workers = Array.from({ length: nW }, () => new Worker(__filename));
const run = (w, msg) => new Promise((res) => { w.once('message', res); w.postMessage(msg); });

function report(name, r) {
  console.log(`${name.padEnd(10)} return ${r.ret.toFixed(2).padStart(8)}  violations ${(100 * r.violRate).toFixed(1).padStart(5)}%  dv ${r.dv.toFixed(3)} m/s  slot ${r.slot.toFixed(3)} km`);
}

(async () => {
  report('no-op', KG.evaluate(KG.noopPolicy, EVAL_SEEDS));
  report('rule', KG.evaluate((o, env) => KG.rulePolicy(env), EVAL_SEEDS));

  const es = new KG.ES({ pairs: 48, sigma: 0.04, lr: 0.02, episodes: 8, seed: 3 });
  const curve = [];
  let best = -Infinity, bestTheta = null;
  const t0 = Date.now();
  for (let g = 0; g < GENS; g++) {
    const { envSeeds, epsSeeds } = es.jobs();
    const chunks = workers.map((_, i) => epsSeeds.filter((_, k) => k % nW === i));
    const parts = await Promise.all(workers.map((w, i) => run(w, { theta: Array.from(es.theta), epsSeeds: chunks[i], sigma: es.o.sigma, envSeeds })));
    const results = new Array(epsSeeds.length);
    chunks.forEach((ch, i) => ch.forEach((s, j) => { results[epsSeeds.indexOf(s)] = parts[i][j]; }));
    const mean = es.update(epsSeeds, results);
    curve.push(mean);
    if ((g + 1) % 25 === 0) {
      const r = KG.evaluate((o) => KG.mlpAct(es.theta, o), EVAL_SEEDS.slice(0, 150));
      if (r.ret > best) { best = r.ret; bestTheta = Float64Array.from(es.theta); }
      console.log(`gen ${g + 1}  pop-mean ${mean.toFixed(2)}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      report('  ES', r);
    }
  }
  report('ES best', KG.evaluate((o) => KG.mlpAct(bestTheta, o), EVAL_SEEDS));
  fs.writeFileSync(path.join(__dirname, 'weights.json'), JSON.stringify({
    theta: Array.from(bestTheta, (x) => +x.toFixed(5)), curve: curve.map((x) => +x.toFixed(3)), gens: GENS,
  }));
  workers.forEach((w) => w.terminate());
})();
