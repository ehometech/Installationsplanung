import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Deploy behind HTTPS. Secrets are supplied only through server environment.
export function createClaudeServer({ apiKey, accessToken, model, allowedOrigin = 'https://ehometech.github.io', fetchImpl = fetch }) {
  if (!apiKey || !accessToken || accessToken.length < 32 || !model) throw new Error('ANTHROPIC_API_KEY, CLAUDE_MODEL and CLAUDE_ACCESS_TOKEN (at least 32 characters) are required.');
  const origin = new URL(allowedOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== allowedOrigin) throw new Error('ALLOWED_ORIGIN must be an HTTPS origin without path.');
  let busy = 0;
  let windowStart = Date.now();
  let requests = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    if (req.url !== '/api/claude') return reply(404, { error: { message: 'Not found' } });
    if (req.headers.origin !== allowedOrigin) return reply(403, { error: { message: 'Origin not allowed' } });
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.writeHead(204); return res.end();
    }
    if (req.method !== 'POST') return reply(405, { error: { message: 'POST required' } });
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + accessToken);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: { message: 'Zugangscode ungültig.' } });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return reply(415, { error: { message: 'JSON required' } });
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (requests >= 20 || busy >= 2) return reply(429, { error: { message: 'Zu viele Anfragen. Bitte später erneut versuchen.' } });
    requests++; busy++;
    try {
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 16384) { reply(413, { error: { message: 'Anfrage zu groß.' } }); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: { message: 'Ungültiges JSON.' } }); }
      if (!input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 8000) return reply(400, { error: { message: 'Eine Frage mit maximal 8000 Zeichen ist erforderlich.' } });
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model, max_tokens: 1000,
          system: 'Du unterstützt Elektrofachkräfte bei der Planung. Antworte auf Deutsch, höchstens 200 Wörter. Nenne Annahmen und Unsicherheiten. Erfinde keine Normnachweise. Eine Empfehlung ersetzt keine Dimensionierung und Messung.',
          messages: [{ role: 'user', content: input.message }]
        }),
        signal: AbortSignal.timeout(40000)
      });
      if (!upstream.ok) return reply(502, { error: { message: 'Claude-Dienst nicht verfügbar. Betreiber muss Modell, API-Zugang und Guthaben prüfen.' } });
      const data = await upstream.json();
      const content = Array.isArray(data.content) ? data.content.filter(c => c.type === 'text' && typeof c.text === 'string').map(c => ({ type: 'text', text: c.text })) : [];
      if (!content.length) return reply(502, { error: { message: 'Keine Textantwort von Claude.' } });
      reply(200, { content });
    } catch {
      if (!res.writableEnded) reply(502, { error: { message: 'Claude-Verbindung fehlgeschlagen oder Zeitüberschreitung.' } });
    } finally { busy--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createClaudeServer({
    apiKey: process.env.ANTHROPIC_API_KEY,
    accessToken: process.env.CLAUDE_ACCESS_TOKEN,
    model: process.env.CLAUDE_MODEL,
    allowedOrigin: process.env.ALLOWED_ORIGIN || 'https://ehometech.github.io'
  });
  server.requestTimeout = 15000;
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Claude proxy ready'));
}
