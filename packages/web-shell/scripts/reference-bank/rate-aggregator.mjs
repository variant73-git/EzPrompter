import { neon } from '@neondatabase/serverless';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, value = ''] = argument.replace(/^--/, '').split('=', 2);
  return [key, value];
}));
if (args.has('isolated') === args.has('shared')) throw new Error('Choose exactly one target: --isolated or --shared.');
const target = args.has('shared') ? 'shared' : 'isolated';
const databaseUrl = target === 'isolated' ? process.env.E2E_ISOLATED_DATABASE_URL : process.env.DATABASE_URL;
if (!databaseUrl) throw new Error(`${target === 'isolated' ? 'E2E_ISOLATED_DATABASE_URL' : 'DATABASE_URL'} is required.`);

const id = String(args.get('id') || '').trim();
if (!id) throw new Error('--id=<source-id> is required.');
const fields = {
  overallRating: 'overall',
  editorialQuality: 'editorial',
  motionDensity: 'motion',
  metadataQuality: 'metadata',
  noiseControl: 'noise',
};
const ratings = Object.fromEntries(Object.entries(fields).map(([field, argument]) => {
  const raw = args.get(argument);
  if (raw == null || raw === '') return [field, null];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error(`--${argument} must be an integer from 1 to 5.`);
  return [field, value];
}));
if (Object.values(ratings).every((value) => value == null)) throw new Error('Provide at least one rating field.');

const sql = neon(databaseUrl);
const rows = await sql`
  UPDATE reference_aggregators
  SET
    overall_rating = COALESCE(${ratings.overallRating}, overall_rating),
    editorial_quality = COALESCE(${ratings.editorialQuality}, editorial_quality),
    motion_density = COALESCE(${ratings.motionDensity}, motion_density),
    metadata_quality = COALESCE(${ratings.metadataQuality}, metadata_quality),
    noise_control = COALESCE(${ratings.noiseControl}, noise_control),
    updated_at = NOW()
  WHERE id = ${id}
  RETURNING id, name, overall_rating, editorial_quality, motion_density, metadata_quality, noise_control, status
`;
if (!rows.length) throw new Error(`Unknown reference aggregator: ${id}`);
console.log(JSON.stringify({ target, aggregator: rows[0] }, null, 2));
