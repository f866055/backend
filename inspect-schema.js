



const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, user: 'postgres', password: '1111', database: 'db_garaje' });

async function run() {
  await client.connect();
  const tables = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  console.log('TABLAS:', tables.rows.map(r => r.table_name));

  for (const t of tables.rows) {
    const cols = await client.query(`
      SELECT column_name, data_type,
      
      udt_name, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = '${t.table_name}'
      ORDER BY ordinal_position;
    `);
    console.log(`\nCOLUMNAS DE ${t.table_name}:`);
    console.log(cols.rows.map(c => `  ${c.column_name} (${c.udt_name})`).join('\n'));
  }

  const fks = await client.query(`
    SELECT
      tc.table_name, 
      kcu.column_name, 
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
  `);
  console.log('\nFOREIGN KEYS:');
  console.log(JSON.stringify(fks.rows, null, 2));

  const enums = await client.query(`
    SELECT t.typname, string_agg(e.enumlabel, ', ') as values
    FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid 
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname;
  `);
  console.log('\nENUMS:');
  console.log(enums.rows);

  await client.end();
}
run().catch(console.error);
