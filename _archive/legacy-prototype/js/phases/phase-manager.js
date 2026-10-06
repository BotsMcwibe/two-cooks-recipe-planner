/**
 * PhaseManager - Handles transitions between precook and cooking phases
 * Provides a scalable way to manage UI state and functionality across different phases
 */
class PhaseManager {
    constructor() {
        this.currentPhase = 'precook'; // 'precook' or 'cooking'
        this.listeners = [];
        this.phaseConfig = {            
            precook: {
                name: 'Förberedelsefas',
                description: 'Välj recept, konfigurera alternativ och granska ingredienser',
                allowedElements: [
                    '#scheduler-options',
                    '#process-visualization', 
                    '#base-ingredients',
                    '#main-recipe-selector',
                    '#recipe-dev',
                    '.start-cooking-btn',
                ],
                hiddenElements: [
                    '#recipe-steps',
                    '#used-base-ingredients',
                    '#completed-prepared-ingredients',
                    '#base-ingredients-left',
                    '.exit-cooking-btn',
                ]
            },            
            cooking: {
                name: 'Matlagningsfas', 
                description: 'Följ stegen och genomför receptet',
                allowedElements: [
                    '#process-visualization',
                    '#recipe-steps',
                    '#used-base-ingredients',
                    '#prepared-ingredients',
                    '#completed-prepared-ingredients',
                    '#base-ingredients-left',
                    '.exit-cooking-btn',
                ],
                hiddenElements: [
                    '#recipe-dev',
                    '#scheduler-options',
                    '#base-ingredients',
                    
                    '#main-recipe-selector',
                    '.start-cooking-btn',
                ]
            }
        };
        
        this.init();
    }

    init() {
        this.applyPhaseStyles();
        this.createPhaseControls();
        this.setPhase(this.currentPhase);
    }

    createPhaseControls() {
        // Remove existing controls if they exist
        $('.start-cooking-btn, .exit-cooking-btn').remove();
        
        if (this.currentPhase === 'precook') {
            // Create "Start Cooking" button for precook phase
            const startCookingHtml = `
                <button id="start-cooking-btn" class="start-cooking-btn">
                    <span class="cooking-icon">👨‍🍳</span>
                    Börja Laga Mat
                </button>
            `;
            
            // Insert the button in a suitable location (you may need to adjust the selector)
            $('#main-recipe-selector').after(startCookingHtml);
            
            // Bind event handler
            $('#start-cooking-btn').on('click', () => this.setPhase('cooking'));
        } else if (this.currentPhase === 'cooking') {
            // Create exit button for cooking phase
            const exitCookingHtml = `
                <button id="exit-cooking-btn" class="exit-cooking-btn">
                    ✕
                </button>
            `;
            
            // Insert at the top right of the body
            $('body').append(exitCookingHtml);
            
            // Bind event handler
            $('#exit-cooking-btn').on('click', () => this.setPhase('precook'));
        }
    }

    applyPhaseStyles() {
        // Add CSS styles for phase management
        if (!$('#phase-styles').length) {
            const styles = `
                <style id="phase-styles">
                .start-cooking-btn {
                    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
                    color: white;
                    border: none;
                    padding: 15px 30px;
                    border-radius: 8px;
                    font-size: 1.1em;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 20px auto;
                    box-shadow: 0 4px 15px rgba(255, 107, 107, 0.3);
                }

                .start-cooking-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(255, 107, 107, 0.4);
                }

                .cooking-icon {
                    font-size: 1.3em;
                }

                .exit-cooking-btn {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: rgba(0, 0, 0, 0.7);
                    color: white;
                    border: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    font-size: 1.2em;
                    font-weight: bold;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .exit-cooking-btn:hover {
                    background: rgba(0, 0, 0, 0.9);
                    transform: scale(1.1);
                }

                .phase-hidden {
                    display: none !important;
                }

                .phase-transition {
                    transition: opacity 0.3s ease-in-out;
                }

                /* Responsive design */
                @media (max-width: 600px) {
                    .start-cooking-btn {
                        margin: 15px;
                        padding: 12px 24px;
                        font-size: 1em;
                    }
                    
                    .exit-cooking-btn {
                        top: 15px;
                        right: 15px;
                        width: 35px;
                        height: 35px;
                        font-size: 1.1em;
                    }
                }
                </style>
            `;
            $('head').append(styles);
        }
    }

