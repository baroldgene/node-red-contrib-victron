module.exports = function (RED) {
  const debug = require('debug')('node-red-contrib-victron:victron-client')
  const utils = require('../services/utils.js')

  const migrateSubscriptions = (x) => {
    const services = x.client.client.services
    for (const key in services) {
      if (services[key].name === x.service) {
        x.deviceInstance = services[key].deviceInstance
        break
      }
    }
    if (typeof x.deviceInstance !== 'undefined' && x.deviceInstance.toString().match(/^\d+$/)) {
      const dbusInterface = x.service.split('.').splice(0, 3).join('.') + ('/' + x.deviceInstance).replace(/\/$/, '')
      // var dbusInterface = x.service
      const newsub = dbusInterface + ':' + x.path
      const oldsub = x.service + ':' + x.path
      if (x.client.subscriptions[oldsub]) {
        debug(`Migrating subscription from ${oldsub} to ${newsub} (please update your flow)`)
        x.client.subscriptions[oldsub][0].dbusInterface = dbusInterface
        if (newsub in x.client.subscriptions) {
          x.client.subscriptions[newsub].push(x.client.subscriptions[oldsub][0])
        } else {
          x.client.subscriptions[newsub] = x.client.subscriptions[oldsub]
        }
        delete x.client.subscriptions[oldsub]
        delete x.client.system.cache[x.service.split('.').splice(0, 3).join('.')]
        x.client.onStatusUpdate({ service: x.service }, utils.STATUS.SERVICE_MIGRATE)
      }
    } else {
      if (typeof x.deviceInstance !== 'undefined') { debug(`Failed to migrate service ${x.service}`) }
    }
  }

  class BaseInputNode {
    constructor (nodeDefinition) {
      RED.nodes.createNode(this, nodeDefinition)

      this.node = this

      this.service = nodeDefinition.service
      this.path = nodeDefinition.path
      this.pathObj = nodeDefinition.pathObj
      this.defaulttopic = nodeDefinition.serviceObj.name + ' - ' + nodeDefinition.pathObj.name
      this.onlyChanges = nodeDefinition.onlyChanges
      this.roundValues = nodeDefinition.roundValues
      this.sentInitialValue = false

      this.configNode = RED.nodes.getNode('victron-client-id')
      this.client = this.configNode.client

      this.subscription = null

      const handlerId = this.configNode.addStatusListener(this, this.service, this.path)

      if (this.service && this.path) {
        // The following is for migration purposes
        if (!this.service.match(/\/\d+$/)) {
          this.deviceInstance = this.service.replace(/^.*\.(\d+)$/, '$1')
          this.service = this.service.replace(/\.\d+$/, '')
          this.client.client.getValue(this.service, '/DeviceInstance')
          setTimeout(migrateSubscriptions, 1000, this)
        }

        this.subscription = this.client.subscribe(this.service, this.path, (msg) => {
          let topic = this.defaulttopic
          if (this.node.name) {
            topic = this.node.name
          }
          if (this.node.onlyChanges && !msg.changed && this.sentInitialValue) {
            return
          }
          if ((Number(this.node.roundValues) >= 0) && (typeof (msg.value) === 'number')) {
            msg.value = +msg.value.toFixed(this.node.roundValues)
          }
          if (this.node.onlyChanges && this.node.previousvalue === msg.value) {
            return
          }
          if (this.configNode && (this.configNode.contextStore || typeof this.configNode.contextStore === 'undefined')) {
            const globalContext = this.node.context().global
            const v = `${this.service}${this.path}`.replace(/\//g, '.').replace(/com\.victronenergy\.(.+?)\.(\d+)\.(\w+)/, 'victronenergy.$1._$2.$3')
            globalContext.set(v, msg.value)
          }
          this.node.previousvalue = msg.value
          const outmsg = {
            payload: msg.value,
            topic
          }
          let text = msg.value
          if (this.node.pathObj.type === 'enum') {
            outmsg.textvalue = this.node.pathObj.enum[msg.value] || ''
            text = `${msg.value} (${this.node.pathObj.enum[msg.value]})`
          }
          this.node.send(outmsg)
          if (this.configNode && (this.configNode.showValues || typeof this.configNode.showValues === 'undefined')) {
            this.node.status({ fill: 'green', shape: 'dot', text })
          }
          if (!this.sentInitialValue) {
            this.sentInitialValue = true
          }
        })
      }

      this.on('close', function (done) {
        this.node.client.unsubscribe(this.node.subscription)
        this.node.configNode.removeStatusListener(handlerId)
        this.sentInitialValue = false
        done()
      })
    }
  }

  class BaseOutputNode {
    constructor (nodeDefinition) {
      RED.nodes.createNode(this, nodeDefinition)

      this.node = this

      this.pathObj = nodeDefinition.pathObj
      this.service = nodeDefinition.service
      this.path = nodeDefinition.path
      this.initialValue = nodeDefinition.initial

      this.configNode = RED.nodes.getNode('victron-client-id')
      this.client = this.configNode.client

      const handlerId = this.configNode.addStatusListener(this, this.service, this.path)

      const setValue = (value, path) => {
        let writepath = this.path
        let shape = 'dot'
        if (path && path !== this.path) {
          writepath = path
          shape = 'ring'
        }
        if (!/^\/.*/.test(writepath)) {
          writepath = '/' + writepath
        }
        if (!this.pathObj.disabled && this.service && writepath) {
          this.client.publish(this.service, writepath, value)
          let text = value
          if (this.pathObj.type === 'enum') {
            text = `${value} (${this.pathObj.enum[value]})`
          }
          if (this.configNode && this.configNode.showValues) {
            this.node.status({ fill: 'green', shape, text })
          }
        }
      }

      if (this.initialValue) { setValue(parseInt(this.initialValue)) }

      this.on('input', function (msg) {
        setValue(msg.payload, msg.path)
      })

      this.on('close', function (done) {
        this.node.configNode.removeStatusListener(handlerId)
        done()
      })
    }
  }

  // Input nodes
  RED.nodes.registerType('baroldgene-input-accharger', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-acload', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-alternator', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-battery', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-custom', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-dcdc', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-dcload', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-dcsource', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-dcsystem', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-digitalinput', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-ess', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-evcharger', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-fuelcell', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-generator', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-genset', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-gps', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-gridmeter', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-inverter', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-meteo', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-motordrive', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-multi', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-pulsemeter', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-pump', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-pvinverter', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-relay', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-settings', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-solarcharger', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-system', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-tank', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-temperature', BaseInputNode)
  RED.nodes.registerType('baroldgene-input-vebus', BaseInputNode)

  // Output nodes
  RED.nodes.registerType('baroldgene-output-accharger', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-battery', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-charger', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-custom', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-dcdc', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-ess', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-evcharger', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-generator', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-inverter', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-multi', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-pump', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-pvinverter', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-relay', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-settings', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-solarcharger', BaseOutputNode)
  RED.nodes.registerType('baroldgene-output-vebus', BaseOutputNode)
}
