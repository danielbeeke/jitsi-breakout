import { render, html } from 'https://cdn.skypack.dev/uhtml';
const domain = 'meet.jit.si'

declare var JitsiMeetExternalAPI: any;
const log = (...text) => console.log('LOCAL::', ...text);

class App {
  private api = null
  private peers: Map<string, RTCPeerConnection> = new Map()
  private participants: Map<string, any> = new Map()
  private channels: Map<string, RTCDataChannel> = new Map()
  private webRTCConfiguration = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}]}
  private jitsiOptions = {
    roomName: 'aasdadasdas',
    parentNode: null,
  }
  private wizardIsOpen = false
  private assignmentMode = 'auto'
  private numberOfRooms = 1
  private isInBreakout = false

  constructor () {
    this.init()
  }

  async init () {
    this.draw()
    this.jitsiOptions.parentNode = document.querySelector('.meet')
    await import(`https://thingproxy.freeboard.io/fetch/https://${domain}/external_api.js`)

    this.api = new JitsiMeetExternalAPI(domain, this.jitsiOptions);
    this.attachApiHandling()
  }

  draw () {
    const openBreakoutMenu = () => {
      this.wizardIsOpen = true
      this.draw()
    }

    render(document.querySelector('#app'), html`
      <div class="meet"></div>
      ${this.isInBreakout ? html`
      <button onclick=${() => this.return()} class="breakout-button"><img src="/close.svg" /></button>
      ` : html`
      <button onclick=${openBreakoutMenu} class="breakout-button"><img src="/icon.svg" /></button>
      `}
      
      ${this.wizardIsOpen ? this.wizardTemplate() : html``}
    `)
  }

  wizardTemplate () {
    const participants = this.api.getParticipantsInfo();

    console.log(participants)

    const setAssignmentMode = (mode) => {
      this.assignmentMode = mode
      this.draw()
    }

    const setNumberOfRooms = (event) => {
      this.numberOfRooms = parseInt(event.target.value)
      this.draw()
    }

    const submitForm = (event) => {
      const formData = new FormData(event.target);
      const assignment = {};
      formData.forEach((value, key) => {
        if (key.split(':').length > 1) {
          if (!assignment[key.split(':')[0]]) assignment[key.split(':')[0]] = {}
          assignment[key.split(':')[0]][key.split(':')[1]] = parseInt(value.toString())
        }
        else {
          assignment[key] = value
        }
      })
      this.executeBreakout(assignment)
      event.preventDefault()
    }

    return html`
    <div class="breakout-wizard">
      <form onsubmit=${submitForm}>
      <h1>Breakout rooms</h1>
      <p>Create <input type="number" name="numberOfRooms" onchange="${setNumberOfRooms}" .value=${this.numberOfRooms} min="1" max="${Math.ceil(participants.length / 2)}" /> breakout rooms</p>
      <p>Assignment mode: 
      <label><input onchange=${() => setAssignmentMode('auto')} checked=${this.assignmentMode === 'auto' ? true : null} type="radio" name="assignmentMode" value="auto"> automatic</label>
      <label><input onchange=${() => setAssignmentMode('manual')} checked=${this.assignmentMode === 'manual' ? true : null} type="radio" name="assignmentMode" value="manual"> manual</label>

      ${this.assignmentMode === 'manual' ? html`
        <ul>
        ${participants.map(participant => html`
        <li>
          ${participant.formattedDisplayName}
          <input type="number" name=${'participant:' + (participant.formattedDisplayName.includes('(me)') ? '_self' : participant.participantId)} value="1" min="1" max="${this.numberOfRooms}" />
        </li>
        `)}
        </ul>
      ` : html``}

      </p>
      <button>Execute</button>
      </form>
    </div>
    `
  }

  attachApiHandling () {
    this.api.addListener('endpointTextMessageReceived', async (message) => {
      const messageData = message.data.eventData.text
      const participantId = message.data.senderInfo.id
      const participant = this.participants.get(participantId)

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
    for (const id of this.channels.keys()) {
      this.sendById(id, message)
    }
  }

  executeBreakout (assignment) {
    this.isInBreakout = true
    for (const [id, room] of Object.entries(assignment.participant)) {
      this.sendById(id, {
        command: 'change-room',
        isBreakout: true,
        roomName: `${this.jitsiOptions.roomName}-${room}`
      })
    }

    this.wizardIsOpen = false

    this.draw()
  }

  sendById (id, message) {
    if (id === '_self') {
      this.processCommand(message)
    }
    else {
      const channel = this.channels.get(id)
      if (channel) channel.send(JSON.stringify(message))  
    }
  }

  return () {
    this.broadcast({
      command: 'change-room',
      isBreakout: false,
      roomName: this.jitsiOptions.roomName
    })
  }


  processCommand (parsedMessage) {
    if (parsedMessage.command && parsedMessage.command === 'change-room') {
      this.api.dispose()
      this.isInBreakout = parsedMessage.isBreakout
      const currentJitsiOptions = Object.assign({}, this.jitsiOptions, { roomName: parsedMessage.roomName })
      this.api = new JitsiMeetExternalAPI(domain, currentJitsiOptions);
      this.attachApiHandling()    
      this.draw()
    }
  }
}

new App()