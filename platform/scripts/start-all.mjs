#!/usr/bin/env node
// Start the web server and the scheduler worker together, then open the browser.
// Ctrl+C stops both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
function run(name, script) {
  const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (s) => s.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  child.stdout.on('data', (d) => process.stdout.write(prefix(d)));
  child.stderr.on('data', (d) => process.stderr.write(prefix(d)));
  child.on('exit', (code) => { console.log(`[${name}] exited with code ${code}`); if (!stopping) stopAll(code ?? 1); });
  children.push(child);
}
let stopping = false;
function stopAll(code = 0) {
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

run('web', 'src/server.mjs');
if (config.schedulerMode === 'worker') run('worker', 'src/worker.mjs');

if (!process.argv.includes('--no-open')) {
  const url = `http://localhost:${config.port}`;
  setTimeout(async () => {
    try {
      const res = await fetch(`${url}/api/health`);
      if (!res.ok) return;
    } catch { return; }
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* no browser available */ }
  }, 2500);
}
