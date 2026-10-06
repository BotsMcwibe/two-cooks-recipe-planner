/**
 * Timer - countdown timer attached to a step's timer row.
 * Uses Web Audio API for alarm sound.
 */
export class Timer {
  constructor($row) {
    this.$row = $row;
    this.$display = $row.find('.timer-display');
    this.originalSeconds = this._parse(this.$display.text());
    this.originalText = this.$display.text();
    this.seconds = this.originalSeconds;
    this.running = false;
    this.interval = null;
    $row.data('timerInstance', this);
  }

  _parse(str) {
    const parts = str.split(':').map(Number);
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  }

  _format(sec) {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  _updateDisplay() {
    this.$display.text(this._format(this.seconds));
    this._showReset();
  }

  _showReset() {
    const changed = this.seconds !== this.originalSeconds ||
      this.$row.find('.timer-done').length > 0;
    this.$row.find('.timer-reset').toggle(!this.running && changed);
  }

  adjustTime(delta) {
    if (this.running) return;
    if (delta < 0 && this.seconds <= 30) return;
    this.seconds = Math.max(0, this.seconds + delta);
    this._updateDisplay();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.$row.find('.timer-minus, .timer-plus').hide();
    this.$row.find('.timer-reset').hide();
    this.$row.find('.timer-done').remove();
    this.$row.find('.timer-start').text('Pausa');

    this.interval = setInterval(() => {
      if (!this.running) { clearInterval(this.interval); return; }
      if (this.seconds > 0) {
        this.seconds--;
        this._updateDisplay();
      } else {
        this._complete();
      }
    }, 1000);
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.interval);
    this.$row.find('.timer-minus, .timer-plus').show();
    this.$row.find('.timer-start').text('Starta timer');
    this._showReset();
  }

  reset() {
    if (this.running) return;
    this.seconds = this.originalSeconds;
    this.$display.text(this.originalText);
    this.running = false;
    clearInterval(this.interval);
    this.$row.find('.timer-start').text('Starta timer').show();
    this.$row.find('.timer-done, .timer-turnoff').remove();
    this.$row.find('.timer-minus, .timer-plus').show();
    this.$row.find('.timer-reset').hide();
  }

  toggle() {
    this.running ? this.pause() : this.start();
  }

  _complete() {
    clearInterval(this.interval);
    this.running = false;
    this._playAlarm();
    this.$row.find('.timer-start').hide();
    this.$display.text(this.originalText);
    this.$row.find('.timer-reset').before(
      '<span class="timer-ringing">&#9200;</span>' +
      '<button class="timer-turnoff">Stäng av</button>'
    );
  }

  turnOff() {
    this.$row.find('.timer-ringing, .timer-turnoff').remove();
    this.$row.find('.timer-reset').before('<span class="timer-done">&#10004;</span>');
    this.$row.find('.timer-reset').show();
  }

  _playAlarm() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ding = (t) => {
        [1047, 1319, 1568].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(freq, t);
          osc.type = 'sine';
          const vol = 0.15 / (i + 1);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(vol, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
          osc.start(t);
          osc.stop(t + 0.8);
        });
      };
      const now = ctx.currentTime;
      ding(now);
      ding(now + 0.6);
      ding(now + 1.2);
    } catch (e) {
      console.warn('Could not play alarm:', e);
    }
  }

  static fromRow($row) {
    let inst = $row.data('timerInstance');
    if (!inst) inst = new Timer($row);
    return inst;
  }

  static initAll($scope) {
    ($scope || $(document)).find('.timer-row').each(function () {
      if (!$(this).data('timerInstance')) new Timer($(this));
    });
  }
}
