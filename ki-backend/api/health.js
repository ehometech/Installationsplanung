'use strict';
module.exports = function handler(req, res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.statusCode = 200;
  res.end(JSON.stringify({
    ok: true,
    service: 'installationsplanung-ki-backend',
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    firebaseConfigured: true,
    model: process.env.OPENAI_MODEL || 'gpt-6.1-sol'
  }));
};
