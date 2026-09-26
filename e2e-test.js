const { Client } = require('pg');
const base = 'http://localhost:3000/api';

async function main() {
  // 1) Esquema: columnas nuevas en payments + enum ampliado + tabla cash_shifts.
  const db = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: '1111', database: 'db_garaje' });
  await db.connect();
  const cols = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='payments' AND column_name IN ('cash_shift_id','operation_number') ORDER BY 1`,
  );
  console.log('payments columnas nuevas:', cols.rows.map((r) => r.column_name).join(', '));
  const enumVals = await db.query(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='payments_method_enum' ORDER BY enumsortorder`,
  );
  console.log('payments_method_enum:', enumVals.rows.map((r) => r.enumlabel).join(', '));
  const hasCashShifts = await db.query(
    `SELECT to_regclass('public.cash_shifts') AS name`,
  );
  console.log('cash_shifts existe:', hasCashShifts.rows[0].name);
  await db.end();

  // 2) Flujo E2E por HTTP.
  const login = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@garaje.com', password: 'Garaje2026!' }),
  });
  const sc = login.headers.get('set-cookie') || '';
  const cookie = sc.split(',').map((p) => p.split(';')[0]).join('; ');
  const H = { 'Content-Type': 'application/json', cookie };

  const getJson = async (url) => {
    const r = await fetch(base + url, { headers: H });
    let body = null;
    try { body = await r.json(); } catch { }
    return { status: r.status, body };
  };

  // Estado actual de caja.
  let { status: curStatus, body: cur } = await getJson('/cash-shifts/current');
  console.log('current ->', curStatus, JSON.stringify(cur));

  const openId = cur.shift && cur.hasOpen ? cur.shift.id : null;
  if (!openId) {
    const open = await fetch(base + '/cash-shifts/open', {
      method: 'POST', headers: H,
      body: JSON.stringify({ openingFund: 100 }), redirect: 'manual',
    });
    const openBody = await open.json();
    console.log('open ->', open.status, JSON.stringify({ id: openBody.shift?.id, hasOpen: openBody.hasOpen }));
  } else {
    console.log('ya había caja abierta ->', openId);
  }

  // Registrar un vehículo + ingreso (solo para probar el cobro de verdad).
  // Placa fija: el test es idempotente (reutiliza el vehículo si existe).
  const plate = 'E2E-TST789';
  const existing = await getJson(`/vehicles/${encodeURIComponent(plate)}`);
  let eBody;
  if (existing.status === 200 && existing.body.activeEntry) {
    eBody = { ticketCode: existing.body.activeEntry.ticketCode, entryAt: existing.body.activeEntry.entryAt };
    console.log('vehículo existente -> reusar ingreso activo', eBody.ticketCode);
  } else if (existing.status === 200) {
    const entry = await fetch(base + `/vehicles/${encodeURIComponent(plate)}/entry`, {
      method: 'POST', headers: H, body: JSON.stringify({}),
    });
    eBody = await entry.json();
    console.log('entry POST (vehículo existente) ->', entry.status, JSON.stringify(eBody));
  } else {
    const v = await fetch(base + '/vehicles', {
      method: 'POST', headers: H,
      body: JSON.stringify({ plate, type: 'Sedán' }),
    });
    const vBody = await v.json();
    console.log('vehicles POST ->', v.status, JSON.stringify({
      vehicle: { id: vBody.vehicle?.id, plate: vBody.vehicle?.plate },
      entry: vBody.entry?.ticketCode,
    }));
    if (v.ok && vBody.entry) {
      eBody = vBody.entry;
    } else {
      const entry = await fetch(base + `/vehicles/${encodeURIComponent(plate)}/entry`, {
        method: 'POST', headers: H, body: JSON.stringify({}),
      });
      eBody = await entry.json();
      console.log('entry POST ->', entry.status, JSON.stringify(eBody));
    }
  }

  const eCode = eBody.ticketCode || eBody.ticket?.ticketCode || null;
  if (eCode) {
    // Espera ~2s para que el total sea > 0 y busca el ticket activo.
    await new Promise((r) => setTimeout(r, 2200));
    const lk = await getJson(`/payments/active-entry?q=${encodeURIComponent(eCode)}`);
    console.log('active-entry ->', lk.status, JSON.stringify(lk.body));

    const entryId = lk.body.entry.id;
    const pending = lk.body.pending;

    // Un abono (pago a cuenta) + nueva búsqueda para ver el historial.
    const abono = await fetch(base + '/payments/credit', {
      method: 'POST', headers: H,
      body: JSON.stringify({ ticketId: entryId, amount: 1 }),
    });
    const abonoBody = await abono.json();
    console.log('credit POST ->', abono.status, JSON.stringify(abonoBody.credit));

    const lk2 = await getJson(`/payments/active-entry?q=${encodeURIComponent(eCode)}`);
    console.log('active-entry (historial) -> credits:', JSON.stringify(lk2.body?.credits), 'pending:', lk2.body?.pending);

    // Cobro final con YAPE.
    const payment = await fetch(base + '/payments', {
      method: 'POST', headers: H,
      body: JSON.stringify({ ticketId: entryId, paymentMethod: 'yape' }),
    });
    const payBody = await payment.json();
    console.log('payment POST (yape) ->', payment.status, JSON.stringify({
      amount: payBody.payment?.amount,
      method: payBody.payment?.method,
      operationNumber: payBody.payment?.operationNumber,
      change: payBody.payment?.change,
    }));

    // Doble cobro del mismo ticket DEBE fallar.
    const again = await fetch(base + '/payments', {
      method: 'POST', headers: H,
      body: JSON.stringify({ ticketId: entryId, paymentMethod: 'yape' }),
    });
    console.log('doble cobro ->', again.status, (await again.json()).message);

    // Cerrar la caja y ver resumen.
    const cur2 = await getJson('/cash-shifts/current');
    const toClose = cur2.body.shift.id;
    const close = await fetch(base + `/cash-shifts/${toClose}/close`, { method: 'POST', headers: H });
    const closeBody = await close.json();
    console.log('close ->', close.status, JSON.stringify({
      status: closeBody.shift?.status,
      totals: closeBody.totals,
      credits: closeBody.credits,
      totalCollected: closeBody.totalCollected,
      operationsCount: closeBody.operationsCount,
    }));

    // Con caja cerrada, cobrar DEBE fallar.
    const noShift = await fetch(base + '/payments', {
      method: 'POST', headers: H,
      body: JSON.stringify({ ticketId: entryId, paymentMethod: 'cash', amountReceived: 10 }),
    });
    console.log('pago caja cerrada ->', noShift.status, (await noShift.json()).message);
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); }); 