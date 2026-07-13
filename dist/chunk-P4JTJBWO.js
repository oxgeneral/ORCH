#!/usr/bin/env node
function a(n,t,e){let r=e?.reasoning??0;return {input:n,output:t,reasoning:r,total:n+t+r,cache_read:e?.cache_read??0,cache_write:e?.cache_write??0}}export{a};