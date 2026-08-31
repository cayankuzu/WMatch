import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const repositoryRoot = resolve('.');
const sourceRoots = ['src', 'utils', 'supabase/functions/make-server-d962235e'];
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const approvedReverseEdges = new Set([
  'src/shared/utils/mediaPrefetchQueue.ts->src/services/connectivity.ts',
  'src/shared/utils/mediaPrefetchQueue.ts->src/services/runtimeProfile.ts',
]);

function portablePath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function listSourceFiles(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return sourceExtensions.includes(extname(path)) ? [path] : [];

  return readdirSync(path)
    .flatMap((entry) => listSourceFiles(join(path, entry)))
    .sort();
}

function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = normalize(resolve(dirname(importer), specifier));
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => join(base, `index${extension}`)),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  return resolved ? portablePath(relative(repositoryRoot, resolved)) : null;
}

function readStaticSpecifiers(file) {
  const source = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

export function dependencyDirectionViolation(importerPath, dependencyPath) {
  const importer = portablePath(importerPath);
  const dependency = portablePath(dependencyPath);
  const edge = `${importer}->${dependency}`;

  if (approvedReverseEdges.has(edge)) return null;

  const importerIsEdge = importer.startsWith('supabase/functions/make-server-d962235e/');
  const dependencyIsEdge = dependency.startsWith('supabase/functions/make-server-d962235e/');

  if (
    importerIsEdge &&
    (/^src\/(app|context|services)\//.test(dependency) || dependency.startsWith('utils/'))
  ) {
    return 'Edge code may depend only on Edge-local modules, generated DB types, or mobile shared contracts.';
  }

  if (!importerIsEdge && /^(src|utils)\//.test(importer) && dependencyIsEdge) {
    return 'Mobile code must not import the server deployment implementation.';
  }

  if (importer.startsWith('utils/') && dependency.startsWith('src/')) {
    return 'Base utilities must not depend on higher mobile layers.';
  }

  if (
    importer.startsWith('src/shared/') &&
    /^src\/(app|context|services)\//.test(dependency)
  ) {
    return 'Shared contracts must not gain new UI, context, or service dependencies.';
  }

  if (
    importer.startsWith('src/services/') &&
    /^src\/(app|context)\//.test(dependency)
  ) {
    return 'Services must not depend on UI or React context layers.';
  }

  if (importer.startsWith('src/context/') && dependency.startsWith('src/app/')) {
    return 'Contexts must not depend on the UI composition layer.';
  }

  return null;
}

export function scanDependencyDirections(files = sourceRoots.flatMap(listSourceFiles)) {
  const violations = [];
  let edgeCount = 0;

  for (const file of files) {
    const importer = portablePath(relative(repositoryRoot, resolve(file)));

    for (const specifier of readStaticSpecifiers(file)) {
      const dependency = resolveRelativeImport(resolve(file), specifier);
      if (!dependency) continue;
      edgeCount += 1;
      const reason = dependencyDirectionViolation(importer, dependency);
      if (reason) violations.push({ importer, dependency, reason });
    }
  }

  return { files: files.length, edges: edgeCount, violations };
}

function runCli() {
  const result = scanDependencyDirections();

  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.error(`${violation.importer} -> ${violation.dependency}: ${violation.reason}`);
    }
    throw new Error(`Architecture dependency direction check found ${result.violations.length} violation(s).`);
  }

  console.log(
    `Architecture dependency direction check passed. files=${result.files} edges=${result.edges} ` +
    `approvedLegacyEdges=${approvedReverseEdges.size}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
