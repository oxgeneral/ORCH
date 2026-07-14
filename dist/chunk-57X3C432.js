#!/usr/bin/env node
function a(r,n,e){let t=e?.reasoning??0;return {input:r,output:n,reasoning:t,total:r+n+t,cache_read:e?.cache_read??0,cache_write:e?.cache_write??0}}export{a};