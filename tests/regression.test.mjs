import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClaudeServer } from '../server/claude-proxy.mjs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const token = 'test-token-'.repeat(4);
const config = { apiKey: 'test-api-key', accessToken: token, model: 'test-model' };
async function withServer(fetchImpl, run) {
  const server = createClaudeServer({ ...config, fetchImpl });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await run('http://127.0.0.1:' + server.address().port + '/api/claude'); }
  finally { await new Promise(r => server.close(r)); }
}
const headers = { Origin: 'https://ehometech.github.io', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
test('all inline JavaScript parses', () => {
  let count = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || /application\/json/.test(match[1])) continue;
    new vm.Script(match[2]); count++;
  }
  assert.ok(count > 0);
});
test('blank floorplans allow drawing and restore zoom', () => {
  const source = html.slice(html.indexOf('function applyFloorplanSheet('), html.indexOf('function addFloorplanFromDataUrl('));
  const nodes = { uploadZone: { style: { display: 'flex' } }, zlbl: { textContent: '' } };
  const context = { state: {}, simpleClone: v => JSON.parse(JSON.stringify(v || null)), document: { getElementById: id => nodes[id] }, render(){}, renderProps(){}, updateFloorplanTabs(){}, nid: 0 };
  vm.createContext(context); vm.runInContext(source, context);
  context.applyFloorplanSheet({ id: 'blank', symbols: [], zoom: 1.5 });
  assert.equal(nodes.uploadZone.style.display, 'none');
  assert.equal(nodes.zlbl.textContent, '150%');
  assert.equal(context.state.activeFloorplanId, 'blank');
});
test('unconfigured Claude retains question and never sends a request', async () => {
  const source = html.slice(html.indexOf('let claudePending = false;'), html.indexOf('// OpenRouter (kostenlose Cloud-Modelle)'));
  const nodes = { claudeEndpoint: { value: '' }, claudeAccessToken: { value: '' }, aiInput: { value: '' } };
  let calls = 0;
  const context = { URL, document: { getElementById: id => nodes[id] }, aiAddMsg(){}, fetch(){ calls++; } };
  vm.createContext(context); vm.runInContext(source, context);
  await context.sendClaude('Testfrage');
  assert.equal(calls, 0); assert.equal(nodes.aiInput.value, 'Testfrage');
  nodes.claudeEndpoint.value = 'https://api.anthropic.com/v1/messages';
  await context.sendClaude('Andere Frage');
  assert.equal(calls, 0); assert.equal(nodes.aiInput.value, 'Andere Frage');
});
test('proxy rejects invalid origin and authorization before calling Claude', async () => {
  let calls = 0;
  await withServer(() => { calls++; }, async url => {
    let r = await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.example' }, body: '{"message":"Test"}' });
    assert.equal(r.status, 403);
    r = await fetch(url, { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body: '{"message":"Test"}' });
    assert.equal(r.status, 401);
  });
  assert.equal(calls, 0);
});
test('proxy handles CORS preflight and rejects oversized/invalid input', async () => {
  let calls = 0;
  await withServer(() => { calls++; }, async url => {
    let r = await fetch(url, { method: 'OPTIONS', headers: { Origin: headers.Origin } });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), headers.Origin);
    for (const body of ['not json', '{}', JSON.stringify({ message: 'x'.repeat(8001) })]) {
      r = await fetch(url, { method: 'POST', headers, body }); assert.equal(r.status, 400);
    }
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ message: 'x'.repeat(20000) }) }); assert.equal(r.status, 413);
  });
  assert.equal(calls, 0);
});
test('proxy sends server credentials upstream and returns only text', async () => {
  await withServer(async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'test-api-key');
    const body = JSON.parse(options.body); assert.equal(body.model, 'test-model'); assert.equal(body.messages[0].content, 'Test');
    return Response.json({ content: [{ type: 'text', text: 'Antwort' }], secret: 'never return' });
  }, async url => {
    const r = await fetch(url, { method: 'POST', headers, body: '{"message":"Test"}' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { content: [{ type: 'text', text: 'Antwort' }] });
  });
});
test('proxy masks upstream errors', async () => {
  await withServer(async () => Response.json({ error: { message: 'private upstream details' } }, { status: 401 }), async url => {
    const r = await fetch(url, { method: 'POST', headers, body: '{"message":"Test"}' });
    assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('private upstream details'));
  });
});

