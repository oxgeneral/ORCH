#!/usr/bin/env node
import {a}from'./chunk-BPWQ434U.js';import {execFile,execFileSync}from'child_process';import {promisify}from'util';import {mkdtemp,readFile,unlink,rm}from'fs/promises';import {tmpdir}from'os';import {join}from'path';var i=promisify(execFile),r=3e3;function E(){let t=process.platform;if(t==="darwin")return  true;if(t==="linux")try{return execFileSync("which",["xclip"],{timeout:r,stdio:"ignore"}),!0}catch{return  false}return t==="win32"}async function w(){let t=process.platform;if(t==="darwin")return x();if(t==="linux")return b();if(t==="win32")return P();throw new a(`Unsupported platform for clipboard: ${t}`,1,"Supported: macOS, Linux, Windows")}async function G(){if(await w()!=="image")return null;let e=process.platform;return e==="darwin"?h():e==="linux"?C():e==="win32"?I():null}async function x(){try{let{stdout:t}=await i("osascript",["-e","clipboard info"],{timeout:r});return t.includes("\xABclass PNGf\xBB")||t.includes("\xABclass TIFF\xBB")?"image":t.includes("\xABclass ut16\xBB")||t.includes("\xABclass utf8\xBB")||t.trim().length>0?"text":"empty"}catch{return "empty"}}async function h(){let t=await mkdtemp(join(tmpdir(),"orch-clip-")),e=join(t,"clipboard.png");try{let o=`
      set theFile to POSIX file "${e}"
      try
        set imgData to the clipboard as \xABclass PNGf\xBB
        set fRef to open for access theFile with write permission
        write imgData to fRef
        close access fRef
        return "ok"
      on error
        try
          close access theFile
        end try
        return "error"
      end try
    `,{stdout:a}=await i("osascript",["-e",o],{timeout:r});return a.trim()!=="ok"?null:{data:await readFile(e),ext:"png"}}catch{return null}finally{try{await unlink(e);}catch{}try{await rm(t,{recursive:!0});}catch{}}}async function b(){try{let{stdout:t}=await i("xclip",["-selection","clipboard","-t","TARGETS","-o"],{timeout:r}),e=t.toLowerCase();return e.includes("image/png")||e.includes("image/tiff")||e.includes("image/jpeg")?"image":e.includes("text/plain")||e.includes("utf8_string")||e.includes("string")||e.trim().length>0?"text":"empty"}catch{return "empty"}}async function C(){try{let{stdout:t}=await i("xclip",["-selection","clipboard","-t","image/png","-o"],{timeout:r,encoding:"buffer",maxBuffer:52428800}),e=Buffer.isBuffer(t)?t:Buffer.from(t,"binary");return e.length===0?null:{data:e,ext:"png"}}catch{return null}}async function P(){try{let{stdout:t}=await i("powershell",["-NoProfile","-Command",'if (Get-Clipboard -Format Image) { "image" } else { "none" }'],{timeout:r});if(t.trim()==="image")return "image";let{stdout:e}=await i("powershell",["-NoProfile","-Command",'if (Get-Clipboard) { "text" } else { "empty" }'],{timeout:r});return e.trim()==="text"?"text":"empty"}catch{return "empty"}}async function I(){let t=await mkdtemp(join(tmpdir(),"orch-clip-")),e=join(t,"clipboard.png");try{let o=`
      Add-Type -AssemblyName System.Windows.Forms
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img) {
        $img.Save('${e.replace(/\\/g,"\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output 'ok'
      } else {
        Write-Output 'error'
      }
    `,{stdout:a}=await i("powershell",["-NoProfile","-Command",o],{timeout:r});return a.trim()!=="ok"?null:{data:await readFile(e),ext:"png"}}catch{return null}finally{try{await unlink(e);}catch{}try{await rm(t,{recursive:!0});}catch{}}}export{w as detectClipboardType,G as getClipboardImage,E as isClipboardToolAvailable};