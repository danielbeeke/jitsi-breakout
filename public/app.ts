import { render, html } from 'https://cdn.skypack.dev/uhtml';
import { Connection } from './Connection'

class App {
  private wizardIsOpen = false
  private assignmentMode = 'auto'
  private numberOfRooms = 1
  private isInBreakout = false
  private connection

  constructor () {
    this.init()
  }

  async init () {
    this.draw()
    this.connection = new Connection(this)
    this.connection.addEventListener('command', (event: CustomEvent) => {
      const message = event.detail
      if (message.command && message.command === 'change-room') {
        this.isInBreakout = message.isInBreakout
        this.draw()
      }
    })
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
    const participants = this.connection.api.getParticipantsInfo();

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

    const cancel = () => {
      this.wizardIsOpen = false
       this.draw()
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
      <span onclick=${cancel}>Cancel</span>
      </form>
    </div>
    `
  }

  executeBreakout (assignment) {
    for (const [id, room] of Object.entries(assignment.participant)) {
      this.connection.sendById(id, {
        command: 'change-room',
        isInBreakout: true,
        roomName: `${this.connection.roomName}-${room}`
      })
    }

    this.wizardIsOpen = false

    this.draw()
  }

  return () {
    this.connection.broadcast({
      command: 'change-room',
      isInBreakout: false,
      roomName: this.connection.roomName
    })
  }

}

new App()