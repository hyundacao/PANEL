import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const mapDirectory = path.join(root, 'docs', 'agent');
const errors = [];
const referencedFiles = new Set();
const declarations = new Map();
let anchorCount = 0;

const linksIn = text => [...text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)].map(match => match[1] ?? match[2]);
const relative = file => path.relative(root, file).split(path.sep).join('/');
const resolveLink = (document, link) => {
  if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('#')) return null;
  const [target, fragment] = link.split('#');
  const file = path.resolve(path.dirname(document), decodeURIComponent(target));
  const location = path.relative(root, file);
  if (location.startsWith('..' + path.sep) || path.isAbsolute(location)) {
    errors.push(`${relative(document)}: link outside repository: ${link}`);
    return null;
  }
  return { file, fragment };
};
const declaredNames = async file => {
  if (declarations.has(file)) return declarations.get(file);
  const names = new Set();
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node))
      && node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  declarations.set(file, names);
  return names;
};
const walk = async directory => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else files.push(file);
  }
  return files;
};

const documents = (await readdir(mapDirectory)).filter(name => name.endsWith('.md')).sort();
if (!documents.includes('INDEX.md')) errors.push('Missing docs/agent/INDEX.md');
const instructions = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
if (!instructions.includes('docs/agent/INDEX.md')) errors.push('AGENTS.md does not route to the agent index');

for (const name of documents) {
  const document = path.join(mapDirectory, name);
  const content = await readFile(document, 'utf8');
  const maxCharacters = name === 'INDEX.md' ? 6000 : 8500;
  if (content.length > maxCharacters || content.split('\n').length > 110) errors.push(`${relative(document)}: split this card; it exceeds the reading budget`);
  for (const link of linksIn(content)) {
    const resolved = resolveLink(document, link);
    if (!resolved) continue;
    try {
      if (!(await stat(resolved.file)).isFile()) throw new Error('not a file');
      referencedFiles.add(resolved.file);
      if (resolved.fragment && resolved.file.endsWith('.md')) {
        const target = await readFile(resolved.file, 'utf8');
        const headings = [...target.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-'));
        if (!headings.includes(resolved.fragment)) errors.push(`${relative(document)}: missing section: ${link}`);
      }
    } catch {
      errors.push(`${relative(document)}: missing file: ${link}`);
    }
  }
  // Anchor tables have exactly: topic | source link(s) | declared symbol(s).
  for (const row of content.split('\n').filter(line => line.startsWith('|'))) {
    const cells = row.split('|');
    if (cells.length !== 5) continue;
    const symbols = [...cells[3].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(match => match[1]);
    if (!symbols.length) continue;
    const files = linksIn(cells[2]).map(link => resolveLink(document, link)?.file).filter(file => file && referencedFiles.has(file));
    const available = new Set();
    for (const file of files) for (const symbol of await declaredNames(file)) available.add(symbol);
    for (const symbol of symbols) {
      anchorCount++;
      if (!available.has(symbol)) errors.push(`${relative(document)}: missing declaration: ${symbol}`);
    }
  }
}
const routes = (await walk(path.join(root, 'src', 'app'))).filter(file => /(?:^|[\\/])(?:page|route|layout)\.tsx?$/.test(file));
for (const route of routes) if (!referencedFiles.has(route)) errors.push(`Unmapped route: ${relative(route)}`);
if (errors.length) {
  process.stderr.write(errors.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Agent map OK: ${documents.length} short documents, ${referencedFiles.size} file references, ${anchorCount} declarations, ${routes.length} routes covered.\n`);
}
