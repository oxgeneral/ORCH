#!/usr/bin/env node
import {a}from'./chunk-ZGLWHEVK.js';import {c as c$1,b as b$1,a as a$2}from'./chunk-DZK72HOZ.js';import {f}from'./chunk-QZNVRNRM.js';import'./chunk-CHRW4CLD.js';import {k as k$1,j as j$1,q,i}from'./chunk-64WUDYEM.js';import {b}from'./chunk-PT5P6BCE.js';import {k,j,c,a as a$1}from'./chunk-E4C6C6IN.js';import'./chunk-R2FO7CRP.js';import'./chunk-LRYVT4D4.js';import T from'path';import _ from'fs/promises';import I from'readline';import {execFile}from'child_process';import {promisify}from'util';var E=`Agent architect \u2014 designs and creates AI agents for the orchestrator via \`orch agent add\`.

## CREATION PROCESS

1) ANALYZE \u2014 determine: agent function, required skills, adapter, team interactions.

2) WRITE THE ROLE \u2014 this is the most important part. A good role includes:
   - Identity and specialization (who you are)
   - Concrete workflow (numbered steps)
   - Which skills to invoke (\`/skill-name\`)
   - Rules and constraints
   Do NOT include CLI documentation or goal-mode instructions \u2014 these are already injected by the system prompt template.

3) CHOOSE CONFIGURATION:
   - adapter: \`claude\` (AI tasks), \`shell\` (bash scripts), \`codex\` (OpenAI Codex), \`pi\` (Pi coding agent RPC), \`cursor\` (Cursor IDE), \`opencode\` (OpenCode \u2014 multi-provider), \`grok\` (Grok CLI), \`antigravity\` (Google Antigravity CLI)
   - model: choose based on task complexity \u2014 use the \`capable\` tier for architecture/review, \`balanced\` for routine work, \`fast\` for simple/templated tasks. Model names vary by adapter.
   - approval_policy: \`auto\` (no confirmation) / \`suggest\` (proposes actions) / \`manual\` (human approval)
   - max_turns: 50 (default), up to 100 for complex tasks

4) CREATE:
   \`orch agent add "<name>" --adapter <adapter> --model <model> --skills "<skills>" --role "<role>" --approval-policy auto\`

## SKILL TYPES

There are two types of skills:

**Library skills** \u2014 ORCH loads Markdown content and injects it into the agent's system prompt. Works with ALL adapters (claude, opencode, codex, pi, cursor, grok, antigravity, shell). Use plain names without colons:

| Category | Skills |
|----------|--------|
| Code Review & QA | review, qa, qa-only, investigate |
| Planning | plan-ceo-review, plan-eng-review, plan-design-review, autoplan, office-hours |
| Design | design-consultation, design-review |
| Shipping | ship, land-and-deploy, canary, document-release |
| Infrastructure | browse, benchmark, setup-deploy, setup-browser-cookies |
| Safety | careful, freeze, unfreeze, guard |
| Cross-AI | codex |
| Meta | upgrade, retro |

**Claude Code MCP skills** \u2014 handled natively by Claude CLI. Use \`package:skill-name\` format (with colon):

Development: feature-dev:feature-dev, feature-dev:code-explorer, feature-dev:code-architect, feature-dev:code-reviewer
Testing: testing-suite:generate-tests, testing-suite:test-coverage, testing-suite:e2e-setup, testing-suite:test-quality-analyzer
Frontend: frontend-design:frontend-design, document-skills:frontend-design
Documents: document-skills:pdf, document-skills:xlsx, document-skills:docx, document-skills:pptx
Marketing: marketing-psychology, product-manager-toolkit
DevOps: devops-automation:cloud-architect

You can mix both types: \`--skills "review,feature-dev:code-explorer,investigate"\`

## ANTI-PATTERNS

- Never create agents without skills \u2014 they cannot be auto-matched to tasks.
- Never write generic roles like "helper" \u2014 be specific about actions and tools.
- Never use opus for simple tasks \u2014 it is expensive; use sonnet or haiku.
- Never assign more than 3-4 skills per agent \u2014 create specialized agents instead.
- Never use the -e/--edit flag in automated mode \u2014 it opens an interactive editor.
- Always specify --role when calling \`orch agent add\`.

After creation \u2014 \`orch context set agent-<name> "<capabilities>"\`.`;function P(a="claude"){let e=a$2(a,"balanced");return [{id:"agt_creator",name:"Agent Creator",adapter:a,role:E,config:{model:e||void 0,approval_policy:"suggest",max_turns:50,timeout_ms:36e5,stall_timeout_ms:3e5,skills:a==="claude"?["document-skills:skill-creator"]:[]},status:"idle",stats:{tasks_completed:0,tasks_failed:0,total_runs:0,total_runtime_ms:0}}]}var d=promisify(execFile);async function R(a$2={}){let e=process.cwd(),o=new b(e);if(await k(o.root)){k$1("Already initialized");return}let t=a$2.adapter??await O();await Promise.all([j(o.tasksDir),j(o.agentsDir),j(o.goalsDir),j(o.runsDir),j(o.templatesDir),j(o.logsDir)]);let r=await L(e),s=structuredClone(a);s.project.name=a$2.name??T.basename(e),s.defaults.agent.adapter=t,r||(s.defaults.agent.workspace_mode="shared");let p=["# Runtime state","state.json","*.lock","","# Logs and runs","runs/","logs/","","# Agent workspaces","workspaces/"].join(`
`)+`
`,b$1=[".orchestry","node_modules",".env",".env.*","dist","build",".next","__pycache__","*.pyc",".venv"].join(`
`)+`
`,g=P(t);await Promise.all([c(o.configPath,s),a$1(o.gitignorePath,p),a$1(o.workspaceExcludePath,b$1),a$1(o.defaultTemplatePath(),f),...g.map(l=>c(o.agentPath(l.id),l))]),await S(e),r&&await N(e),console.log(),j$1("initialized"),console.log(),console.log(`  Created ${q(".orchestry/")}`),console.log(`  ${q("\u251C\u2500\u2500")} config.yml`),console.log(`  ${q("\u251C\u2500\u2500")} tasks/`),console.log(`  ${q("\u251C\u2500\u2500")} agents/`);for(let l of g)console.log(`  ${q("\u2502   \u2514\u2500\u2500")} ${l.id}.yml ${q(`(${l.name})`)}`);console.log(`  ${q("\u251C\u2500\u2500")} templates/default.md`),console.log(`  ${q("\u2514\u2500\u2500")} .gitignore`),console.log();}async function O(){let e=(await Promise.all(c$1.filter(t=>t!=="shell").map(async t=>{let r=t==="cursor"?["cursor-agent"]:t==="antigravity"?["agy"]:[t];for(let s of r)try{let{stdout:p}=await d(s,["--version"],{timeout:5e3});return {name:t,ok:!0,version:p.trim().split(`
`)[0]}}catch{}return {name:t,ok:false}}))).filter(t=>t.ok);if(e.length===0)return console.log(`  ${q("No AI adapters detected \u2014 defaulting to claude")}`),"claude";if(e.length===1)return console.log(`  ${q(`Detected: ${e[0].name}`)} ${q(e[0].version?`(${e[0].version})`:"")}`),e[0].name;if(!process.stdout.isTTY||!process.stdin.isTTY)return e[0].name;console.log(),console.log("  Available adapters:");for(let t=0;t<e.length;t++){let r=e[t];console.log(`    ${t+1}) ${r.name} ${q(r.version??"")}`);}console.log();let o=I.createInterface({input:process.stdin,output:process.stdout});try{let t=await new Promise(s=>{o.question(`  Choose default adapter [1-${e.length}]: `,s);}),r=parseInt(t,10)-1;return r>=0&&r<e.length?e[r].name:e[0].name}finally{o.close();}}async function L(a){try{return await d("git",["rev-parse","--is-inside-work-tree"],{cwd:a}),!0}catch{try{return await d("git",["init"],{cwd:a}),!0}catch{return  false}}}async function N(a){try{await d("git",["rev-parse","HEAD"],{cwd:a});}catch{try{await d("git",["commit","--allow-empty","-m","Initial commit"],{cwd:a});}catch{}}}async function S(a){let e=T.join(a,".gitignore");try{let o=await _.readFile(e,"utf-8");if(o.split(`
`).some(r=>r.trim()===".orchestry"))return;let t=o.endsWith(`
`)?"":`
`;await _.appendFile(e,`${t}
# Orchestry state
.orchestry
`);}catch{await a$1(e,`# Orchestry state
.orchestry
`);}}function V(a){a.command("init").description("Initialize .orchestry/ in the current directory").option("--name <name>","Project name").option("--adapter <adapter>","Default agent adapter (claude, opencode, codex, cursor, pi, grok, antigravity, shell)").action(async e=>{if(e.adapter&&!b$1(e.adapter)){i(`Unknown adapter "${e.adapter}"`,`Supported: ${c$1.join(", ")}`),process.exitCode=2;return}await R(e),console.log(`  Next: ${q('orch task add "Create backend agent" --assignee agt_creator')}`),console.log();});}export{V as registerInitCommand,R as runInit};