    setPhase(phase) {
        if (!this.phaseConfig[phase]) {
            console.error(`Unknown phase: ${phase}`);
            return;
        }

        const oldPhase = this.currentPhase;
        this.currentPhase = phase;
        
        // Update phase controls - recreate them for the new phase
        this.createPhaseControls();
        
        // Apply visibility changes with smooth transitions
        this.applyPhaseVisibility();
        
        // Notify listeners
        this.notifyListeners(phase, oldPhase);
        
        // Store phase in localStorage for persistence
        localStorage.setItem('recipeAppPhase', phase);
        
        console.log(`Phase changed from ${oldPhase} to ${phase}`);
    }

    updatePhaseControls() {
        // This method is no longer needed since we recreate controls in createPhaseControls
        // Keeping it empty for backward compatibility
    }

    applyPhaseVisibility() {
        const config = this.phaseConfig[this.currentPhase];
        
        // First, add transition class to all elements
        $('body > div, body > #scheduler-options').addClass('phase-transition');
        
        // Hide elements that should be hidden in this phase
        config.hiddenElements.forEach(selector => {
            $(selector).addClass('phase-hidden');
        });
        
        // Show elements that should be visible in this phase
        config.allowedElements.forEach(selector => {
            $(selector).removeClass('phase-hidden');
        });
        
        // Remove transition class after animation
        setTimeout(() => {
            $('body > div, body > #scheduler-options').removeClass('phase-transition');
        }, 300);
    }

    getCurrentPhase() {
        return this.currentPhase;
    }

    isPrecookPhase() {
        return this.currentPhase === 'precook';
    }

    isCookingPhase() {
        return this.currentPhase === 'cooking';
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    removeListener(callback) {
        const index = this.listeners.indexOf(callback);
        if (index > -1) {
            this.listeners.splice(index, 1);
        }
    }

    notifyListeners(newPhase, oldPhase) {
        this.listeners.forEach(callback => {
            try {
                callback(newPhase, oldPhase);
            } catch (error) {
                console.error('Error in phase change listener:', error);
            }
        });
    }

    // Method to check if an element should be visible in current phase
    isElementAllowed(selector) {
        const config = this.phaseConfig[this.currentPhase];
        return config.allowedElements.some(allowed => 
            selector === allowed || $(selector).is(allowed)
        );
    }

    // Method to restore phase from localStorage
    restorePhase() {
        const savedPhase = localStorage.getItem('recipeAppPhase');
        if (savedPhase && this.phaseConfig[savedPhase]) {
            this.setPhase(savedPhase);
        }
    }

    // Method to get phase configuration for external use
    getPhaseConfig(phase = null) {
        return phase ? this.phaseConfig[phase] : this.phaseConfig;
    }

    // Method to add custom phase configuration
    addPhaseConfig(phaseName, config) {
        this.phaseConfig[phaseName] = {
            name: config.name || phaseName,
            description: config.description || '',
            allowedElements: config.allowedElements || [],
            hiddenElements: config.hiddenElements || []
        };
    }

    // Utility methods
    debounce(func, wait) {
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

    // Cleanup method
    destroy() {
        $('.start-cooking-btn, .exit-cooking-btn').remove();
        $('#phase-styles').remove();
        $('.phase-hidden').removeClass('phase-hidden');
        $('.phase-transition').removeClass('phase-transition');
        this.listeners = [];
    }
}

// Make PhaseManager available globally
window.PhaseManager = PhaseManager;
