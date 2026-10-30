import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');
const TOOLS = new Set(['search', 'save_note', 'reindex', 'status', 'configure', 'forget']);
const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

function parse(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, `${file}: missing frontmatter fences`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const k = line.match(/^(name|description):\s*(.*)$/);
    if (k) fm[k[1]] = k[2].trim();
  }
  return { fm, body: m[2] };
}

test('five skills exist', () => {
  assert.deepEqual([...folders].sort(), ['forget', 'index', 'recall', 'remember', 'status']);
});

for (const f of folders) {
  test(`skill ${f}`, () => {
    const { fm, body } = parse(path.join(dir, f, 'SKILL.md'));
    assert.equal(fm.name, f);
    assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fm.description && fm.description.length <= 1024);
    assert.ok(body.trim().split('\n').length <= 40, 'body over 40 lines');
    const names = [...body.matchAll(/`([a-z_]+)\(/g), ...body.matchAll(/`([a-z_]+)` \(remember MCP/g), ...body.matchAll(/^(?:Call|Save[^`]*with|Build[^`]*with) `([a-z_]+)`/gm)].map((x) => x[1]);
    for (const n of names) {
      assert.ok(TOOLS.has(n), `unknown tool name ${n}`);
    }
  });
}
