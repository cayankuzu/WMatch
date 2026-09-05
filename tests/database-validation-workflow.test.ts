import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePgTapOutput } from '../scripts/database/pg-tap-output.mjs';
import { normalizeSupabaseSchemaDiff } from '../infra/docker/scripts/lib.mjs';

const workflow = readFileSync('.github/workflows/database-validation.yml', 'utf8');
const localDbScript = readFileSync('scripts/database/local-db-validation.mjs', 'utf8');

describe('database validation workflow', () => {
  it('runs pgTAP after both complete forward replays', () => {
    const firstReplay = workflow.indexOf('First full migration replay');
    const firstPgTap = workflow.indexOf('Run pgTAP after first replay');
    const secondReplay = workflow.indexOf('Second full migration replay');
    const secondPgTap = workflow.indexOf('Run pgTAP after second replay');

    expect(firstReplay).toBeGreaterThan(0);
    expect(firstPgTap).toBeGreaterThan(firstReplay);
    expect(secondReplay).toBeGreaterThan(firstPgTap);
    expect(secondPgTap).toBeGreaterThan(secondReplay);
    expect(workflow.match(/supabase db reset --local --no-seed/g)).toHaveLength(2);
    expect(workflow.match(/npm run test:rls/g)).toHaveLength(2);
  });

  it('keeps lint, advisors, exposure, nonce, diff, and restore fail-closed', () => {
    expect(workflow).toContain(
      'supabase db lint --local --schema public,storage --level warning --fail-on error',
    );
    expect(workflow).toContain('npm run check:db:advisors');
    expect(localDbScript).toContain("'advisors'");
    expect(localDbScript).toContain("'--local'");
    expect(localDbScript).toContain("'--type'");
    expect(localDbScript).toContain("'--level'");
    expect(localDbScript).toContain("'--fail-on'");
    expect(localDbScript).toMatch(
      /supabase\.js'[\s\S]*?'--workdir',[\s\S]*?validationWorkdir,[\s\S]*?'db',[\s\S]*?'advisors'/,
    );
    expect(localDbScript).toContain('ALTER ROLE postgres SET pgrst.db_schemas');
    expect(localDbScript).toContain('ALTER ROLE postgres RESET pgrst.db_schemas');
    expect(workflow).toContain('npm run check:db:exposure');
    expect(workflow).toContain('npm run test:db:nonce');
    expect(workflow).toContain('supabase db diff --from migrations --to local');
    expect(workflow).toContain('npm run test:db:restore');
    expect(workflow).not.toContain('--linked');
  });

  it('restores only into a temporary local database and retests the restored contract', () => {
    expect(localDbScript).toContain('WITH TEMPLATE template0 OWNER supabase_admin');
    expect(localDbScript).toContain("'--role=supabase_admin'");
    expect(localDbScript).toContain("'--single-transaction'");
    expect(localDbScript).toContain("'--exit-on-error'");
    expect(localDbScript).toContain('runPgTap(restoreDatabase)');
    expect(localDbScript).not.toContain("'--no-owner'");
    expect(localDbScript).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(localDbScript).not.toContain('SUPABASE_DB_CONTAINER');
    expect(localDbScript).toContain('com.supabase.cli.project');
  });

  it('always destroys the isolated local stack', () => {
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('supabase stop --no-backup');
  });
});

describe('restored pgTAP output parsing', () => {
  it('accepts one non-empty ordered plan', () => {
    expect(parsePgTapOutput('1..2\nok 1 - first\nok 2 - second\n', 'valid.sql')).toBe(2);
  });

  it('rejects empty or zero-assertion output', () => {
    expect(() => parsePgTapOutput('', 'empty.sql')).toThrow(/exactly one plan/);
    expect(() => parsePgTapOutput('1..0\n', 'zero.sql')).toThrow(/no assertions/);
  });

  it('rejects bailouts even after otherwise valid assertions', () => {
    expect(() => parsePgTapOutput(
      '1..1\nok 1 - initially passed\nBail out! connection lost\n',
      'bailout.sql',
    )).toThrow(/bailed out/);
  });

  it('rejects duplicate plans and invalid assertion numbering', () => {
    expect(() => parsePgTapOutput('1..1\n1..1\nok 1 - duplicate plan\n', 'plans.sql'))
      .toThrow(/exactly one plan/);
    expect(() => parsePgTapOutput('1..2\nok 1 - first\nok 1 - duplicate\n', 'numbers.sql'))
      .toThrow(/numbering is invalid/);
  });
});

describe('Supabase schema diff output parsing', () => {
  it('accepts empty plain-text and JSON diff output', () => {
    expect(normalizeSupabaseSchemaDiff('')).toBe('');
    expect(normalizeSupabaseSchemaDiff('{"diff":"","file":null}')).toBe('');
  });

  it('preserves SQL drift from current and legacy CLI formats', () => {
    expect(normalizeSupabaseSchemaDiff('{"diff":"alter table public.profiles add x text;"}'))
      .toBe('alter table public.profiles add x text;');
    expect(normalizeSupabaseSchemaDiff('alter table public.profiles add x text;'))
      .toBe('alter table public.profiles add x text;');
  });
});
