'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeSecurity } = require('../src/engine/security.js');

test('security: a hardened HTTPS response produces no header findings', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [
      {
        url: 'https://app.example.com/',
        status: 200,
        headers: {
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'strict-transport-security': 'max-age=63072000',
          'referrer-policy': 'no-referrer',
        },
      },
    ],
  });
  assert.equal(findings.length, 0);
});

test('security: bare HTTPS response flags the expected missing headers', () => {
  const { findings, summary } = analyzeSecurity({
    documentResponses: [{ url: 'https://app.example.com/', status: 200, headers: {} }],
  });
  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes('csp-missing'));
  assert.ok(ids.includes('nosniff-missing'));
  assert.ok(ids.includes('clickjacking'));
  assert.ok(ids.includes('hsts-missing'));
  assert.ok(ids.includes('referrer-policy'));
  assert.ok(summary.total >= 5);
});

test('security: HSTS is not required on plain HTTP documents', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [{ url: 'http://localhost:3000/', status: 200, headers: {} }],
  });
  assert.ok(!findings.some((f) => f.id === 'hsts-missing'));
});

test('security: frame-ancestors in CSP satisfies clickjacking protection', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [
      { url: 'https://app.example.com/', status: 200, headers: { 'content-security-policy': "frame-ancestors 'self'" } },
    ],
  });
  assert.ok(!findings.some((f) => f.id === 'clickjacking'));
});

test('security: a cookie missing HttpOnly + Secure on HTTPS is high severity', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [{ url: 'https://app.example.com/', status: 200, headers: {} }],
    cookies: [{ name: 'session', secure: false, httpOnly: false, sameSite: 'None', domain: 'app.example.com' }],
  });
  const cookie = findings.find((f) => f.id.startsWith('cookie-flags-'));
  assert.ok(cookie);
  assert.equal(cookie.severity, 'high');
});

test('security: mixed content is flagged on an HTTPS page', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [{ url: 'https://app.example.com/', status: 200, headers: {} }],
    requests: [{ url: 'http://cdn.insecure.com/a.js', resourceType: 'script' }],
  });
  assert.ok(findings.some((f) => f.id.startsWith('mixed-content-')));
});

test('security: password field over HTTP is high severity', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [{ url: 'http://app.example.com/login', status: 200, headers: {} }],
    forms: [{ pageUrl: 'http://app.example.com/login', action: 'http://app.example.com/login', hasPassword: true }],
  });
  assert.ok(findings.some((f) => f.id === 'password-over-http' && f.severity === 'high'));
  assert.ok(findings.some((f) => f.id === 'form-post-http'));
});

test('security: repeated header gaps across pages are deduped', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [
      { url: 'https://app.example.com/', status: 200, headers: {} },
      { url: 'https://app.example.com/dashboard', status: 200, headers: {} },
    ],
  });
  assert.equal(findings.filter((f) => f.id === 'csp-missing').length, 1);
});

test('security: findings are sorted high → medium → low', () => {
  const { findings } = analyzeSecurity({
    documentResponses: [{ url: 'https://app.example.com/', status: 200, headers: { server: 'nginx/1.2' } }],
    forms: [{ pageUrl: 'http://app.example.com/login', action: '', hasPassword: true }],
  });
  const ranks = findings.map((f) => ({ high: 0, medium: 1, low: 2 }[f.severity]));
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] >= ranks[i - 1], 'findings must be severity-sorted');
  }
});
