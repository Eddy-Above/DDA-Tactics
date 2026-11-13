// Static inventory, not a substitute for runtime route tests. The scan finds
// setup-time fetch/load awaits and module-level reactive composable state.
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
async function files(directory) {
  const entries = await readdir(resolve(app, directory), { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat()
}
const groups = Object.fromEntries(await Promise.all(['pages', 'components', 'layouts', 'composables', 'middleware'].map(async (name) => [name, await files(name)])))
const findings = [], pages = [], shared = []
for (const file of [...Object.values(groups).flat(), 'app.vue']) {
  const text = await readFile(resolve(app, file), 'utf8')
  const script = file.endsWith('.vue') ? parse(text, { filename: file }).descriptor.scriptSetup?.content ?? '' : text
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const awaits = [], mounted = []
  function topLevel(node) {
    if (node !== source && ts.isFunctionLike(node))
      return
    if (ts.isAwaitExpression(node)) {
      const expression = node.expression
      const call = ts.isCallExpression(expression) ? expression.expression.getText(source) : expression.getText(source)
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      awaits.push({ call, line })
      if (/^(?:fetch|load|refresh|\$fetch)/.test(call) && call !== 'fetchMe')
        findings.push({ file, line, kind: 'setup-data-request-without-hydration-payload', call })
    }
    ts.forEachChild(node, topLevel)
  }
  function hooks(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'onMounted')
      mounted.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    ts.forEachChild(node, hooks)
  }
  topLevel(source)
  hooks(source)
  if (file.startsWith('composables/'))
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement))
        continue
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer
        if (init && ts.isCallExpression(init) && ['ref', 'shallowRef', 'reactive'].includes(init.expression.getText(source)))
          findings.push({ file, line: source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1, kind: 'module-reactive-state', name: declaration.name.getText(source) })
      }
    }
  const entry = { file, awaits, mountedHooks: mounted }
  if (file.startsWith('pages/'))
    pages.push(entry)
  else if (awaits.length || mounted.length)
    shared.push(entry)
}
const report = {
  scope: 'source inventory of all route pages, shared components, layouts, composables, middleware and app root; flags are audit candidates, not proof of every possible reload defect',
  counts: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, value.length])), findings, pages, shared
}
await mkdir(resolve(app, '.cache'), { recursive: true })
await writeFile(resolve(app, '.cache/reload-audit.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ counts: report.counts, findings, inventory: relative(app, resolve(app, '.cache/reload-audit.json')) }, null, 2))
assert.equal(findings.length, 0, 'Review setup data requests and shared module state before accepting reload behaviour')
