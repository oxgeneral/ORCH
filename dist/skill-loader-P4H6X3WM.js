#!/usr/bin/env node
import {l,k}from'./chunk-7V36EAEJ.js';import'./chunk-EULHBRCW.js';import {readFile}from'fs/promises';import {fileURLToPath}from'url';import {join,dirname}from'path';var f=/^[a-z0-9-]+$/;async function p(){let l=dirname(fileURLToPath(import.meta.url)),i=l;for(let r=0;r<5;r++){let t=join(i,"skills","library");if(await k(t))return t;i=dirname(i);}return join(l,"..","..","..","skills","library")}var m=class{cache=new Map;libraryDirPromise;availableCache=null;constructor(i){this.libraryDirPromise=i?Promise.resolve(i):p();}async loadSkills(i){let r=i.filter(s=>!s.includes(":"));if(r.length===0)return "";let t=await Promise.all(r.map(s=>this.loadOne(s))),e=r.map((s,n)=>t[n]?`### ${s}

${t[n]}`:null).filter(s=>s!==null);return e.length===0?"":`## Skills

${e.join(`

`)}`}async listAvailable(){if(this.availableCache)return this.availableCache;let i=await this.libraryDirPromise,r=await l(i,".md");return this.availableCache=r.map(t=>t.replace(/\.md$/,"")).sort(),this.availableCache}async loadOne(i){let r=this.cache.get(i);if(r!==void 0)return r||null;if(!f.test(i))return null;let t=await this.libraryDirPromise,e=join(t,`${i}.md`);try{let s=await readFile(e,"utf8");return this.cache.set(i,s),s}catch{return process.stderr.write(`[orch] skill library: "${i}" not found in ${t}
`),this.cache.set(i,""),null}}};export{m as SkillLoader};