import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const appDirectory = fileURLToPath(new URL('../../', import.meta.url))
const jiti = createJiti(import.meta.url, {
  alias: { '~': appDirectory, '@': appDirectory },
  fsCache: false,
})

/** Load a real application module without Nuxt startup or generated output. */
export function loadTypeScript(relativePath) {
  return jiti(resolve(appDirectory, relativePath))
}

/** Load the complete real module while replacing its named direct dependencies. */
export function loadTypeScriptWithMocks(relativePath, mocks) {
  const filename = resolve(appDirectory, relativePath)
  const sourceJiti = createJiti(filename, {
    alias: { '~': appDirectory, '@': appDirectory },
    fsCache: false,
  })
  const require = (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : sourceJiti(specifier)
  require.resolve = (specifier) => sourceJiti.resolve(specifier)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', outputText)(
    require, module, module.exports, filename, dirname(filename),
  )
  return module.exports
}

/** Compile an SFC in memory for rendering with Vue's installed SSR renderer. */
export function loadVueComponent(relativePath) {
  const filename = resolve(appDirectory, relativePath)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  if (errors.length) throw errors[0]

  const compiled = compileScript(descriptor, {
    id: relativePath.replaceAll('\\', '/'),
    inlineTemplate: true,
  })

  return jiti.evalModule(compiled.content, {
    filename: `${filename}.ts`,
    forceTranspile: true,
  }).default
}

/** Run selected real page handlers with explicit refs/callbacks, without starting Nuxt. */
export function loadPageFunctions(relativePath, functionNames, dependencies) {
  const filename = resolve(appDirectory, relativePath)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  if (errors.length) throw errors[0]
  if (!descriptor.scriptSetup) throw new Error(`Missing script setup in ${relativePath}`)

  const source = ts.createSourceFile(filename, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declarations = new Map(source.statements
    .filter((statement) => ts.isFunctionDeclaration(statement) && statement.name)
    .map((statement) => [statement.name.text, statement]))
  const selectedSource = functionNames.map((name) => {
    const declaration = declarations.get(name)
    if (!declaration) throw new Error(`Missing function ${name} in ${relativePath}`)
    return declaration.getText(source)
  }).join('\n')
  const { outputText } = ts.transpileModule(selectedSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  })
  return new Function(...Object.keys(dependencies), `${outputText}\nreturn { ${functionNames.join(', ')} }`)(...Object.values(dependencies))
}
