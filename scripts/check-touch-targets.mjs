import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const INTERACTIVE_COMPONENTS = new Set([
  'Pressable',
  'TouchableHighlight',
  'TouchableNativeFeedback',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
]);
const MIN_TARGET = 48;

function collectFiles(path) {
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    return statSync(child).isDirectory()
      ? collectFiles(child)
      : child.endsWith('.tsx')
        ? [child]
        : [];
  });
}

function numericValue(expression) {
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }

  if (ts.isPrefixUnaryExpression(expression) && ts.isNumericLiteral(expression.operand)) {
    return expression.operator === ts.SyntaxKind.MinusToken
      ? -Number(expression.operand.text)
      : Number(expression.operand.text);
  }

  return null;
}

function objectDimensions(object) {
  const dimensions = new Map();

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = property.name.getText().replaceAll(/["']/g, '');
    if (!['height', 'minHeight', 'width', 'minWidth'].includes(name)) {
      continue;
    }

    const value = numericValue(property.initializer);
    if (value != null) {
      dimensions.set(name, value);
    }
  }

  return dimensions;
}

function collectStyleReferences(node, references, inlineObjects) {
  if (ts.isPropertyAccessExpression(node) && node.expression.getText() === 'styles') {
    references.add(node.name.text);
  }

  if (ts.isObjectLiteralExpression(node)) {
    inlineObjects.push(node);
  }

  ts.forEachChild(node, (child) => collectStyleReferences(child, references, inlineObjects));
}

const violations = [];

for (const file of collectFiles('src')) {
  const sourceText = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styleObjects = new Map();

  function collectStyleSheet(node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.getText() === 'StyleSheet.create'
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
          styleObjects.set(property.name.getText().replaceAll(/["']/g, ''), property.initializer);
        }
      }
    }
    ts.forEachChild(node, collectStyleSheet);
  }
  collectStyleSheet(source);

  function visit(node) {
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const component = node.tagName.getText();
    if (!INTERACTIVE_COMPONENTS.has(component)) {
      ts.forEachChild(node, visit);
      return;
    }

    let hitSlop = 0;
    const styleReferences = new Set();
    const inlineObjects = [];

    for (const attribute of node.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) {
        continue;
      }

      if (
        attribute.name.getText() === 'hitSlop'
        && attribute.initializer
        && ts.isJsxExpression(attribute.initializer)
        && attribute.initializer.expression
      ) {
        hitSlop = numericValue(attribute.initializer.expression) ?? 0;
      }

      if (
        attribute.name.getText() === 'style'
        && attribute.initializer
        && ts.isJsxExpression(attribute.initializer)
        && attribute.initializer.expression
      ) {
        collectStyleReferences(attribute.initializer.expression, styleReferences, inlineObjects);
      }
    }

    const candidateObjects = [
      ...[...styleReferences].map((name) => styleObjects.get(name)).filter(Boolean),
      ...inlineObjects,
    ];

    for (const styleObject of candidateObjects) {
      const dimensions = objectDimensions(styleObject);
      for (const [dimension, value] of dimensions) {
        if (value <= 0 || value + (hitSlop * 2) >= MIN_TARGET) {
          continue;
        }

        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${file}:${position.line + 1} ${component} ${dimension}=${value} hitSlop=${hitSlop}`);
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (violations.length > 0) {
  console.error(`Touch target check failed (minimum ${MIN_TARGET} dp):\n${violations.join('\n')}`);
  process.exit(1);
}

console.log(`Touch target check passed. explicit interactive dimensions meet ${MIN_TARGET} dp with hitSlop.`);
