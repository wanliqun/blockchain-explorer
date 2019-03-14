/*
    SPDX-License-Identifier: Apache-2.0
*/
const helper = require('../../../common/helper');

const logger = helper.getLogger('FabricEvent');

class FabricEvent {
  constructor(client, fabricServices) {
    this.client = client;
    this.fabricServices = fabricServices;
    this.channelEventHubs = new Map();
  }

  async initialize() {
    // creating channel event hub
    const channels = this.client.getChannels();
    for (const [channel_name, channel] of channels.entries()) {
      this.createChannelEventHub(channel);
      logger.debug(
        'Successfully created channel event hub for  [%s]',
        channel_name
      );
    }
  }

  createChannelEventHub(channel) {
    // create channel event hub
    console.log("Creating channel eventhub")
    const eventHub = channel.newChannelEventHub(this.client.defaultPeer);
    
    console.log("Registering block event listenning for channel eventhub")
    eventHub.registerBlockEvent(
      async (block) => {
        console.log("A new block(with blockNum=" + block.header.number + ") received")

        // skip first block, it is process by peer event hub
        if (!(block.header.number === '0' || block.header.number == 0)) {
          console.log("Processing block event...")
          await this.fabricServices.processBlockEvent(this.client, block);
        }
      },
      (err) => {
        logger.error('Block Event %s', err);
      }
    );
    this.connectChannelEventHub(channel.getName(), eventHub);
    // set channel event hub to map
    this.channelEventHubs.set(channel.getName(), eventHub);
  }

  connectChannelEventHub(channel_name, eventHub) {
    const _self = this;
    if (eventHub) {
      console.log("Connecting channel eventhub...");
      eventHub.connect(true);

      setTimeout(
        (channel_name) => {
          console.log("Start synchronizing blocks for channel (with name:" + channel_name + ")");
          _self.synchChannelBlocks(channel_name);
        },
        5000,
        channel_name
      );
    } else {
      // if channel event hub is not defined then create new channel event hub
      const channel = this.client.hfc_client.getChannel(channel_name);
      this.createChannelEventHub(channel);
      return false;
    }
  }

  isChannelEventHubConnected(channel_name) {
    const eventHub = this.channelEventHubs.get(channel_name);
    if (eventHub) {
      return eventHub.isconnected();
    }
    return false;
  }

  disconnectChannelEventHub(channel_name) {
    const eventHub = this.channelEventHubs.get(channel_name);
    return eventHub.disconnec();
  }

  disconnectEventHubs() {
    // disconnect all event hubs
    for (const [channel_name, eventHub] of this.channelEventHubs.entries()) {
      const status = this.isChannelEventHubConnected();
      if (status) {
        this.disconnectChannelEventHub(channel_name);
      }
    }
  }

  // channel event hub used to synch the blocks
  async synchChannelBlocks(channel_name) {
    if (this.isChannelEventHubConnected(channel_name)) {
      const channel = this.client.hfc_client.getChannel(channel_name);
      await this.fabricServices.synchBlocks(this.client, channel);
    }
  }

  // Interval and peer event hub used to synch the blocks
  async synchBlocks() {
    // getting all channels list from client ledger
    const channels = await this.client
      .getHFC_Client()
      .queryChannels(this.client.getDefaultPeer().getName(), true);

    for (const channel of channels.channels) {
      const channel_name = channel.channel_id;
      if (!this.client.getChannels().get(channel_name)) {
        // initialize channel, if it is not exists in the client context
        await this.client.initializeNewChannel(channel_name);
        await this.fabricServices.synchNetworkConfigToDB(this.client);
      }
    }
    for (const channel of channels.channels) {
      const channel_name = channel.channel_id;
      // check channel event is connected
      if (this.isChannelEventHubConnected(channel_name)) {
        // call synch blocks
        const channel = this.client.hfc_client.getChannel(channel_name);
        await this.fabricServices.synchBlocks(this.client, channel);
      } else {
        const eventHub = this.channelEventHubs.get(channel_name);
        if (eventHub) {
          // connect channel event hub
          this.connectChannelEventHub(channel_name, eventHub);
        } else {
          const channel = this.client.getChannels().get(channel_name);
          if (channel) {
            // create channel event hub
            this.createChannelEventHub(channel);
          } else {
            // initialize channel, if it is not exists in the client context
            await this.client.initializeNewChannel(this, channel_name);
            await this.fabricServices.synchNetworkConfigToDB(this.client);
          }
        }
      }
    }
  }
}

module.exports = FabricEvent;
