class Timer {
    constructor($row) {
        this.$row = $row;
        this.$timer = $row.find('.step-timer');
        this.originalSeconds = this.parseTimer(this.$timer.text());
        this.originalString = this.$timer.text();
        this.currentSeconds = this.originalSeconds;
        this.isRunning = false;
        this.interval = null;
        
        // Store reference to this timer instance in the row data
        $row.data('timerInstance', this);
        
        this.initializeUI();
    }

    initializeUI() {
        // Store original data for reference
        this.$row.data('orig', this.originalSeconds);
        this.$row.data('origStr', this.originalString);
    }

    parseTimer(str) {
        // Format: HH:MM:SS
        const parts = str.split(':').map(Number);
        return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
    }

    formatTimer(sec) {
        const h = String(Math.floor(sec / 3600)).padStart(2, '0');
        const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    updateDisplay() {
        this.$timer.text(this.formatTimer(this.currentSeconds));
        this.showResetIfChanged();
    }

    showResetIfChanged() {
        if (this.isRunning) {
            this.$row.find('.timer-reset').hide();
        } else if (this.currentSeconds !== this.originalSeconds || 
                   this.$row.find('.timer-check').length > 0 || 
                   this.$row.find('.timer-ringing').length > 0) {
            this.$row.find('.timer-reset').show();
        } else {
            this.$row.find('.timer-reset').hide();
        }
    }    adjustTime(seconds) {
        if (this.isRunning) return;
        
        // Prevent using minus button when 30 seconds or less remaining
        if (seconds < 0 && this.currentSeconds <= 30) return;
        
        this.currentSeconds = Math.max(0, this.currentSeconds + seconds);
        this.updateDisplay();
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.$row.data('running', true);
        this.$row.find('.timer-minus, .timer-plus').hide();
        this.$row.find('.timer-reset').hide();
        this.$row.find('.timer-check').remove();
        this.$row.find('.timer-start').text('Pausa timer');

        this.interval = setInterval(() => {
            if (!this.isRunning) {
                clearInterval(this.interval);
                return;
            }

            if (this.currentSeconds > 0) {
                this.currentSeconds--;
                this.updateDisplay();
            } else {
                this.onTimerComplete();
            }
        }, 1000);
    }

    pause() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        this.$row.data('running', false);
        clearInterval(this.interval);
        this.$row.find('.timer-minus, .timer-plus').show();
        this.$row.find('.timer-start').text('Starta timer').show();
        this.$row.find('.timer-check, .timer-done-time').remove();
        this.showResetIfChanged();
    }    
    
    reset() {
        if (this.isRunning) return;
        
        this.currentSeconds = this.originalSeconds;
        this.$timer.text(this.originalString);
        this.$row.find('.timer-reset').hide();
        this.isRunning = false;
        this.$row.data('running', false);
        clearInterval(this.interval);
        this.$row.find('.timer-start').text('Starta timer').show();
        this.$row.find('.timer-check, .timer-ringing, .timer-turnoff').remove();
        this.$row.find('.timer-minus, .timer-plus').show();
        this.showResetIfChanged();
    }

    turnOff() {
        this.$row.find('.timer-ringing, .timer-turnoff').remove();
        this.$row.find('.timer-reset').before('<span class="timer-check" style="color:#22c55e;font-size:1.2em;margin-right:8px;">✔</span>');
        this.$row.find('.timer-reset').show();
        this.showResetIfChanged();
    }        onTimerComplete() {
        clearInterval(this.interval);
        this.isRunning = false;
        this.$row.data('running', false);
        
        // Play alarm sound
        this.playAlarmSound();
        
        // Show ringing timer icon and turn off button
        this.$row.find('.timer-start').hide();
        this.$timer.text(this.originalString);
        
        // Insert shaking timer icon and turn off button
        this.$row.find('.timer-reset').before('<span class="timer-ringing">⏰</span>');
        this.$row.find('.timer-reset').before('<button class="timer-turnoff">Stäng av</button>');
        
    }    playAlarmSound() {
        try {
            // Create a classic cooking timer "ding" sound using Web Audio API
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create a bell-like "ding" sound
            const createDing = (startTime) => {
                // Create multiple oscillators for a richer bell sound
                const frequencies = [1047, 1319, 1568]; // C6, E6, G6 - bell-like chord
                const decayTime = 0.8;
                
                frequencies.forEach((freq, index) => {
                    const oscillator = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    
                    oscillator.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    
                    oscillator.frequency.setValueAtTime(freq, startTime);
                    oscillator.type = 'sine';
                    
                    // Bell-like envelope: quick attack, slow decay
                    const volume = 0.15 / (index + 1); // Decreasing volume for harmonics
                    gainNode.gain.setValueAtTime(0, startTime);
                    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
                    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);
                    
                    oscillator.start(startTime);
                    oscillator.stop(startTime + decayTime);
                });
            };
            
            // Play classic "ding ding ding" pattern
            const currentTime = audioContext.currentTime;
            createDing(currentTime);           // First ding
            createDing(currentTime + 0.6);     // Second ding
            createDing(currentTime + 1.2);     // Third ding
            
        } catch (error) {
            console.warn('Could not play alarm sound:', error);
            // Fallback: try to play a system beep or notification
            try {
                // Create a simple bell-like audio with data URL
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTO82fLNeSsFJIHJ8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFA==');
                audio.play().catch(() => {
                    // If all else fails, just use console notification
                    console.log('🔔 Timer finished - Ding ding ding!');
                });
            } catch (fallbackError) {
                console.log('🔔 Timer finished - Ding ding ding!');
            }
        }
    }

    toggle() {
        if (this.isRunning) {
            this.pause();
        } else {
            this.start();
        }
    }

    // Static method to initialize all timers on the page
    static initializeAll() {
        $('.step-timer-row').each(function() {
            if (!$(this).data('timerInstance')) {
                new Timer($(this));
            }
        });
    }

    // Static method to get timer instance from a row
    static fromRow($row) {
        return $row.data('timerInstance');
    }

    // Static method to initialize timers for new elements
    static initializeNew($container) {
        $container.find('.step-timer-row').each(function() {
            if (!$(this).data('timerInstance')) {
                new Timer($(this));
            }
        });
    }

    // Static method to destroy all timers (for cleanup)
    static destroyAll() {
        $('.step-timer-row').each(function() {
            const timer = $(this).data('timerInstance');
            if (timer) {
                timer.destroy();
            }
        });
    }

    // Instance method to clean up timer
    destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        this.$row.removeData('timerInstance');
    }
}
