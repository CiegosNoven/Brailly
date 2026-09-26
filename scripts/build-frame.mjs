import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['shared/frame-bridge.ts'],bundle:true,write:false,format:'iife',target:'es2022',minify:true});
await writeFile('src/generated-frame.ts','// Generated from shared/frame-bridge.ts. No third-party page scripts execute.\nexport const FRAME_BRIDGE = '+JSON.stringify(result.outputFiles[0].text)+';\n');
