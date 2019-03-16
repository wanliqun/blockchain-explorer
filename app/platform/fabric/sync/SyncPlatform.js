/*
    SPDX-License-Identifier: Apache-2.0
*/

const path = require('path');
const fs = require('fs-extra');
const dns = require('dns');
const net = require('net');
const util = require('util');
const dnsResolveAsync = util.promisify(dns.resolve);

const SyncService = require('../sync/SyncService');
const FabricUtils = require('../utils/FabricUtils');
const FabricEvent = require('./FabricEvent');

const helper = require('../../../common/helper');

const logger = helper.getLogger('SyncPlatform');
const ExplorerError = require('../../../common/ExplorerError');

const CRUDService = require('../../../persistence/fabric/CRUDService');
const MetricService = require('../../../persistence/fabric/MetricService');

const fabric_const = require('../utils/FabricConst').fabric.const;
const explorer_mess = require('../../../common/ExplorerMessage').explorer;

const { Producer, PushConsumer } = require('apache-rocketmq');
const rmqconfig = require('../../../../configs/rocketmq.json');

const config_path = path.resolve(
  __dirname,
  '../../../../configs/fabric/config.json'
);

class SyncPlatform {
  constructor(persistence, sender) {
    this.network_name;
    this.client_name;
    this.client;
    this.eventHub;
    this.sender = sender;
    this.persistence = persistence;
    this.syncService = new SyncService(this, this.persistence);
    this.blocksSyncTime = 60000;
    this.client_configs;
    this.dnsCache = {};
  }

  async initialize(args) {
    console.log(`Start SyncPlatform initialization...`);

    const _self = this;

    logger.debug(
      '******* SyncPlatform Initialization started for child client process %s ******',
      this.client_name
    );

    setTimeout(() => {
      console.log(
        '\n' +
          new Date().toISOString() +
          ': Timer ticks to kick off the SyncPlatform initialization'
      );
      this.initialize(args);
    }, 15 * 60 * 1000); // SynPlatform reinitialization for every 15 minutes.

    // loading the config.json
    const all_config = JSON.parse(fs.readFileSync(config_path, 'utf8'));
    const network_configs = all_config[fabric_const.NETWORK_CONFIGS];

    if (args.length == 0) {
      // get the first network and first client
      this.network_name = Object.keys(network_configs)[0];
      this.client_name = Object.keys(
        network_configs[Object.keys(network_configs)[0]].clients
      )[0];
    } else if (args.length == 1) {
      // get the first client with respect to the passed network name
      this.network_name = args[0];
      this.client_name = Object.keys(
        network_configs[this.network_name].clients
      )[0];
    } else {
      this.network_name = args[0];
      this.client_name = args[1];
    }

    console.log(
      `${explorer_mess.message.MESSAGE_1002}`,
      this.network_name,
      this.client_name
    );

    // setting the block synch interval time
    await this.setBlocksSyncTime(all_config);

    logger.debug('Blocks synch interval time >> %s', this.blocksSyncTime);
    // update the discovery-cache-life as block synch interval time in global config
    global.hfc.config.set('discovery-cache-life', this.blocksSyncTime);
    global.hfc.config.set('initialize-with-discovery', true);

    const client_configs = network_configs[this.network_name];

    this.client_configs = await FabricUtils.setOrgEnrolmentPath(client_configs);

    logger.debug('Creating fabric client...');
    this.client = await FabricUtils.createFabricClient(
      this.client_configs,
      this.client_name
    );
    if (!this.client) {
      throw new ExplorerError(explorer_mess.error.ERROR_2011);
    }
    const peer = {
      requests: this.client.getDefaultPeer().getUrl(),
      mspid: this.client_configs.organizations[
        this.client_configs.clients[this.client_name].organization
      ].mspid
    };

    const peerStatus = await this.client.getPeerStatus(peer);

    if (peerStatus.status) {
      // updating the client network and other details to DB
      console.log('Updating the client network and other details to DB...');
      const res = await this.syncService.synchNetworkConfigToDB(this.client);
      if (!res) {
        return;
      }

      // start event
      console.log('Start eventhub listenning...');
      this.eventHub = new FabricEvent(this.client, this.syncService);
      await this.eventHub.initialize();

      // setting interval for validating any missing block from the current client ledger
      // set blocksSyncTime property in platform config.json in minutes
      setInterval(() => {
        console.log(
          new Date().toISOString() +
            ': Timer ticks to validating any missing block from the current client ledger '
        );
        _self.isChannelEventHubConnected();
      }, this.blocksSyncTime);
      logger.debug(
        '******* Initialization end for child client process %s ******',
        this.client_name
      );
    } else {
      throw new ExplorerError(explorer_mess.error.ERROR_1009);
    }
  }

  async isChannelEventHubConnected() {
    for (const [channel_name, channel] of this.client.getChannels().entries()) {
      // validate channel event is connected
      const status = this.eventHub.isChannelEventHubConnected(channel_name);
      if (status) {
        console.log(
          'Channel client is connected, synchronizing channel blocks...'
        );
        await this.syncService.synchBlocks(this.client, channel);
      } else {
        // channel client is not connected then it will reconnect
        console.log('Channel client is not connected, reconnecting now...');
        this.eventHub.connectChannelEventHub(channel_name);
      }
    }
  }

  setBlocksSyncTime(blocksSyncTime) {
    if (blocksSyncTime) {
      const time = parseInt(blocksSyncTime, 10);
      if (!isNaN(time)) {
        // this.blocksSyncTime = 1 * 10 * 1000;
        // this.blocksSyncTime = time * 60 * 1000;
        this.blocksSyncTime = time * 1000; // second as unit
      }
    }
  }

  setPersistenceService() {
    // setting platfrom specific CRUDService and MetricService
    this.persistence.setMetricService(
      new MetricService(this.persistence.getPGService())
    );
    this.persistence.setCrudService(
      new CRUDService(this.persistence.getPGService())
    );
  }

  async resolveEndpoint(endpoint) {
    console.log('resolving endpoint...', endpoint);
    let [host, port] = endpoint.split(':');

    if (!net.isIP(host)) {
      console.log(
        'host is not a valid ip address',
        host,
        ', dns resolving now...'
      );
      if (this.dnsCache[host]) {
        console.log('dns cache matched', this.dnsCache[host]);
        return [this.dnsCache[host], port].join(':');
      }

      try {
        var ips = await dnsResolveAsync(host);
        this.dnsCache[host] = ips[0];
        return [ips[0], port].join(':');
      } catch (error) {
        throw new Error(error);
      }
    }

    return endpoint;
  }

  async sendRmqTxMessage(txobj) {
    console.log(
      'Produce Rocketmq message for transaction with hash',
      txobj.txhash
    );

    try {
      const instname = Math.random()
        .toString(36)
        .substring(7);
      const endpoint = await this.resolveEndpoint(rmqconfig.nameServer);
      console.log('producer instance name:', instname, ' endpoint:', endpoint);

      const producer = new Producer(rmqconfig.groupID, instname, {
        nameServer: endpoint
      });
      producer
        .start()
        .then(() => {
          const body = JSON.stringify({
            txhash: txobj.txhash,
            valid_status: txobj.validation_status,
            valid_code: txobj.validation_code
          });

          console.log('trying to send message:', body);
          producer.send(
            rmqconfig.msgTopic, // topic
            body, // message body
            { tags: rmqconfig.msgTag }, // tags
            function(err, result) {
              // callback
              if (err) {
                console.log('Rocketmq producer failed to send.', err);
              } else {
                console.log('Rocketmq producer send ok.', result);
              }

              producer
                .shutdown()
                .then(() => {
                  console.log('producer shutdown ok.');
                })
                .catch(err => {
                  console.log('producer shutdown error:', err);
                });
            }
          );
        })
        .catch(err => {
          console.log('start producer error:', err);
        });
    } catch (e) {
      console.log('Some exception happens:', e);
    }
  }

  send(notify) {
    if (this.sender) {
      this.sender.send(notify);
    }

    if (notify.notify_type === fabric_const.NOTITY_TYPE_TRANSACTION) {
      console.log('A new transaction status update notify received.');
      this.sendRmqTxMessage(notify.txobj);
    }
  }

  destroy() {
    if (this.eventHub) {
      this.eventHub.disconnectEventHubs();
    }
  }
}

module.exports = SyncPlatform;
