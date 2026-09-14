/**
 * Check that every skill and agent definition has frontmatter Claude Code can
 * read: valid YAML, a `name`, a `description`, and (for skills) a string
 * `argument-hint` when one is present.
 *
 *   node scripts/check-skills.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { rootDir } from './lib.mjs';

const require = createRequire(join(rootDir, 'packages', 'core', 'package.json'));
const YAML = require('yaml');

function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('no frontmatter block');
  const data = YAML.parse(match[1]);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('frontmatter is not a mapping');
  return data;
}

function check(file, kind) {
  const data = frontmatter(readFileSync(file, 'utf8'));
  const problems = [];
  if (typeof data.name !== 'string' || data.name.trim() === '') problems.push('missing name');
  if (typeof data.description !== 'string' || data.description.trim() === '') problems.push('missing description');
  if (kind === 'skill') {
    const expected = relative(join(rootDir, '.claude', 'skills'), file).split(/[\\/]/)[0];
    if (data.name !== expected) problems.push(`name "${data.name}" does not match directory "${expected}"`);
    if ('argument-hint' in data && typeof data['argument-hint'] !== 'string') problems.push('argument-hint is not a string (quote it)');
  }
  if (kind === 'agent' && ('tools' in data || 'model' in data)) problems.push('agents must not hard-code tools or model');
  return problems;
}

const targets = [];
const skillsDir = join(rootDir, '.claude', 'skills');
for (const entry of readdirSync(skillsDir)) {
  const file = join(skillsDir, entry, 'SKILL.md');
  if (statSync(join(skillsDir, entry)).isDirectory()) targets.push({ file, kind: 'skill' });
}
const agentsDir = join(rootDir, '.claude', 'agents');
for (const entry of readdirSync(agentsDir)) {
  if (entry.endsWith('.md')) targets.push({ file: join(agentsDir, entry), kind: 'agent' });
}

let failures = 0;
for (const { file, kind } of targets) {
  const label = relative(rootDir, file);
  try {
    const problems = check(file, kind);
    if (problems.length > 0) {
      failures += 1;
      process.stdout.write(`FAIL ${label}: ${problems.join('; ')}\n`);
    } else {
      process.stdout.write(`ok   ${label}\n`);
    }
  } catch (error) {
    failures += 1;
    process.stdout.write(`FAIL ${label}: ${error.message}\n`);
  }
}
process.stdout.write(`${targets.length} definitions, ${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
