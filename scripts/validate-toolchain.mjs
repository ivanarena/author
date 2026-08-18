#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')
);

const packageManagerMatch = /^aube@(\d+\.\d+\.\d+)$/.exec(
  packageJson.packageManager ?? ''
);
if (!packageManagerMatch) {
  throw new Error(
    'package.json must pin packageManager to an exact aube version.'
  );
}

const requiredAube = packageManagerMatch[1];
const actualAube = execFileSync('aube', ['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
})
  .trim()
  .split(/\s+/, 1)[0];

if (actualAube !== requiredAube) {
  throw new Error(
    `Aube ${requiredAube} is required, but ${actualAube || 'an unknown version'} is active. ` +
      `Run: mise use -g aube@${requiredAube}`
  );
}

const nodeEngineMatch = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(
  packageJson.engines?.node ?? ''
);
if (!nodeEngineMatch) {
  throw new Error(
    'package.json must express the Node engine as an exact minimum.'
  );
}

const requiredNode = nodeEngineMatch.slice(1).map(Number);
const actualNode = process.versions.node.split('.').map(Number);
const nodeIsCurrent = requiredNode.every((requiredPart, index) => {
  const equalBefore = requiredNode
    .slice(0, index)
    .every((part, priorIndex) => actualNode[priorIndex] === part);
  return !equalBefore || actualNode[index] >= requiredPart;
});

if (!nodeIsCurrent) {
  throw new Error(
    `Node ${requiredNode.join('.')} or newer is required, but ${process.versions.node} is active.`
  );
}

console.log(`Toolchain ok: Node ${process.versions.node}, Aube ${actualAube}`);
