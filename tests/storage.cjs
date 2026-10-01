const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const http=require('http'),fs=require('fs'),assert=require('assert');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fs.readFileSync('index.html'))}).listen(0,'127.0.0.1');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer']});
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1')?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>_storageReady);
 await page.evaluate(async()=>{
   customSymbols={big:{name:'Prüfsymbol',abbr:'T',cat:'steckdosen',imgData:'data:image/png;base64,'+'A'.repeat(12*1024*1024),imgType:'img'}};
   await saveCustomSymbols();
   state.symbols=[{id:'test',type:'big',x:5,y:6}];
   document.getElementById('projName').value='Speichertest 12 MB';
   await saveProjectToLibrary(true); await localStateSaveFull();
 });
 await page.reload();await page.waitForFunction(()=>_storageReady);
 assert(await page.evaluate(()=>customSymbols.big.imgData.length>12000000));
 assert.equal(await page.evaluate(()=>readProjectLibrary()[0].name),'Speichertest 12 MB');
 assert.equal(await page.evaluate(()=>state.symbols[0].id),'test');
 assert(await page.evaluate(()=>localStorage.getItem(LS_CUSTOM)===null && localStorage.getItem(LS_PROJECT_LIBRARY)===null));
 console.log('PASS: 12 MB symbols + project survive reload without localStorage');
 const result=await page.evaluate(async()=>{
   const db=new Map();let writes=0,failAt=Infinity,maxBytes=0;
   function ref(id){return {id,async set(d){writes++;if(writes===failAt)throw Error('simulated disconnect');maxBytes=Math.max(maxBytes,new TextEncoder().encode(JSON.stringify(d)).length);db.set(id,structuredClone(d));},async get(){const d=db.get(id);return {exists:!!d,data:()=>d}},async delete(){db.delete(id)}}}
   currentUser={uid:'test-user'};
   fbDb={collection:()=>({doc:ref}),runTransaction:async fn=>{const queued=[];await fn({get:r=>r.get(),set:(r,d)=>queued.push([r,d])});for(const [r,d] of queued)await r.set(d)}};
   window.firebase={firestore:{FieldValue:{serverTimestamp:()=>123}}};
   const data={name:'Groß 🧰',floorplans:[{floorplanData:'X'.repeat(12*1024*1024),symbols:[]}],customSymbols:{s:{imgData:'Y'.repeat(500000)}}};
   const r=ref('project');const revision=await writeCloudProject(r,data,null);
   const manifest=db.get('project');const loaded=await readCloudProject('project',manifest);
   if(JSON.stringify(loaded)!==JSON.stringify(data))throw Error('roundtrip mismatch');
   failAt=writes+2;let failed=false;
   try{await writeCloudProject(r,{...data,name:'Unvollständig'},revision)}catch{failed=true}
   if(!failed || db.get('project').revision!==revision)throw Error('failed write replaced manifest');
   failAt=Infinity;db.get('project').revision='another-device';let conflict=false;
   try{await writeCloudProject(r,{...data,name:'Konflikt'},revision)}catch(e){conflict=e.message.includes('anderen Gerät')}
   if(!conflict || db.get('project').revision!=='another-device')throw Error('conflict not protected');
   const unicode='🧰'.repeat(120001);if(splitCloudPayload(unicode).join('')!==unicode)throw Error('unicode split');
   if(await readCloudProject('legacy',{name:'Alt'}) .then(d=>d.name)!=='Alt')throw Error('legacy');
   return {maxBytes,chunks:manifest.chunkCount,failed,conflict};
 });
 assert(result.maxBytes<1048576);console.log('PASS: cloud >12 MB roundtrip, interrupted write, conflict, legacy, Unicode',result);
 await page.evaluate(async()=>{fbDb=null;currentProjectId=null;const previous=await idbGetBackup();previous.savedAt=Date.now()-7*86400000;await idbPutBackup(previous);});
 await page.reload();await page.waitForFunction(()=>_storageReady);assert.equal(await page.evaluate(()=>state.symbols[0].id),'test');console.log('PASS: backup older than 24h restored');
 await page.evaluate(async()=>{const original=idbPutBackup;idbPutBackup=async()=>{throw new DOMException('Disk full','QuotaExceededError')};await localStateSaveFull();idbPutBackup=original});
 assert(await page.locator('#storageError').isVisible());assert(await page.evaluate(()=>_hasUnsavedChanges()));console.log('PASS: storage failure shown; unsaved warning retained');
 console.log('Browser errors:',errors);assert.equal(errors.length,0);
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
