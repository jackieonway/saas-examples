import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { exerciseLifecycle, parseEntry } from './verify-delivery.mjs'

test('the HTML delivery gate rejects browser-recognized module syntax and encoded external assets', async () => {
  for (const html of [
    '<script type=module src=app.js></script>',
    '<script TYPE="MoDuLe" src="app.js"></script>',
    '<script type="m&#111;dule" src="app.js"></script>',
    '<script type="module">export const value = 1</script>',
    '<script>const note="<!--";</script><script type=module>globalThis.gateProbe=1</script><!-- -->',
    '<link rel="modulepreload" href="app.js"><script src="app.js"></script>',
    '<link rel="moduleprelo&#97;d" href="app.js"><script src="app.js"></script>',
    '<script src="&#47;&#47;other.example.test/app.js"></script>',
    '<script src="&sol;&sol;other.example.test/app.js"></script>',
    '<base href="https://other.example.test/"><script src="app.js"></script>',
    '<script src="./&period;&period;/old.js"></script>',
  ]) await assert.rejects(parseEntry(html), html)
})

test('comments and raw script text cannot become phantom module tags or assets', async () => {
  const result = await parseEntry(`<!doctype html><html><head>
    <!-- <script type=module src="old.js"></script> -->
    <!-- <link rel=modulepreload href="old.js"> -->
    <link rel=stylesheet href=./app.css>
    </head><body><script>const example = '<script type="module" src="old.js">';</script>
    <script src=./app.js></script></body></html>`)
  assert.deepEqual(result.styles, ['app.css'])
  assert.deepEqual(result.scripts.filter(script => script.src), [{ src: 'app.js' }])
  assert.equal(result.scripts.length, 2)
  const inert = await parseEntry('<script type="&Tab;module&NewLine;" src="inert.js"></script><script src="app.js"></script>')
  assert.deepEqual(inert.scripts, [{ src: 'app.js' }])
})

test('the lifecycle gate uses SDK 3 and UUID v7 identities with the actual classic SDK', async () => {
  const sdk = await readFile(new URL('../micro-vue/public/vendor/micro-sdk.js', import.meta.url), 'utf8')
  const lifecycle = `(() => {
    let client, root;
    window['delivery-fixture'] = {
      async bootstrap() {},
      async mount({ container, platform }) {
        client = window.MicroSdk.createContextClient(platform);
        root = container.querySelector('#app');
        root.textContent = client.current().user.displayName;
      },
      async update({ platform }) { client.update(platform); },
      async unmount() { client?.dispose(); if (root) root.textContent = ''; },
    };
  })();`
  await exerciseLifecycle({ appCode: 'delivery-fixture', selector: '#app' }, [{ code: sdk }, { code: lifecycle }], '.')
})