test('loading an older project preserves uploaded symbols and persists restored overrides', () => {
  const source = html.slice(html.indexOf('function restoreProjectSymbolConfig('), html.indexOf('function mergeCustomSymbols('));
  let saved = 0;
  const context = {
    customSymbols: { own: { name: 'Mein Symbol', imgData: 'data:image/png;base64,test' } },
    overriddenStdSymbols: {}, deletedStdSymbols: new Set(), SYMBOLS: { ST: { svg: '<circle/>' } }, symCache: { ST: 'old' },
    mergeCustomSymbols(){}, saveCustomSymbols(){ saved++; }
  };
  vm.createContext(context); vm.runInContext(source, context);
  context.restoreProjectSymbolConfig({ customSymbols: {} });
  assert.equal(context.customSymbols.own.name, 'Mein Symbol');
  context.restoreProjectSymbolConfig({ customSymbols: { second: { name: 'Zweites' } }, overriddenStdSymbols: { ST: { imgData: 'data:image/png;base64,replacement', name: 'Eigene Steckdose' } } });
  assert.equal(context.customSymbols.own.name, 'Mein Symbol');
  assert.equal(context.customSymbols.second.name, 'Zweites');
  assert.equal(context.SYMBOLS.ST.name, 'Eigene Steckdose');
  assert.match(context.SYMBOLS.ST.svg, /replacement/);
  assert.equal(context.symCache.ST, undefined);
  assert.equal(saved, 2);
});
test('project export includes custom symbols, overrides and deletion markers', () => {
  const source = html.slice(html.indexOf('function serializeProjectData('), html.indexOf('function loadProjectData('));
  const context = {
    captureActiveFloorplan(){}, currentLocalProjectId: 'project-test',
    document: { getElementById: () => ({ value: 'Test' }) }, simpleClone: v => JSON.parse(JSON.stringify(v || null)),
    state: { floorplans: [], symbols: [], wires: [] }, currentFloorplanData: () => null,
    customSymbols: { own: { imgData: 'own-data' } }, overriddenStdSymbols: { ST: { imgData: 'override-data' } }, deletedStdSymbols: new Set(['TV'])
  };
  vm.createContext(context); vm.runInContext(source, context);
  const data = context.serializeProjectData();
  assert.equal(data.customSymbols.own.imgData, 'own-data');
  assert.equal(data.overriddenStdSymbols.ST.imgData, 'override-data');
  assert.equal(data.deletedStdSymbols[0], 'TV');
  context.customSymbols.own.imgData = 'changed';
  assert.equal(data.customSymbols.own.imgData, 'own-data');
});
test('storage failure gives a visible warning without discarding in-memory symbols', () => {
  const source = html.slice(html.indexOf('function saveCustomSymbols('), html.indexOf('// Projekte ergänzen'));
  let warning = '';
  const context = {
    customSymbols: { own: { name: 'Keep' } }, deletedStdSymbols: new Set(), overriddenStdSymbols: {},
    localStorage: { setItem(){ throw new Error('QuotaExceededError'); } },
    LS_CUSTOM: 'custom', LS_DELETED: 'deleted', LS_OVERRIDES: 'overrides',
    console: { warn(){} }, alert: text => { warning = text; }
  };
  vm.createContext(context); vm.runInContext(source, context);
  assert.equal(context.saveCustomSymbols(), false);
  assert.match(warning, /Symbol-Backup/);
  assert.equal(context.customSymbols.own.name, 'Keep');
});
