// Aplica migracoes pendentes ao banco.
//
// Existe porque `schema.sql` (que roda a cada boot) so sabe CRIAR tabela: ele
// nao acrescenta coluna nem constraint em tabela que ja existe. Num banco
// anterior ao editor de animacao isso derrubava o `/canvas` inteiro com
// `column "native_bundle_id" does not exist`.
//
// Toda migracao aqui e' ACRESCIMO: nenhuma linha e' alterada ou apagada. As
// travas nascem validas porque as colunas novas comecam vazias em toda linha
// que ja existe.
//
//   node scripts/migrate.mjs --list                # so mostra o que falta
//   node scripts/migrate.mjs                       # aplica no DATABASE_URL
//   node scripts/migrate.mjs --isolated            # aplica no banco descartavel
import { neon } from '@neondatabase/serverless';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitSqlStatements } from '../lib/sql-statements.js';

const MIGRACOES = [
  'migrations/2026-07-26-native-motion-editing.sql',
  'migrations/2026-07-26-motion-diagnostics.sql',
];

const isolado = process.argv.includes('--isolated');
const soListar = process.argv.includes('--list');
const url = isolado ? process.env.E2E_ISOLATED_DATABASE_URL : process.env.DATABASE_URL;
if (!url) {
  throw new Error(`${isolado ? 'E2E_ISOLATED_DATABASE_URL' : 'DATABASE_URL'} e' obrigatoria.`);
}

const sql = neon(url);
const alvo = url.replace(/^.*@/, '').replace(/\/.*$/, '');

async function retrato() {
  const colunas = await sql`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  `;
  const porTabela = new Map();
  colunas.forEach(({ table_name: tabela, column_name: coluna }) => {
    if (!porTabela.has(tabela)) porTabela.set(tabela, new Set());
    porTabela.get(tabela).add(coluna);
  });
  // As travas contam junto: o `schema.sql` as declara DENTRO do CREATE TABLE,
  // logo elas nunca nascem num banco cuja tabela ja existia. Sem olhar para
  // elas, o script diria "em dia" com o banco pela metade.
  const travas = await sql`
    SELECT conname FROM pg_constraint
    WHERE conname IN ('snapshots_native_bundle_fk', 'snapshots_native_manifest_shape')
  `;
  return {
    tabelas: [...porTabela.keys()].sort(),
    snapshots: [...(porTabela.get('snapshots') || [])].sort(),
    travas: travas.map((t) => t.conname).sort(),
  };
}

const antes = await retrato();
const esperadas = ['native_bundle_id', 'motion_manifest', 'motion_manifest_version'];
const faltando = {
  colunas: esperadas.filter((coluna) => !antes.snapshots.includes(coluna)),
  tabelas: ['native_motion_edit_sessions', 'motion_diagnostic_events', 'motion_diagnostic_daily_aggregates']
    .filter((tabela) => !antes.tabelas.includes(tabela)),
  travas: ['snapshots_native_bundle_fk', 'snapshots_native_manifest_shape']
    .filter((trava) => !antes.travas.includes(trava)),
};
console.log(JSON.stringify({ alvo, isolado, faltando }, null, 2));

if (soListar) process.exit(0);
if (!faltando.colunas.length && !faltando.tabelas.length && !faltando.travas.length) {
  console.log('nada a aplicar — o banco ja esta em dia');
  process.exit(0);
}

for (const caminho of MIGRACOES) {
  const conteudo = await readFile(path.resolve(caminho), 'utf8');
  const comandos = splitSqlStatements(conteudo);
  console.log(`\n${caminho}: ${comandos.length} comandos`);
  for (const comando of comandos) {
    const rotulo = comando.replace(/\s+/g, ' ').slice(0, 90);
    try {
      await sql(comando);
      console.log(`  ok   ${rotulo}`);
    } catch (erro) {
      console.error(`  FALHOU ${rotulo}\n         ${erro.message}`);
      throw erro;
    }
  }
}

const depois = await retrato();
console.log(`\n${JSON.stringify({
  colunasDeSnapshots: esperadas.filter((coluna) => depois.snapshots.includes(coluna)),
  tabelasCriadas: faltando.tabelas.filter((tabela) => depois.tabelas.includes(tabela)),
  travasCriadas: faltando.travas.filter((trava) => depois.travas.includes(trava)),
}, null, 2)}`);
