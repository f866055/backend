const base = 'http://localhost:3000/api';
(async () => {
  const login = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@garaje.com', password: 'Garaje2026!' }),
  });
  console.log('login status:', login.status);
  const setCookie = login.headers.get('set-cookie');
  const token = setCookie ? setCookie.split(';')[0].split('=')[1] : null;
  console.log('set-cookie parseado:', !!token);
  const headers = token ? { cookie: `token=${token}` } : {};

  const r = await fetch(base + '/cash-shifts/current', { headers });
  console.log('current:', r.status);
  console.log(await r.text());
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });