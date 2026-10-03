# KI-Backend für die Installationsplanung

Das Frontend (GitHub Pages) kann keine Geheimnisse halten. Deshalb läuft der KI-Aufruf über diese kleine Serverless-Funktion.
**Der OpenAI-Schlüssel steht ausschließlich in den Umgebungsvariablen des Hosters** – nicht im JavaScript, nicht im localStorage, nicht im Repository.

```
Browser (index.html)  ──POST /api/ai/electrical-plan (Firebase-Token)──▶  Backend  ──(API-Key)──▶  OpenAI (Bild + JSON-Schema)
        ◀──────────── validiertes JSON {rooms:[{roomId,objects[]}], warnings[]} ◀──────────────────┘
```

## Einrichtung (Vercel, ca. 10 Minuten)
1. Diesen Ordner als **eigenes** Repository (z. B. `installationsplanung-ki-backend`) auf GitHub anlegen – nicht in das GitHub-Pages-Repo legen.
2. Auf vercel.com „Add New → Project“ → dieses Repository importieren.
3. Unter *Settings → Environment Variables* setzen (Werte siehe `.env.example`):
   - `OPENAI_API_KEY` – Ihr Schlüssel (nur dort!)
   - `OPENAI_MODEL` – Modell mit Bildverständnis und Structured Outputs (Standard `gpt-4o`; aktuelles Modell im OpenAI-Konto prüfen)
   - `FIREBASE_WEB_API_KEY` – der `apiKey` aus `FIREBASE_CONFIG` in der index.html (öffentlicher Web-Key, dient zur Prüfung der Anmeldung)
   - `ALLOWED_ORIGINS` – `https://ehometech.github.io`
   - optional `ALLOWED_EMAILS` (nur diese Konten dürfen die KI nutzen), `RATE_LIMIT_PER_HOUR`
4. Deployen. Die URL lautet dann `https://<projekt>.vercel.app/api/ai/electrical-plan`.
5. In der App: **🤖 KI Elektroplanung → Planungs-Engine „KI über Backend“ → URL eintragen**. Bei Ausfall fällt die App (einstellbar) auf die lokalen Regeln zurück.

Lokaler Test ohne Schlüssel: `node test-handler.js` (OpenAI und Firebase werden gemockt).

## Request (vom Frontend)
`schemaVersion, task{mode,command}, standard, options, custom, floorplan{width,height,scalePxPerM,imageDataUrl (JPEG, Räume/Türen „T“/Fenster „F“ eingezeichnet)}, rooms[{roomId,name,type,polygon[{x,y}] relativ 0..1}], doors[], windows[], existingSymbols[], allowedSymbolTypes[{symbolType,label,category}]`

## Response
```json
{ "rooms": [ { "roomId": "room-1", "objects": [
    { "symbolType": "socket_double", "x": 0.31, "y": 0.48, "rotation": 0, "reason": "Steckdose an freier Wand" } ] } ],
  "warnings": ["…"], "model": "…" }
```
`x`,`y` relativ 0..1 zur Grundrissgröße. Das Backend erzwingt per JSON-Schema-Enum, dass `symbolType` nur aus `allowedSymbolTypes` stammt und `roomId` nur aus den gesendeten Räumen – und prüft die Antwort zusätzlich nach. Das Frontend validiert ein zweites Mal (Typ existiert, Punkt liegt im Raum, Duplikate) und zeigt nur eine **Vorschau**.

## Datenschutz / Kosten
- Grundrisse und Raumdaten (ggf. Kundendaten!) gehen an den KI-Anbieter. Mit OpenAI einen Auftragsverarbeitungsvertrag abschließen und ggf. Kunden informieren.
- Jeder Aufruf verursacht Kosten (Bild + Antwort). `RATE_LIMIT_PER_HOUR` und `ALLOWED_EMAILS` begrenzen Missbrauch; für ein hartes Limit KV/Redis ergänzen.

## Hinweis
Dieses Backend wurde gegen gemockte Dienste getestet (Auth, CORS, Validierung, Schema, Fehlerfälle). Ein Lauf gegen die echte OpenAI-API steht noch aus; einzelne Request-Parameter (z. B. `max_completion_tokens`) sind modellabhängig und ggf. anzupassen.
