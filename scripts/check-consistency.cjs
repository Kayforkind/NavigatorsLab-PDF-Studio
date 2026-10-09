/* Consistency gate for things that drift silently:
 *  1. README test counts (badge, `npm test` comment, "Test suite (N)") must equal the Vitest total.
 *  2. The Node version in .nvmrc must match the Dockerfile ARG, and every workflow must read .nvmrc.
 * Run: node scripts/check-consistency.cjs   (exit 0 = consistent, 1 = drift found)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const problems = [];

// 1. Vitest total (JSON reporter, written to a temp file so stdout stays clean)
const out = path.join(root, '.vitest-count.json');
const vitestBin = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const run = spawnSync(process.execPath, [vitestBin, 'run', '--reporter=json', `--outputFile=${out}`], {
  cwd: root,
  encoding: 'utf8',
});
if (!fs.existsSync(out)) {
  console.error('vitest produced no JSON report:\n' + (run.stderr || run.stdout));
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(out, 'utf8'));
fs.unlinkSync(out);
const total = report.numTotalTests;
if (report.numFailedTests > 0 || run.status !== 0) {
  problems.push(`vitest reported ${report.numFailedTests} failing test(s), exit ${run.status}`);
}

const readme = read('README.md');
const counts = {
  badge: readme.match(/tests-(\d+)_passing/),
  npmTestLine: readme.match(/npm test\s+# (\d+) app tests/),
  suiteHeading: readme.match(/\*\*Test suite \((\d+)\)/),
};
for (const [label, m] of Object.entries(counts)) {
  if (!m) problems.push(`README: ${label} not found`);
  else if (Number(m[1]) !== total) problems.push(`README ${label} says ${m[1]}, vitest total is ${total}`);
}

// 2. Node version: .nvmrc is the source of truth
const nvmrc = read('.nvmrc').trim();
const dockerArg = read('Dockerfile').match(/ARG NODE_VERSION=(\S+)/);
if (!dockerArg) problems.push('Dockerfile: ARG NODE_VERSION not found');
else if (dockerArg[1] !== nvmrc) problems.push(`Dockerfile NODE_VERSION=${dockerArg[1]} but .nvmrc is ${nvmrc}`);

for (const wf of fs.readdirSync(path.join(root, '.github', 'workflows'))) {
  if (!/\.ya?ml$/.test(wf)) continue;
  const text = read(path.join('.github', 'workflows', wf));
  if (/node-version:\s*\d/.test(text)) problems.push(`${wf} hardcodes node-version; use node-version-file: .nvmrc`);
  if (/setup-node/.test(text) && !/node-version-file:\s*\.nvmrc/.test(text)) problems.push(`${wf} uses setup-node without .nvmrc`);
}

if (problems.length) {
  console.error('consistency check FAILED:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log(`consistency OK: ${total} tests, Node ${nvmrc}`);
