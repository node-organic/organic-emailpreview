var jade = require('jade')
var fs = require('fs')
var path = require('path')
var async = require('async')
var R = require('ramda')
var Promise = require('bluebird')
var express = require('express')

var pathIsFull = function (value) {
  return value.indexOf('/') === 0 || value.indexOf(':\\') === 1
}

var emails = []

module.exports = function (plasma, dna) {
  this.plasma = plasma
  this.dna = dna
  this.templateCache = {}

  var app = express()
  app.set('view engine', 'ejs')
  app.get('/', function (req, res) {
    res.render(__dirname + '/view', {emails: emails})
  })

  var server = app.listen(dna.port || 3212, function () {
    var port = server.address().port
    console.log('Example app listening at http://localhost:%s', port)
  })

  var self = this
  plasma.on(dna.reactOn || 'sendEmail', function (c, next) {
    self.sendEmail(c)
      .then(function (res) { next(null, res) })
      .catch(function (err) { next(err) })
  })
}

module.exports.prototype.sendEmail = function (options) {
  var self = this

  function checkOptions (template) {
    var subject = options.subject
    options.template = template

    if (self.dna.i18next) {
      var i18n = require('i18next')
      i18n.init(self.dna.i18next)
      if (options.locale || self.dna.locale) {
        i18n.setLng(options.locale || self.dna.locale)
      }

      if (options.subject) {
        if (options.subject.key) {
          subject = i18n.t(options.subject.key, options.subject.data)
        } else {
          subject = i18n.t(options.subject)
        }
      }

      options.data = options.data || {}
      options.data.t = i18n.t
      options.subject = subject
    }

    return options
  }

  function renderTmpl (options) {
    var deferred = Promise.defer()
    if (options.template.render) {
      options.template.render(options.data, function whenRendered (err, results) {
        if (err) return deferred.reject(err)
        deferred.resolve(results.html)
      })
    } else {
      deferred.resolve(options.template(options.data))
    }

    return deferred.promise
  }

  function send (html) {
    var deferred = Promise.defer()

    var sendMailOptions = R.merge(options.sendMailOptions || {}, {
      from: options.from || self.dna.from,
      to: options.to || self.dna.to,
      subject: options.subject,
      html: html
    })

    emails.push(sendMailOptions)
    deferred.resolve(sendMailOptions)

    return deferred.promise
  }

  return this
    .loadTemplate(options)
    .then(checkOptions)
    .then(renderTmpl)
    .then(send)
}

module.exports.prototype.loadTemplate = function (options) {
  var deferred = Promise.defer()

  var locale = options.locale || this.dna.locale
  var template = this.templateCache[options.template + '-' + locale]

  if (template) {
    return Promise.resolve(template)
  }

  var root = ''
  if (this.dna.root && !pathIsFull(this.dna.root)) {
    root = path.join(process.cwd(), this.dna.root)
  } else if (this.dna.root) {
    root = this.dna.root
  }

  var localizedTemplate = path.join(root, options.template + '-' + locale + '.jade')
  var indexTemplate = path.join(root, options.template + '.jade')
  var folderTemplate = path.join(root, options.template)
  var templateTargets = [localizedTemplate, indexTemplate, folderTemplate]
  var self = this

  function isFileOrDir (filePath, cb) {
    fs.stat(filePath, function (err, stats) {
      if (err) return cb(false)

      if (stats.isFile() || stats.isDirectory()) {
        cb(stats)
      } else {
        cb(false)
      }
    })
  }

  async.detect(templateTargets, isFileOrDir, function whenExisted (fileOrDir) {
    fs.stat(fileOrDir, function whenGotStats (err, stats) {
      if (err) {
        console.error(err)
      }
      if (stats.isFile()) {
        fs.readFile(fileOrDir, function whenReadFile (err, fileData) {
          if (err) return deferred.reject(err)

          template = jade.compile(fileData, {
            filename: fileOrDir,
            debug: self.dna.debug
          })

          if (self.dna.cache) {
            self.templateCache[options.template + '-' + locale] = template
          }

          deferred.resolve(template)
        })
      } else if (stats.isDirectory()) {
        var EmailTemplate = require('email-templates').EmailTemplate

        template = new EmailTemplate(fileOrDir)

        if (self.dna.cache) {
          self.templateCache[options.template + '-' + locale] = template
        }

        deferred.resolve(template)
      } else {
        deferred.reject(new Error('couldn\'t find none of ' + templateTargets.join(' || ')))
      }
    })
  })

  return deferred.promise
}
