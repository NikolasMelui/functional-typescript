import Ajv from 'ajv'
import test from 'ava'
import * as fs from 'fs-extra'
import getPort from 'get-port'
import * as globby from 'globby'
import got from 'got'
import jsf from 'json-schema-faker'
import * as path from 'path'
import pify from 'pify'
import * as qs from 'qs'
import seedrandom from 'seedrandom'
import * as tempy from 'tempy'
import * as FTS from '.'

const fixtures = globby.sync('./fixtures/**/*.ts')
const ajv = new Ajv({ useDefaults: true, coerceTypes: true })

jsf.option({
  alwaysFakeOptionals: true,
  // make values generated by json-schema-faker deterministic
  random: seedrandom('NzYxNDdlNjgxYzliN2FkNjFmYjBlMTI5')
})

for (const fixture of fixtures) {
  const { name, dir } = path.parse(fixture)
  const testConfigPath = path.join(process.cwd(), dir, 'config.json')

  test.serial(name, async (t) => {
    let testConfig = {
      get: true,
      post: true,
      postArray: true
    }

    if (fs.pathExistsSync(testConfigPath)) {
      testConfig = {
        ...testConfig,
        ...require(testConfigPath)
      }
    }

    const outDir = tempy.directory()
    const definition = await FTS.generateDefinition(fixture, {
      compilerOptions: {
        outDir
      },
      emit: true
    })
    t.truthy(definition)

    const jsFilePath = path.join(outDir, `${name}.js`)
    const handler = FTS.createHttpHandler(definition, jsFilePath)
    t.is(typeof handler, 'function')

    const port = await getPort()
    const server = await FTS.createHttpServer(handler, port)
    const url = `http://localhost:${port}`

    const params = await jsf.resolve(definition.params.schema)
    const query = qs.stringify(params)
    console.log({ name, params, query, port })

    // test GET request with params as a query string
    // note: not all fixtures will support this type of encoding
    // TODO: figure out how to disable / configure different fixtures
    if (testConfig.get) {
      const responseGET = await got(url, {
        json: true,
        query
      })
      validateResponseSuccess(responseGET, 'GET')
    }

    // test POST request with params as a json body object
    if (testConfig.post) {
      const responsePOST = await got.post(url, {
        body: params,
        json: true
      })
      validateResponseSuccess(responsePOST, 'POST')
    }

    // test POST request with params as a json body array
    if (testConfig.postArray) {
      const paramsArray = definition.params.order.map((key) => params[key])
      const responsePOSTArray = await got.post(url, {
        body: paramsArray,
        json: true
      })
      validateResponseSuccess(responsePOSTArray, 'POSTArray')
    }

    // TODO: invoke original TS function with params and ensure same result

    await pify(server.close.bind(server))()
    await fs.remove(outDir)

    function validateResponseSuccess(res: got.Response<object>, label: string) {
      console.log({
        body: res.body,
        label,
        statusCode: res.statusCode
      })
      t.is(res.statusCode, 200)

      const validateReturns = ajv.compile(definition.returns.schema)
      validateReturns(res.body)
      t.is(validateReturns.errors, null)

      // TODO: snapshot statusCode, statusMessage, and body
    }
  })
}
