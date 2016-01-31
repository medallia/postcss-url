/**
 * Module dependencies.
 */
var path = require("path")

var utils = require("./utils")
var postcss = require("postcss")
/**
 * @typedef UrlRegExp
 * @name UrlRegExp
 * @desc A regex for match url with parentheses:
 *   (before url)(the url)(after url).
 *    (the url) will be replace with new url, and before and after will remain
 * @type RegExp
 */
/**
 * @type {UrlRegExp[]}
 */
var UrlsPatterns = [
  /(url\(\s*['"]?)([^"')]+)(["']?\s*\))/g,
  /(AlphaImageLoader\(\s*src=['"]?)([^"')]+)(["'])/g,
]

/**
 * Fix url() according to source (`from`) or destination (`to`)
 *
 * @param {Object} options plugin options
 * @return {void}
 */
module.exports = postcss.plugin(
  "postcss-url",
  function fixUrl(options) {
    options = options || {}
    var mode = options.url !== undefined ? options.url : "rebase"
    var isCustom = typeof mode === "function"
    var callback = isCustom ?
      utils.getCustomProcessor(mode) : getUrlProcessor(mode)

    return function(styles, result) {
      var from = result.opts.from
        ? path.dirname(result.opts.from)
        : "."
      var to = result.opts.to
        ? path.dirname(result.opts.to)
        : from

      var cb = getDeclProcessor(result, from, to, callback, options, isCustom)

      styles.walkDecls(cb)
    }
  }
)

/**
 * @callback PostcssUrl~UrlProcessor
 * @param {String} from from
 * @param {String} dirname to dirname
 * @param {String} oldUrl url
 * @param {String} to destination
 * @param {Object} options plugin options
 * @param {Object} decl postcss declaration
 * @return {String|undefined} new url or undefined if url is old
 */

/**
 * @param {String} mode
 * @returns {PostcssUrl~UrlProcessor}
 */
function getUrlProcessor(mode) {
  switch (mode) {
  case "rebase":
    return utils.processRebase
  case "inline":
    return utils.processInline
  case "copy":
    return utils.processCopy
  default:
    throw new Error("Unknow mode for postcss-url: " + mode)
  }
}

/**
 * @callback PostcssUrl~DeclProcessor
 * @param {Object} decl declaration
 */

/**
 * @param {Object} result
 * @param {String} from from
 * @param {String} to destination
 * @param {PostcssUrl~UrlProcessor} callback
 * @param {Object} options
 * @param {Boolean} [isCustom]
 * @returns {PostcssUrl~DeclProcessor}
 */
function getDeclProcessor(result, from, to, cb, options, isCustom) {
  var valueCallback = function(decl, oldUrl) {
    var dirname = decl.source && decl.source.input
      ? path.dirname(decl.source.input.file)
      : process.cwd()

    var newUrl

    if (isCustom || !isUrlShouldBeIgnored(oldUrl)) {
      newUrl = cb(result, from, dirname, oldUrl, to, options, decl)
    }

    return newUrl || oldUrl
  }

  return function(decl) {
    UrlsPatterns.some(function(pattern) {
      if (pattern.test(decl.value)) {
        decl.value = decl.value
          .replace(pattern, function(_, beforeUrl, oldUrl, afterUrl) {
            return beforeUrl + valueCallback(decl, oldUrl) + afterUrl
          })

        return true
      }
    })
  }
}

/**
 * Check if url is absolute, hash or data-uri
 * @param {String} url
 * @returns {boolean}
 */
function isUrlShouldBeIgnored(url) {
  return url[0] === "/" ||
    url[0] === "#" ||
    url.indexOf("data:") === 0 ||
    /^[a-z]+:\/\//.test(url)
}
