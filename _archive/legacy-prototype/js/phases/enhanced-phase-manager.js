class EnhancedPhaseManager extends PhaseManager {
    constructor() {
        super();
        this.stateManager = new StateManager();
        this.eventManager = new EventManager();
        this.setupEnhancements();
    }
    
    setupEnhancements() {
        this.addSmartTransitionLogic();
        this.addVisualEnhancements();
        this.addKeyboardShortcuts();
        this.addErrorHandling();
        this.addAccessibility();
        this.addPerformanceOptimizations();
    }
    
    addSmartTransitionLogic() {
        let transitionTimer;
        
        const checkForAutoTransition = () => {
            clearTimeout(transitionTimer);
            transitionTimer = setTimeout(() => {
                if (this.currentPhase === 'precook') {
                    const hasRecipeSelected = this.stateManager.getState('selectedId');
                    // ProcessVisualizer renders divs with .process-chart, not a canvas
                    const hasViewedChart = $('#process-visualization .process-chart').length > 0;
                    
                    if (hasRecipeSelected && hasViewedChart) {
                        this.suggestCookingTransition();
                    }
                }
            }, 2000);
        };
        
        $('#main-recipe-select, #prep-first-toggle, #cooks-toggle').on('change', checkForAutoTransition);
    }
    
    suggestCookingTransition() {
        if (this.currentPhase !== 'precook' || $('.transition-suggestion').length > 0) return;
        
        const suggestion = this.createTransitionSuggestion();
        $('body').append(suggestion);
        this.bindTransitionSuggestionEvents(suggestion);
        this.autoRemoveTransitionSuggestion(suggestion);
    }
    
    createTransitionSuggestion() {
        return $(`
            <div class="transition-suggestion" style="
                position: fixed;
                top: 20px;
                right: 20px;
                background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
                color: white;
                padding: 15px 20px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(72, 187, 120, 0.3);
                z-index: 1000;
                animation: slideInRight 0.3s ease-out;
                cursor: pointer;
                max-width: 300px;
            ">
                <div style="font-weight: 600; margin-bottom: 5px;">Redo att börja laga mat? 👨‍🍳</div>
                <div style="font-size: 0.9em; opacity: 0.9;">Klicka här för att gå till matlagningsfasen</div>
                <div style="position: absolute; top: 5px; right: 8px; font-size: 1.2em; opacity: 0.7;">×</div>
            </div>
        `);
    }
    
    bindTransitionSuggestionEvents(suggestion) {
        suggestion.on('click', (e) => {
            if ($(e.target).text() === '×') {
                this.removeTransitionSuggestion(suggestion);
            } else {
                this.setPhase('cooking');
                this.removeTransitionSuggestion(suggestion);
            }
        });
    }
    
    removeTransitionSuggestion(suggestion) {
        suggestion.css('animation', 'slideOutRight 0.3s ease-in');
        setTimeout(() => suggestion.remove(), 300);
    }
    
    autoRemoveTransitionSuggestion(suggestion) {
        setTimeout(() => {
            if (suggestion.length) {
                this.removeTransitionSuggestion(suggestion);
            }
        }, 10000);
    }
    
    addVisualEnhancements() {
        this.addListener((newPhase, oldPhase) => {
            $('body').addClass('phase-transitioning');
            this.showPhaseChangeIndicator(newPhase, oldPhase);
            
            setTimeout(() => {
                $('body').removeClass('phase-transitioning');
            }, 500);
            
            document.title = `Recipe App - ${this.phaseConfig[newPhase].name}`;
        });
        
        this.ensureAnimationStyles();
    }
    
    ensureAnimationStyles() {
        if (!$('#transition-animations').length) {
            $('head').append(`
                <style id="transition-animations">
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes slideOutRight {
                        from { transform: translateX(0); opacity: 1; }
                        to { transform: translateX(100%); opacity: 0; }
                    }
                    @keyframes phaseChangePopIn {
                        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
                        50% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
                        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                    }
                    .phase-transitioning {
                        overflow: hidden;
                    }
                    .phase-transitioning .phase-transition {
                        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                    }
                </style>
            `);
        }
    }
      showPhaseChangeIndicator(newPhase, oldPhase) {
        const phaseNames = {
            'precook': { name: 'Förberedelsefas', icon: '📋', color: '#ff6b6b' },
            'cooking': { name: 'Matlagningsfas', icon: '👨‍🍳', color: '#48bb78' }
        };
        
        const indicator = $(`
            <div class="phase-change-indicator" style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: ${phaseNames[newPhase].color};
                color: white;
                padding: 20px 30px;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                z-index: 9999;
                text-align: center;
                animation: phaseChangePopIn 0.5s ease-out;
                font-size: 1.1em;
                font-weight: 600;
            ">
                <div style="font-size: 2em; margin-bottom: 8px;">${phaseNames[newPhase].icon}</div>
                <div>${phaseNames[newPhase].name}</div>
            </div>
        `);
        
        $('body').append(indicator);
        
        setTimeout(() => {
            indicator.fadeOut(300, () => indicator.remove());
        }, 1500);
    }
    
    addKeyboardShortcuts() {
        const shortcuts = {
            '1': () => this.setPhase('precook'),
            '2': () => this.setPhase('cooking'),
            'Tab': () => {
                const nextPhase = this.currentPhase === 'precook' ? 'cooking' : 'precook';
                this.setPhase(nextPhase);
            }
        };
        
        $(document).on('keydown', (e) => {
            if ($(e.target).is('input, textarea, select')) return;
            
            const action = shortcuts[e.key];
            if (action && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                action();
            }
        });
        
        this.addKeyboardShortcutHints();
    }
    
    addKeyboardShortcutHints() {
        $('#phase-precook-btn').attr('title', 'Förberedelsefas (Ctrl+1)');
        $('#phase-cooking-btn').attr('title', 'Matlagningsfas (Ctrl+2)');
        
        if (!$('.keyboard-shortcuts-help').length) {
            $('.phase-controls').append(`
                <div class="keyboard-shortcuts-help" style="
                    text-align: center;
                    margin-top: 10px;
                    font-size: 0.8em;
                    opacity: 0.7;
                ">
                    Tangentbordsgenvag: Ctrl+1 (Förberedelse) | Ctrl+2 (Matlagning) | Ctrl+Tab (Växla)
                </div>
            `);
        }
    }
    
    addErrorHandling() {
        window.addEventListener('error', (event) => {
            console.error('Phase Manager Error:', event.error);
            if (this.currentPhase) {
                this.setPhase('precook');
            }
        });

        const originalSetPhase = this.setPhase.bind(this);
        this.setPhase = function(phase) {
            try {
                return originalSetPhase(phase);
            } catch (error) {
                console.error('Error setting phase:', error);
                $('.phase-hidden').removeClass('phase-hidden');
                return false;
            }
        };
    }
    
    addAccessibility() {
        $('.phase-btn').attr('role', 'tab');
        $('.phase-controls').attr('role', 'tabpanel');
        
        $('.phase-btn').on('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(e.target).click();
            }
        });
        
        this.addListener((newPhase) => {
            const announcement = $(`<div aria-live="polite" class="sr-only">${this.phaseConfig[newPhase].name} är nu aktiv</div>`);
            $('body').append(announcement);
            setTimeout(() => announcement.remove(), 3000);
        });
    }
    
    addPerformanceOptimizations() {
        this.debouncedUpdateUI = UtilityFunctions.debounce(() => {
            this.eventManager.emit('updateUI');
        }, 100);
    }
}

window.EnhancedPhaseManager = EnhancedPhaseManager;
