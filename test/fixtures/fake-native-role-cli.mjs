#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const command = path.basename(process.argv[1]);
const argv = process.argv.slice(2);
const input = fs.readFileSync(0, 'utf8');
const home = process.env.HOME;
if (!home) process.exit(90);
fs.appendFileSync(path.join(home, 'native-role-calls.jsonl'), `${JSON.stringify({
  command,
  argv,
  cwd: process.cwd(),
  stdin: input,
  role: process.env.ORCH_WORKFLOW_ROLE,
  proxy: process.env.HTTPS_PROXY,
})}\n`);

let request;
try {
  request = JSON.parse(input);
} catch {
  console.error('Prompt was not valid JSON');
  process.exit(91);
}

const objective = String(request.objective ?? '');
const role = process.env.ORCH_WORKFLOW_ROLE;
if (role === 'supervisor') {
  if (objective.includes('SUPERVISOR_RETRY')) {
    const calls = fs.readFileSync(path.join(home, 'native-role-calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    if (calls.filter((call) => call.role === 'supervisor').length === 1) {
      console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{}' } }));
      process.exit(0);
    }
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ plan: 'Implement the requested deterministic fixture change.' }) } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
  process.exit(0);
}
if (role === 'adviser') {
  console.log(JSON.stringify({ type: 'result', result: JSON.stringify({ advice: 'Keep the fixture change minimal.' }) }));
  process.exit(0);
}
if (role === 'implementer') {
  fs.writeFileSync('result.txt', `${objective}\n`);
  if (objective.includes('FAIL_CHECK')) fs.writeFileSync('fail-check', 'fail\n');
  execFileSync('git', ['add', 'result.txt', ...(objective.includes('FAIL_CHECK') ? ['fail-check'] : [])]);
  if (objective.includes('NON_DESCENDANT')) {
    const tree = execFileSync('git', ['write-tree'], { encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['commit-tree', tree, '-m', 'unrelated implementation'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['reset', '--hard', commit]);
  } else {
    execFileSync('git', ['commit', '-m', 'implement fixture objective']);
  }
  console.log(JSON.stringify({ type: 'result', result: JSON.stringify({ status: 'completed' }) }));
  process.exit(0);
}
if (role === 'reviewer') {
  if (objective.includes('REVIEW_FAIL')) {
    console.error('deterministic reviewer failure');
    process.exit(17);
  }
  if (objective.includes('TARGET_ADVANCE')) {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const root = path.dirname(path.resolve(process.cwd(), common));
    execFileSync('git', ['commit', '--allow-empty', '-m', 'concurrent target advance'], { cwd: root });
  }
  if (objective.includes('REVIEW_REJECT')) {
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ decision: 'reject', reason: 'Deterministic rejection.' }) } }));
    process.exit(0);
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ decision: 'accept', reason: 'Deterministic review passed.' }) } }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
  process.exit(0);
}
process.exit(93);
