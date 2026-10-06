class EventManager {
    constructor() {
        this.listeners = new Map();
    }
    
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }
    
    off(event, callback) {
        if (!this.listeners.has(event)) return;
        
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    }
    
    emit(event, ...args) {
        if (!this.listeners.has(event)) return;
        
        this.listeners.get(event).forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }
    
    once(event, callback) {
        const onceCallback = (...args) => {
            callback(...args);
            this.off(event, onceCallback);
        };
        this.on(event, onceCallback);
    }
}

class StateManager {
    constructor() {
        this.state = {};
        this.eventManager = new EventManager();
    }
    
    setState(key, value) {
        const oldValue = this.state[key];
        this.state[key] = value;
        this.eventManager.emit('stateChange', key, value, oldValue);
        this.eventManager.emit(`stateChange:${key}`, value, oldValue);
    }
    
    getState(key) {
        return this.state[key];
    }
    
    getAllState() {
        return { ...this.state };
    }
    
    on(event, callback) {
        this.eventManager.on(event, callback);
    }
    
    off(event, callback) {
        this.eventManager.off(event, callback);
    }
    
    emit(event, ...args) {
        this.eventManager.emit(event, ...args);
    }
}

class UtilityFunctions {
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    static throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }
    
    static generateId() {
        return Math.random().toString(36).substr(2, 9);
    }
}

window.EventManager = EventManager;
window.StateManager = StateManager;
window.UtilityFunctions = UtilityFunctions;
