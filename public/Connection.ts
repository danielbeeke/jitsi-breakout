import { uuidv4 } from './helpers'
const pathSplit = location.pathname.split('/')
const domain = pathSplit[1]
declare var JitsiMeetExternalAPI: any;
const log = (...text) => console.log('LOCAL::', ...text);

export class Connection extends EventTarget {
  public api = null
  private peers: Map<string, RTCPeerConnection> = new Map()
  private participants: Map<string, any> = new Map()
  private channels: Map<string, RTCDataChannel> = new Map()
  private webRTCConfiguration = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]}
  private roomName = pathSplit[2]
  private domain = pathSplit[1]
  private guid: string
  private app
  private element: HTMLDivElement

  constructor (app) {
    super()
    this.app = app
    if (this.domain) this.init()
  }

  async init () {
    this.element = document.querySelector('.meet')

    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = `//${domain}/external_api.js`
    script.onload = () => {
      this.guid = uuidv4()
      this.api = new JitsiMeetExternalAPI(domain, {
        parentNode: this.element,
        roomName: this.roomName
      });
      this.attachApiHandling()  
    }
    
    document.getElementsByTagName('head')[0].appendChild(script);

    this.addEventListener('command', (event: CustomEvent) => {
      const message = event.detail
      if (message.command && message.command === 'change-room') {
        this.api.dispose()
        this.api = new JitsiMeetExternalAPI(domain, {
          parentNode: this.element,
          roomName: message.roomName
        });
        this.attachApiHandling()    
      }
    })
  }

  attachApiHandling () {
    this.api.addListener('endpointTextMessageReceived', async (message) => {
      const messageData = message.data.eventData.text
      const participantId = message.data.senderInfo.id
      const participant = this.participants.get(participantId)
      if (messageData.guid && !participant.guid) participant.guid = messageData.guid

      try {
        /**
         * Offer
         */
        if (messageData.offer) {
          if (messageData.time > participant.time) {
            const connection = new RTCPeerConnection(this.webRTCConfiguration);
            this.peers.set(participantId, connection)
            connection.addEventListener('datachannel', ({ channel }) => {
              this.channels.set(participant.id, channel)
              this.attachChannelHandling(channel, participant.id)
            })
            this.attachIceHandling(connection, participant.id)
            connection.setRemoteDescription(new RTCSessionDescription(messageData.offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            this.api.executeCommand('sendEndpointTextMessage', participant.id, { answer }); 
          }
        }
  
        /**
         * Answer
         */
        if (messageData.answer) {
          const connection = this.peers.get(participant.id)
          const remoteDescription = new RTCSessionDescription(messageData.answer)
          await connection.setRemoteDescription(remoteDescription)
        }
  
        /**
         * Candidate
         */
        if (messageData.candidate) {
          const connection = this.peers.get(participant.id)
          if (connection) await connection.addIceCandidate(messageData.candidate);
        }
      }
      catch (exception) {
        log(exception)
      }
    })

    this.api.addListener('outgoingMessage', (message) => {
      // log(message)
    })

    this.api.addListener('participantJoined', (participant) => {
      const time = Date.now()

      if (!this.participants.has(participant.id)) {
        this.participants.set(participant.id, {...participant, time })
        setTimeout(async () => {
          if (!this.peers.has(participant.id)) {
            const connection = new RTCPeerConnection(this.webRTCConfiguration);
            this.peers.set(participant.id, connection)
            const channel = connection.createDataChannel('jitsi-breakout');
            this.attachChannelHandling(channel, participant.id)
            this.channels.set(participant.id, channel)
            this.attachIceHandling(connection, participant.id)
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            this.api.executeCommand('sendEndpointTextMessage', participant.id, { offer, time }); 
          }
        }, 1500);  
      }
    })
  }

  attachIceHandling (connection, participantId) {
    connection.addEventListener('icecandidate', event => {
      if (event.candidate) {
        this.api.executeCommand('sendEndpointTextMessage', participantId, { candidate: event.candidate }); 
      }
      else {
        log('done')
      }
    });
  }

  attachChannelHandling (channel, participantId) {
    channel.onmessage = (message) => {
      const parsedMessage = JSON.parse(message.data)
      this.processCommand(parsedMessage)
      log(message.data)
    }

    channel.onclose = () => log('closed')
    channel.onerror = (error) => log(error)
  }

  broadcast (message) {
    for (const id of [...this.channels.keys(), '_self']) {
      this.sendById(id, message)
    }
  }

  sendById (id, message) {
    if (id === '_self') {
      this.processCommand(message)
    }
    else {
      const channel = this.channels.get(id)
      message.guid = this.guid
      if (channel) channel.send(JSON.stringify(message))  
    }
  }

  processCommand (parsedMessage) {
    this.dispatchEvent(new CustomEvent('command', { detail: parsedMessage }))
  }
}
