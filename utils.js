var fs = require("fs")
var path = require("path")
var url = require("url")

var mkdirp = require("mkdirp")
var crypto = require("crypto")
var mime = require("mime")
var minimatch = require("minimatch")
var SvgEncoder = require("directory-encoder/lib/svg-uri-encoder.js")
var pathIsAbsolute = require("path-is-absolute")

module.exports = {
  processRebase: processRebase,
  processInline: processInline,
  processCopy: processCopy,
  getCustomProcessor: getCustomProcessor,
}

/**
 * Returns wether the given filename matches the given pattern
 * Allways returns true if the given pattern is empty
 *
 * @param {String} filename the processed filename
 * @param {String|RegExp|Function} pattern A minimatch string,
 *   regular expression or function to test the filename
 *
 * @return {Boolean}
 */
function matchesFilter(filename, pattern) {
  if (typeof pattern === "string") {
    pattern = minimatch.filter(pattern)
  }

  if (pattern instanceof RegExp) {
    return pattern.test(filename)
  }

  if (pattern instanceof Function) {
    return pattern(filename)
  }

  return true
}

/**
 * Fix url() according to source (`from`) or destination (`to`)
 *
 * @type {PostcssUrl~UrlProcessor}
 */
function processRebase(result, from, dirname, oldUrl, to) {
  var newPath = oldUrl
  if (dirname !== from) {
    newPath = path.relative(from, dirname + path.sep + newPath)
  }
  newPath = path.resolve(from, newPath)
  newPath = path.relative(to, newPath)
  if (path.sep === "\\") {
    newPath = newPath.replace(/\\/g, "\/")
  }
  return newPath
}

/**
 * Inline image in url()
 *
 * @type {PostcssUrl~UrlProcessor}
 */
function processInline(result, from, dirname, oldUrl, to, options, decl) {
  var maxSize = options.maxSize === undefined ? 14 : options.maxSize
  var fallback = options.fallback
  var basePath = options.basePath
  var filter = options.filter
  var fullFilePath

  maxSize *= 1024

  function processFallback() {
    if (typeof fallback === "function") {
      return getCustomProcessor(fallback)
      (result, from, dirname, oldUrl, to, options, decl)
    }
    switch (fallback) {
    case "copy":
      return processCopy(result, from, dirname, oldUrl, to, options, decl)
    default:
      return
    }
  }

  // ignore URLs with hashes/fragments, they can't be inlined
  var link = url.parse(oldUrl)
  if (link.hash) {
    return processFallback()
  }

  if (basePath) {
    fullFilePath = path.join(basePath, link.pathname)
  }
  else {
    fullFilePath = dirname !== from
      ? dirname + path.sep + link.pathname
      : link.pathname
  }

  var file = path.resolve(from, fullFilePath)
  if (!fs.existsSync(file)) {
    result.warn("Can't read file '" + file + "', ignoring", { node: decl })
    return
  }

  var stats = fs.statSync(file)

  if (stats.size >= maxSize) {
    return processFallback()
  }

  if (!matchesFilter(file, filter)) {
    return processFallback()
  }

  var mimeType = mime.lookup(file)

  if (!mimeType) {
    result.warn("Unable to find asset mime-type for " + file, { node: decl })
    return
  }

  if (mimeType === "image/svg+xml") {
    var svg = new SvgEncoder(file)
    return svg.encode()
  }

  // else
  file = fs.readFileSync(file)
  return "data:" + mimeType + ";base64," + file.toString("base64")
}

/**
 * Copy images from readed from url() to an specific assets destination
 * (`assetsPath`) and fix url() according to that path.
 * You can rename the assets by a hash or keep the real filename.
 *
 * Option assetsPath is require and is relative to the css destination (`to`)
 *
 * @type {PostcssUrl~UrlProcessor}
 */
function processCopy(result, from, dirname, oldUrl, to, options, decl) {
  if (from === to) {
    result.warn("Option `to` of postcss is required, ignoring", { node: decl })
    return
  }
  var relativeAssetsPath = (options && options.assetsPath)
    ? options.assetsPath
    : ""
  var absoluteAssetsPath

  var filePathUrl = path.resolve(dirname, oldUrl)
  var nameUrl = path.basename(filePathUrl)

  // remove hash or parameters in the url.
  // e.g., url('glyphicons-halflings-regular.eot?#iefix')
  var fileLink = url.parse(oldUrl)
  var filePath = path.resolve(dirname, fileLink.pathname)
  var name = path.basename(filePath)
  var useHash = options.useHash || false

  // check if the file exist in the source
  try {
    var contents = fs.readFileSync(filePath)
  }
  catch (err) {
    result.warn("Can't read file '" + filePath + "', ignoring", { node: decl })
    return
  }

  if (useHash) {

    absoluteAssetsPath = path.resolve(to, relativeAssetsPath)

    // create the destination directory if it not exist
    mkdirp.sync(absoluteAssetsPath)

    name = crypto.createHash("sha1")
      .update(contents)
      .digest("hex")
      .substr(0, 16)
    name += path.extname(filePath)
    nameUrl = name + (fileLink.search || "") + (fileLink.hash || "")
  }
  else {
    if (!pathIsAbsolute.posix(from)) {
      from = path.resolve(from)
    }
    relativeAssetsPath = path.join(
      relativeAssetsPath,
      dirname.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        + "[\/]\?"), ""),
      path.dirname(oldUrl)
    )
    absoluteAssetsPath = path.resolve(to, relativeAssetsPath)

    // create the destination directory if it not exist
    mkdirp.sync(absoluteAssetsPath)
  }

  absoluteAssetsPath = path.join(absoluteAssetsPath, name)

  // if the file don't exist in the destination, create it.
  try {
    fs.accessSync(absoluteAssetsPath)
  }
  catch (err) {
    fs.writeFileSync(absoluteAssetsPath, contents)
  }

  var assetPath = path.join(relativeAssetsPath, nameUrl)
  if (path.sep === "\\") {
    assetPath = assetPath.replace(/\\/g, "\/")
  }
  return assetPath
}

/**
 * Transform url() based on a custom callback
 *
 * @param {Function} cb callback function
 * @return {PostcssUrl~UrlProcessor}
 */
function getCustomProcessor(cb) {
  return function(result, from, dirname, oldUrl, to, options, decl) {
    return cb(oldUrl, decl, from, dirname, to, options, result)
  }
}
