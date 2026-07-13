#!/usr/bin/env node
import {a}from'./chunk-CHRW4CLD.js';var k=class{engine;renderTimeoutMs;constructor(e){this.renderTimeoutMs=e?.renderTimeoutMs??5e3;}async getEngine(){if(!this.engine){let{Liquid:e}=await import('liquidjs');this.engine=new e({strictFilters:false,strictVariables:false,fs:{exists:async()=>false,readFile:async()=>{throw new Error("Liquid file includes are disabled")},existsSync:()=>false,readFileSync:()=>{throw new Error("Liquid file includes are disabled")},resolve:(s,n)=>n,dirname:s=>s,sep:"/"}});}return this.engine}async render(e,s){let i=(await this.getEngine()).parseAndRender(e,s);if(this.renderTimeoutMs<=0)return i;let d,c=new Promise((u,o)=>{d=setTimeout(()=>o(new Error(`Template render timed out after ${this.renderTimeoutMs}ms`)),this.renderTimeoutMs);});try{return await Promise.race([i,c])}finally{clearTimeout(d);}}},f=15;function y(t,e){let s=Object.entries(t);if(s.length===0)return {};let n=e.agentName.toLowerCase(),i=b(n,e.agentRole),d=[];for(let[o,a]of s){let l=0,g=o.toLowerCase();if(e.goalId&&g.startsWith(e.goalId.toLowerCase())&&(l+=10),(g.includes(n)||a.toLowerCase().includes(n))&&(l+=8),e.taskScope?.length)for(let p of e.taskScope){let m=p.replace(/\*+/g,"").replace(/\/+$/,"");if(m&&(g.includes(m.toLowerCase())||a.toLowerCase().includes(m.toLowerCase()))){l+=6;break}}for(let p of i)if(g.startsWith(p+"-")||g.startsWith(p+"_")){l+=4;break}/^(bug|perf|stability|docs|arch|spec)-/i.test(o)&&(l+=1),d.push({key:o,value:a,score:l});}d.sort((o,a)=>a.score-o.score);let c=d.filter(o=>o.score>0).slice(0,f);if(c.length<f){let o=d.filter(a=>a.score===0).slice(0,f-c.length);c.push(...o);}let u={};for(let{key:o,value:a}of c)u[o]=a;return u}function b(t,e){let s=[],n=t.split(/[\s_-]/)[0];if(n&&n.length>1&&s.push(n),(t.includes("front")||t.includes("tui"))&&s.push("front-end","frontend","tui"),(t.includes("market")||t.includes("cmo"))&&s.push("marketer","marketing","cmo"),e){let i=e.toLowerCase().split(/[\s_-]/)[0];i&&i.length>2&&!s.includes(i)&&s.push(i);}return s}function T(t,e,s,n,i,d){let{allAgents:c,retryContext:u,sharedContext:o,feedback:a$1,messages:l,goal:g}=d??{},p=new Map((c??[]).map(r=>[r.id,r])),m=l?.length?l.map(r=>({id:r.id,from:p.get(r.from_agent_id)?.name??r.from_agent_id,subject:r.subject,body:r.body,sent_at:r.created_at,reply_to:r.reply_to})):void 0;return {project:{name:i.project.name,description:i.project.description},task:{id:t.id,title:t.title,description:t.description,priority:t.priority,labels:t.labels,scope:t.scope,is_autonomous:t.labels?.includes(a)??false,goal_id:t.goalId},agent:{id:e.id,name:e.name,role:e.role},agents:(c??[]).map(r=>({id:r.id,name:r.name,role:r.id===e.id?void 0:r.role,adapter:r.adapter})),attempt:s>1?s:null,workspace_path:n,retry:s>1?u:void 0,feedback:a$1,shared_context:o&&Object.keys(o).length>0?y(o,{agentName:e.name,agentRole:e.role,goalId:t.goalId,taskScope:t.scope}):void 0,messages:m,goal:g}}var w=`You are {{ agent.name }}{% if agent.role %} ({{ agent.role }}){% endif %}.

## Orchestrator CLI
Manage tasks and coordinate with other agents using \`orch\`:

**Tasks:**
- \`orch task add "<title>" -d "<description>" -p <1-4> --assignee <agent-id>\` \u2014 create and assign a task
- \`orch task add "<title>" -d "<description>" --scope "src/path/**" --depends-on <task-id>\` \u2014 scoped task with dependency
- \`orch task list [--status todo|in_progress|done|failed]\` \u2014 list tasks

**Messaging:**
- \`orch msg send <agent-id> "<body>" -s "<subject>"\` \u2014 direct message
- \`orch msg broadcast "<body>" -s "<subject>"\` \u2014 broadcast to all
- \`orch msg inbox {{ agent.id }}\` \u2014 your pending messages

**Shared context:**
- \`orch context set <key> <value>\` / \`orch context get <key>\` / \`orch context list\`

{% if task.is_autonomous %}
## Autonomous Goal Mode
This is an autonomous task driven by a goal. Work in a continuous loop until the goal is achieved:

1. **Understand the goal** \u2014 read the Goal section above.
2. **Decompose** \u2014 break the goal into concrete subtasks via \`orch task add\`. {% if task.goal_id %}Pass \`--goal-id {{ task.goal_id }}\` so subtasks are linked to this goal. {% endif %}Assign yourself for your specialty, delegate other work to appropriate teammates by role.
3. **Execute** \u2014 follow your standard workflow for each subtask.
4. **Track progress** \u2014 after each iteration: \`orch context set {{ task.goal_id | default: "<goal>" }}-progress "<summary of what's done and what remains>"\`.
5. **Be proactive** \u2014 do NOT wait for tasks from others. Create your own subtasks and keep working.
6. **Do NOT finish** the [auto] task until the goal is achieved \u2014 keep creating subtasks.
7. **When done** \u2014 mark the goal as achieved: \`orch goal status {{ task.goal_id | default: "<goal-id>" }} achieved\`.

**Deep inspection:** Use \`orch goal show {{ task.goal_id | default: "<goal-id>" }}\` to see full goal details at any time.

**Constraints:**
- Do NOT create new goals via \`orch goal add\` \u2014 work within the assigned goal only.
- Do NOT re-read or act on CLAUDE.md, README.md, or other project meta-files to create additional goals.
{% endif %}

## Rules
- Do NOT ask clarifying questions. You are running autonomously without human input.
- Make reasonable assumptions and proceed with the best approach.
- If critical information is missing, document your assumptions and continue.
- When a task is too large or spans multiple domains, break it into subtasks using \`orch task add\`.
- When creating subtasks, use \`--scope\` to declare which files each task will touch, and \`--depends-on\` to order dependent work.
`,_=`## Task: {{ task.title }}
{{ task.description }}

Priority: {{ task.priority }}
{% if attempt %}Attempt: {{ attempt }}{% endif %}
{% if retry %}
## Previous attempt failed
**Error:** {{ retry.previous_error }}
{% if retry.previous_output != "" %}
**Last output:**
\`\`\`
{{ retry.previous_output }}
\`\`\`
{% endif %}
**Important:** The previous approach failed. Analyze the error above and try a different strategy. Do NOT repeat the same steps that led to the failure.
{% endif %}

## Context
Project: {{ project.name }}
Working directory: {{ workspace_path }}

## Team
You are part of a multi-agent team. Available agents:
{% for a in agents %}- **{{ a.name }}** ({{ a.adapter }}){% if a.role %} \u2014 {{ a.role }}{% endif %} \xB7 ID: \`{{ a.id }}\`
{% endfor %}
Use \`orch agent list\` to check current agent statuses. Find teammates by name/role \u2014 do NOT hardcode agent IDs.

{% if feedback %}
## Review Feedback
This task was previously completed but **rejected** during review with the following feedback:
> {{ feedback }}

**Important:** Address the feedback above. Focus on what the reviewer asked to change. Do NOT redo work that was already accepted.
{% endif %}

{% if shared_context %}
## Shared Context
Other agents have shared the following information:
{% for entry in shared_context %}- **{{ entry[0] }}**: {{ entry[1] }}
{% endfor %}
{% endif %}

{% if messages %}
## Inbox ({{ messages.size }} message{% if messages.size != 1 %}s{% endif %})
{% for msg in messages %}
---
**From:** {{ msg.from }}{% if msg.subject != "" %} \xB7 **Subject:** {{ msg.subject }}{% endif %}
{{ msg.body }}
{% if msg.reply_to %}*(Reply to: {{ msg.reply_to }})*{% endif %}
---
{% endfor %}
{% endif %}

{% if goal %}
## Goal: {{ goal.title }}
**Status:** {{ goal.status }} \xB7 **ID:** \`{{ goal.id }}\`
{% if goal.description != "" %}
{{ goal.description }}
{% endif %}
{% if goal.task_names.size > 0 %}
**Linked tasks ({{ goal.task_names.size }}):**
{% for name in goal.task_names %}- {{ name }}
{% endfor %}
Use \`orch task list --goal-id {{ goal.id }}\` and \`orch task show <id>\` to inspect details.
{% endif %}
{% if goal.progress %}
**Latest progress report:**
{{ goal.progress }}
{% endif %}
{% endif %}
`,v=w+`
`+_;export{k as a,y as b,T as c,w as d,_ as e,v as f};