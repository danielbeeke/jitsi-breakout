// docs/app.js
import {render, html} from "https://cdn.skypack.dev/uhtml";

// docs/helpers.js
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}

// docs/Connection.js
var pathSplit = location.pathname.split("/");
var domain = pathSplit[1];
var log = (...text) => console.log("LOCAL::", ...text);
var Connection = class extends EventTarget {
  constructor(app) {
    super();
    this.api = null;
    this.peers = new Map();
    this.participants = new Map();
    this.channels = new Map();
    this.webRTCConfiguration = {iceServers: [{urls: "stun:stun.l.google.com:19302"}]};
    this.roomName = pathSplit[2];
    this.domain = pathSplit[1];
    this.app = app;
    if (this.domain)
      this.init();
  }
  async init() {
    this.element = document.querySelector(".meet");
    try {
      await import(`https://thingproxy.freeboard.io/fetch/https://${domain}/external_api.js`);
    } catch (exception) {
    }
    this.guid = uuidv4();
    this.api = new JitsiMeetExternalAPI(domain, {
      parentNode: this.element,
      roomName: this.roomName
    });
    this.attachApiHandling();
    this.addEventListener("command", (event) => {
      const message = event.detail;
      if (message.command && message.command === "change-room") {
        this.api.dispose();
        this.api = new JitsiMeetExternalAPI(domain, {
          parentNode: this.element,
          roomName: message.roomName
        });
        this.attachApiHandling();
      }
    });
  }
  attachApiHandling() {
    this.api.addListener("endpointTextMessageReceived", async (message) => {
      const messageData = message.data.eventData.text;
      const participantId = message.data.senderInfo.id;
      const participant = this.participants.get(participantId);
      if (messageData.guid && !participant.guid)
        participant.guid = messageData.guid;
      try {
        if (messageData.offer) {
          if (messageData.time > participant.time) {
            const connection = new RTCPeerConnection(this.webRTCConfiguration);
            this.peers.set(participantId, connection);
            connection.addEventListener("datachannel", ({channel}) => {
              this.channels.set(participant.id, channel);
              this.attachChannelHandling(channel, participant.id);
            });
            this.attachIceHandling(connection, participant.id);
            connection.setRemoteDescription(new RTCSessionDescription(messageData.offer));
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            this.api.executeCommand("sendEndpointTextMessage", participant.id, {answer});
          }
        }
        if (messageData.answer) {
          const connection = this.peers.get(participant.id);
          const remoteDescription = new RTCSessionDescription(messageData.answer);
          await connection.setRemoteDescription(remoteDescription);
        }
        if (messageData.candidate) {
          const connection = this.peers.get(participant.id);
          if (connection)
            await connection.addIceCandidate(messageData.candidate);
        }
      } catch (exception) {
        log(exception);
      }
    });
    this.api.addListener("outgoingMessage", (message) => {
    });
    this.api.addListener("participantJoined", (participant) => {
      const time = Date.now();
      if (!this.participants.has(participant.id)) {
        this.participants.set(participant.id, {...participant, time});
        setTimeout(async () => {
          if (!this.peers.has(participant.id)) {
            const connection = new RTCPeerConnection(this.webRTCConfiguration);
            this.peers.set(participant.id, connection);
            const channel = connection.createDataChannel("jitsi-breakout");
            this.attachChannelHandling(channel, participant.id);
            this.channels.set(participant.id, channel);
            this.attachIceHandling(connection, participant.id);
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            this.api.executeCommand("sendEndpointTextMessage", participant.id, {offer, time});
          }
        }, 1500);
      }
    });
  }
  attachIceHandling(connection, participantId) {
    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.api.executeCommand("sendEndpointTextMessage", participantId, {candidate: event.candidate});
      } else {
        log("done");
      }
    });
  }
  attachChannelHandling(channel, participantId) {
    channel.onmessage = (message) => {
      const parsedMessage = JSON.parse(message.data);
      this.processCommand(parsedMessage);
      log(message.data);
    };
    channel.onclose = () => log("closed");
    channel.onerror = (error) => log(error);
  }
  broadcast(message) {
    for (const id of [...this.channels.keys(), "_self"]) {
      this.sendById(id, message);
    }
  }
  sendById(id, message) {
    if (id === "_self") {
      this.processCommand(message);
    } else {
      const channel = this.channels.get(id);
      message.guid = this.guid;
      if (channel)
        channel.send(JSON.stringify(message));
    }
  }
  processCommand(parsedMessage) {
    this.dispatchEvent(new CustomEvent("command", {detail: parsedMessage}));
  }
};

// docs/app.js
var App = class {
  constructor() {
    this.wizardIsOpen = false;
    this.assignmentMode = "auto";
    this.numberOfRooms = 1;
    this.isInBreakout = false;
    this.domain = "meet.jit.si";
    this.roomName = "";
    this.init();
  }
  async init() {
    this.draw();
    this.connection = new Connection(this);
    this.draw();
    this.connection.addEventListener("command", (event) => {
      const message = event.detail;
      if (message.command && message.command === "change-room") {
        this.isInBreakout = message.isInBreakout;
        this.draw();
      }
    });
  }
  draw() {
    var _a;
    const openBreakoutMenu = () => {
      this.wizardIsOpen = true;
      this.draw();
    };
    const redirect = () => {
      window.location.href = `/${this.domain}/${this.roomName}`;
    };
    render(document.querySelector("#app"), html`
      ${!((_a = this.connection) == null ? void 0 : _a.domain) ? html`
      <label>Jitsi domain:</label><input onchange=${(event) => this.domain = event.target.value} .value=${this.domain}><br>
      <label>Room name:</label><input onchange=${(event) => this.roomName = event.target.value} .value=${this.roomName}>
      <button onclick=${redirect}>Go</button>
      ` : html`
      ${this.isInBreakout ? html`
      <button onclick=${() => this.return()} class="breakout-button"><img src="/close.svg" /></button>
      ` : html`
      <button onclick=${openBreakoutMenu} class="breakout-button"><img src="/icon.svg" /></button>
    `}
    
    ${this.wizardIsOpen ? this.wizardTemplate() : html``}
    `}
    <div class="meet"></div>
    `);
  }
  wizardTemplate() {
    const participants = this.connection.api.getParticipantsInfo();
    const setAssignmentMode = (mode) => {
      this.assignmentMode = mode;
      this.draw();
    };
    const setNumberOfRooms = (event) => {
      this.numberOfRooms = parseInt(event.target.value);
      this.draw();
    };
    const submitForm = (event) => {
      const formData = new FormData(event.target);
      const assignment = {};
      formData.forEach((value, key) => {
        if (key.split(":").length > 1) {
          if (!assignment[key.split(":")[0]])
            assignment[key.split(":")[0]] = {};
          assignment[key.split(":")[0]][key.split(":")[1]] = parseInt(value.toString());
        } else {
          assignment[key] = value;
        }
      });
      this.executeBreakout(assignment);
      event.preventDefault();
    };
    const cancel = () => {
      this.wizardIsOpen = false;
      this.draw();
    };
    return html`
    <div class="breakout-wizard">
      <form onsubmit=${submitForm}>
      <h1>Breakout rooms</h1>
      <p>Create <input type="number" name="numberOfRooms" onchange="${setNumberOfRooms}" .value=${this.numberOfRooms} min="1" max="${Math.ceil(participants.length / 2)}" /> breakout rooms</p>
      <p>Assignment mode: 
      <label><input onchange=${() => setAssignmentMode("auto")} checked=${this.assignmentMode === "auto" ? true : null} type="radio" name="assignmentMode" value="auto"> automatic</label>
      <label><input onchange=${() => setAssignmentMode("manual")} checked=${this.assignmentMode === "manual" ? true : null} type="radio" name="assignmentMode" value="manual"> manual</label>

      ${this.assignmentMode === "manual" ? html`
        <ul>
        ${participants.map((participant) => html`
        <li>
          ${participant.formattedDisplayName}
          <input type="number" name=${"participant:" + (participant.formattedDisplayName.includes("(me)") ? "_self" : participant.participantId)} value="1" min="1" max="${this.numberOfRooms}" />
        </li>
        `)}
        </ul>
      ` : html``}

      </p>
      <button>Execute</button>
      <span onclick=${cancel}>Cancel</span>
      </form>
    </div>
    `;
  }
  executeBreakout(assignment) {
    for (const [id, room] of Object.entries(assignment.participant)) {
      this.connection.sendById(id, {
        command: "change-room",
        isInBreakout: true,
        roomName: `${this.connection.roomName}-${room}`
      });
    }
    this.wizardIsOpen = false;
    this.draw();
  }
  return() {
    this.connection.broadcast({
      command: "change-room",
      isInBreakout: false,
      roomName: this.connection.roomName
    });
  }
};
new App();
//# sourceMappingURL=//.//app.js.map
