# Claude-Server und erster Fehlerbehebungsstand

Die öffentliche GitHub-Pages-App kann keinen geheimen Anthropic-API-Schlüssel hosten.
Der Server in `server/claude-proxy.mjs` ist deshalb getrennt auf einem Node.js-Host
(Node 22 oder neuer) hinter HTTPS bereitzustellen.

## Serverkonfiguration

Umgebungsvariablen auf dem Server (niemals im Repository einchecken):
- ANTHROPIC_API_KEY: Anthropic-Schlüssel.
- CLAUDE_ACCESS_TOKEN: zufälliger Zugangscode mit mindestens 32 Zeichen.
- CLAUDE_MODEL: verfügbare Modell-ID aus dem eigenen Anthropic-Konto.
- ALLOWED_ORIGIN: exakt https://ehometech.github.io (Standard).
- PORT: vom Hoster vorgegebener Port, Standard 3000.

Start: `node server/claude-proxy.mjs`

In der App unter Claude KI:
1. HTTPS-Serveradresse mit dem Pfad /api/claude eintragen.
2. Den separaten Zugangscode eingeben (nicht den Anthropic-Schlüssel).
3. Eine einfache Testfrage senden.

Der Server akzeptiert ausschließlich authentifizierte Fragen von der freigegebenen
Origin und begrenzt Anfragen auf 20 pro Minute / zwei gleichzeitig je Prozess.
Diese Grenzen ersetzen kein monatliches Kostenlimit beim Anbieter. Für größere
Teams sind Benutzeranmeldung und zentrale Limits erforderlich.
Serveradresse und Zugangscode werden in der App nicht dauerhaft gespeichert.

Die Verbindung ist erst nach Serverdeployment und Eingabe gültiger Zugangsdaten
funktionsfähig. Dieser PR enthält keine produktive Bereitstellung.

## Änderungen und Tests

Leere Grundrisse öffnen jetzt ohne Upload-Blockade. Auch der Zoomwert wird beim
Wechsel zu einem bildlosen Grundriss aktualisiert.
Die falschen Aussagen „eingebaut, sofort nutzbar“ und „Ollama (lokal)“ wurden entfernt.
Claude-Anfragen gehen an den eigenen Proxy statt unauthentifiziert an Anthropic.
Fehlende Einstellungen erhalten die Frage; Anfragen haben Zeitlimits.

Tests: `node --test tests/*.test.mjs`.
Die bestehende Offline-Wissensbasis und andere Berechnungsmodule wurden nicht
fachlich überarbeitet und sind nicht Gegenstand dieser Änderung.
