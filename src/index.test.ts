import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The app entry (index.ts) must bundle where there is no Node: every file it
 * reaches through a value import may import only the packages below, and may
 * not use a Node global. A type-only import is erased, so it doesn't count.
 */

const PACKAGES = ['bible-passage-reference-parser', 'drizzle-orm', 'fflate'];

/** The module names a file imports or re-exports as values. */
function valueImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const out: string[] = [];
  for (const s of source.statements) {
    const typeOnly =
      (ts.isImportDeclaration(s) && s.importClause?.isTypeOnly) || (ts.isExportDeclaration(s) && s.isTypeOnly) || false;
    if ((ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) && s.moduleSpecifier && !typeOnly) {
      out.push((s.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return out;
}

/** Every source file reachable from `entry` through value imports, and every package named on the way. */
function reach(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    for (const name of valueImports(file)) {
      if (!name.startsWith('.')) packages.add(name);
      else visit([`${join(dirname(file), name)}.ts`, join(dirname(file), name, 'index.ts')].find(existsSync) ?? join(dirname(file), name));
    }
  };
  visit(entry);
  return { files: [...files], packages: [...packages] };
}

describe('the app entry (index.ts)', () => {
  const { files, packages } = reach(join(import.meta.dirname, 'index.ts'));

  it('reaches the contract, the pack reader and the provider', () => {
    const names = files.map((f) => f.slice(import.meta.dirname.length + 1));
    expect(names).toEqual(expect.arrayContaining(['contract/corpus-contract.ts', 'pack/format.ts', 'provider/provider.ts', 'provider/licensed-chapters.ts']));
    expect(files.every((f) => existsSync(f))).toBe(true);
  });

  it('imports no Node module and no package an app must build natively', () => {
    const outside = packages.filter((p) => !PACKAGES.some((ok) => p === ok || p.startsWith(`${ok}/`)));
    expect(outside).toEqual([]);
  });

  it('uses no Node global', () => {
    const uses = files.filter((f) => /\b(process|Buffer|__dirname|__filename|require)\b(?!['\w-])/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
    expect(uses).toEqual([]);
  });

  it('does not reach the Node-only pieces', () => {
    const names = files.map((f) => f.slice(import.meta.dirname.length + 1));
    for (const nodeOnly of ['pack/pack.ts', 'provider/api-bible-cache.ts', 'ingest/write-db.ts', 'ingest/parse.ts']) expect(names).not.toContain(nodeOnly);
  });
});
