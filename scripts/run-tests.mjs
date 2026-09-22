import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const planningOnly = args.includes('--planning');
const testArgs = args.filter((arg) => arg !== '--planning');
const directory = path.join(root, 'src', ...(planningOnly ? ['lib', 'planowanie-zapotrzebowania'] : []));

const discover = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discover(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(fullPath);
  }
  return files;
};

const files = (await discover(directory)).sort();
if (!files.length) throw new Error('No test files found');
const child = spawn(process.execPath, ['--experimental-strip-types', '--test', ...testArgs, ...files], {
  cwd: root, stdio: 'inherit'
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
