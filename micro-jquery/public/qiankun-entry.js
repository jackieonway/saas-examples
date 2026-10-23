// Keep this as the final classic script: qiankun discovers this lifecycle export.
;(function () {
  'use strict'

  var factory = window['legacy-jquery'] && window['legacy-jquery'].createView
  if (typeof factory !== 'function') throw new Error('qiankun entry requires app.js first')
  var view = factory()

  function platformProps(props) {
    if (!props || !props.platform) throw new Error('qiankun requires valid props.platform')
    return props.platform
  }

  // The final script exposes only qiankun's standard public lifecycle.
  window['legacy-jquery'] = {
    bootstrap: function () { return Promise.resolve() },
    mount: function (props) {
      return Promise.resolve().then(function () {
        var container = props && props.container
        var root = container && typeof container.querySelector === 'function' && container.querySelector('#app')
        if (!root) throw new Error('qiankun mount requires #app inside props.container')
        return view.render(root, platformProps(props))
      })
    },
    update: function (props) { return Promise.resolve().then(function () { return view.updateContext(platformProps(props)) }) },
    unmount: function () { return view.dispose() },
  }
})()
