// --- UI rendering ---
// This is not a module, so we use an IIFE to avoid polluting the global namespace
(function() {
function getMainRecipes(recipes) {
    const inputIds = new Set(recipes.flatMap(r => r.inputs.map(i => i.ingredient.id)));
    return recipes.filter(r => !inputIds.has(r.outputIngredient.id));
}

// Helper to stringify a step, replacing ingredient objects with their name
function stringifyStep(step) {
    if (Array.isArray(step)) {
        let str = '';
        for (let i = 0; i < step.length; i++) {
            let part = step[i];
            let text;
            if (part && typeof part === 'object') {
                if (part.type === 'ingredient' && part.ingredient && part.ingredient.json && part.ingredient.json.name) {
                    text = `<strong>${part.ingredient.json.name}</strong>`;
                } else if (part.name) {
                    text = `<strong>${part.name}</strong>`;
                } else {
                    text = JSON.stringify(part);
                }
            } else {
                text = part;
            }
            // If next part is a comma, don't add space
            if (i < step.length - 1 && step[i + 1] === ',') {
                str += text;
            } else {
                str += text + ' ';
            }
        }
        return str.trim();
    }
    return step;
}

function renderIngredient(ingredient, amount, unit) {
    return `<li>${ingredient.name} - ${amount} ${unit.abbreviation}</li>`;
}

function renderRecipeNode(node) {
    if (node.ingredient) return renderIngredient(node.ingredient, node.amount, node.unit);
    let html = `<li><strong>${node.recipe.name}</strong>`;
    if (node.recipe.duration) {
        html += ` <span class="duration">(${node.recipe.duration} min)</span>`;
    }
    if (node.inputs?.length) {
        html += '<ul>' + node.inputs.map(renderRecipeNode).join('') + '</ul>';
    }
    html += '</li>';
    return html;
}

function displayIngredientTree(tree, containerId) {
    $("#" + containerId).html(`<h3>Ingrediensträd</h3><ul>${renderRecipeNode(tree)}</ul>`);
}

function renderBaseIngredients(ingredients, containerId, requiredAmounts = {}, usedAmounts = {}, requiredUnits = {}, portionControls = null) {
    let html = '<div class="ingredients-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">';
    html += '<h3 style="margin: 0;">Ingredienser</h3>';
    
    if (portionControls) {
        html += `<div class="portion-controls" style="display:inline-flex;align-items:center;gap:10px;">
            <button id="portion-minus" class="portion-btn" ${portionControls.currentPortions <= 2 ? 'disabled' : ''}>−</button>
            <span id="portion-display" class="portion-display">${portionControls.currentPortions} portioner</span>
            <button id="portion-plus" class="portion-btn" ${portionControls.currentPortions >= 24 ? 'disabled' : ''}>+</button>
        </div>`;
    }
    
    html += '</div>';
    
    if (portionControls) {
        html += `<div id="scaling-indicator" style="display:none;"></div>`;
        
        // Show info box if portions are not 4 and user has interacted
        const showInfoBox = portionControls.currentPortions !== 4 && portionControls.showInfoBox;
        html += `<div id="portion-info-box" class="portion-info-box" style="display:${showInfoBox ? 'block' : 'none'};">
            <div class="info-content">
                ℹ️ När du ändrar antalet portioner kan du behöva justera receptet. 
                Exempelvis kryddning, tillagningstid eller vätskemängd. Smaka av en extra gång 
                och var lite mer uppmärksam på spisen eller ugnen.
            </div>
        </div>`;
    }
    
    html += '<ul class="zebra-ingredients">';
    let any = false;
    for (const ing of ingredients) {
        const total = requiredAmounts[ing.id] || 0;
        const unitAbbr = requiredUnits[ing.id] || '';
        if (total > 0) {
            const formatted = formatNiceAmount(total, unitAbbr);
            html += `<li><span class="ingredient-amount">${formatted}</span><span class="ingredient-name">${ing.name}</span></li>`;
            any = true;
        }
    }
    if (!any) html += '<li><span class="ingredient-amount"></span><span class="ingredient-name">None</span></li>';
    html += '</ul>';
    
    $("#" + containerId).html(html);
}

// Helper to format amounts with fractions for small/count units
function formatNiceAmount(amount, unitAbbr) {
    const tiny = ['nypa','skvätt','klick','tsk','msk'];
    const isCount = unitAbbr === 'st' || unitAbbr === 'pkt' || unitAbbr === 'burk' || unitAbbr === 'kruka' || unitAbbr === 'huvud' || unitAbbr === 'skiva';
    let rounded = amount;
    if (tiny.includes(unitAbbr) || isCount) {
        rounded = Math.round(amount * 2) / 2;
    } else if (amount >= 10) {
        rounded = Math.round(amount);
    } else if (amount >= 1) {
        rounded = Math.round(amount * 10) / 10;
    } else {
        rounded = Math.round(amount * 100) / 100;
    }
    const toFraction = (val) => {
        if (Math.abs(val - Math.floor(val) - 0.5) < 1e-9) {
            return `${Math.floor(val)}½`.replace(/^0/, '½');
        }
        return `${val}`;
    };
    const disp = (tiny.includes(unitAbbr) || isCount) ? toFraction(rounded) : `${rounded}`;
    return `${disp} ${unitAbbr}`.trim();
}
function renderUsedBaseIngredients(ingredients, containerId, usedAmounts = {}, usedUnits = {}) {
    let html = '<h3>Förbrukade Ingredienser</h3><ul class="zebra-ingredients">';
    let anyUsed = false;
    for (const ing of ingredients) {
        const used = usedAmounts[ing.id] || 0;
        const unit = usedUnits[ing.id] || '';
        if (used > 0) {
            anyUsed = true;
            html += `<li><span class="ingredient-amount">${used} ${unit}</span><span class="ingredient-name">${ing.name}</span></li>`;
        }
    }
    if (!anyUsed) html += '<li><span class="ingredient-amount"></span><span class="ingredient-name"></span></li>';
    html += '</ul>';
    $("#" + containerId).html(html);
}

function renderBaseIngredientsLeft(ingredients, containerId, requiredAmounts = {}, usedAmounts = {}, requiredUnits = {}) {
    let html = '<h3>Ingredienser Kvar</h3><ul class="zebra-ingredients">';
    let anyLeft = false;
    for (const ing of ingredients) {
        const total = requiredAmounts[ing.id] || 0;
        const used = usedAmounts[ing.id] || 0;
        const remaining = Math.max(total - used, 0);
        const unit = requiredUnits[ing.id] || '';
        if (remaining > 0) {
            anyLeft = true;
            html += `<li><span class="ingredient-amount">${remaining} ${unit}</span><span class="ingredient-name">${ing.name}</span></li>`;
        }
    }
    if (!anyLeft) html += '<li><span class="ingredient-amount"></span><span class="ingredient-name"></span></li>';
    html += '</ul>';
    $("#" + containerId).html(html);
}

function renderPreparedIngredientTree(recipes, checkedIds, onChange, completedSteps = {}, onStepChange) {
    const allOutputIds = recipes.map(r => r.outputIngredient.id);
    const inputIds = recipes.flatMap(r => r.inputs.map(i => i.ingredient.id));
    // Only recipes whose output is not used as input elsewhere are roots
    const rootRecipeIds = allOutputIds.filter(id => !inputIds.includes(id));
    const roots = recipes.filter(r => rootRecipeIds.includes(r.outputIngredient.id));

    function isRecipeCheckable(recipe) {
        // All input ingredients (base or prepared) must be checked if they are produced by a recipe
        return recipe.inputs.every(input => {
            const isPrepared = recipes.some(r => r.outputIngredient.id === input.ingredient.id);
            if (isPrepared) {
                return checkedIds.includes(input.ingredient.id);
            } else {
                // For base ingredients, always allow (or optionally, could require a separate check)
                return true;
            }        });
    }

    function renderRecipeNode(recipe) {
        const id = recipe.outputIngredient.id;
        const checked = checkedIds.includes(id) ? 'checked' : '';
        const recipeCheckable = isRecipeCheckable(recipe);
        const disabled = recipeCheckable ? '' : 'disabled';
        // Output in parentheses, recipe name in bold
        let html = `<li><label><input type="checkbox" data-id="${id}" ${checked} ${disabled}> <strong>${recipe.name}</strong> (<span>${recipe.outputIngredient.name}</span>)`;
        if (recipe.duration) {
            html += ` <span class=\"duration\">(${recipe.duration} min)</span>`;
        }
        html += '</label>';
        // Steps rendering
        if (recipe.steps && recipe.steps.length) {
            // Step checkboxes are only enabled if the recipe is checkable
            const stepDisabled = recipeCheckable ? '' : 'disabled';
            html += '<ul>' + recipe.steps.map((step, idx) => {
                const stepKey = id + ':' + idx;
                const stepChecked = completedSteps[stepKey] ? 'checked' : '';
                return `<li><label><input type="checkbox" class="step-checkbox" data-recipe="${id}" data-step="${idx}" ${stepChecked} ${stepDisabled}>${stringifyStep(step)}</label></li>`;
            }).join('') + '</ul>';
        }
        // Subrecipes
        const subRecipes = recipe.inputs
            .map(input => recipes.find(r => r.outputIngredient.id === input.ingredient.id))
            .filter(Boolean);
        if (subRecipes.length) {
            html += '<ul>' + subRecipes.map(renderRecipeNode).join('') + '</ul>';
        }
        html += '</li>';
        return html;
    }

    return '<h3>Recipe tree debug</h3><ul>' + roots.map(renderRecipeNode).join('') + '</ul>';
}

function mountPreparedIngredientTree(recipes, checkedIds, containerId, onChange, completedSteps = {}, onStepChange) {
    const $c = $("#" + containerId);
    $c.html(renderPreparedIngredientTree(recipes, checkedIds, onChange, completedSteps, onStepChange));
    $c.find('input[type="checkbox"]').off('change').on('change', function () {
        if ($(this).hasClass('step-checkbox')) {
            const recipeId = $(this).attr('data-recipe');
            const stepIdx = $(this).attr('data-step');
            onStepChange(recipeId, stepIdx, this.checked);
        } else {
            const recipeId = $(this).attr('data-id');
            onChange(recipeId, this.checked);
        }
    });
}

function renderCompletedPreparedIngredients(preparedIngredients, checkedIds, recipes, containerId) {

    const usedAsInput = new Set();
    for (const rid of checkedIds) {
        const recipe = recipes.find(r => r.outputIngredient.id === rid);
        if (recipe) {
            for (const input of recipe.inputs) {
                if (checkedIds.includes(input.ingredient.id)) usedAsInput.add(input.ingredient.id);
            }
        }
    }
    let html = '<h3>Skapade Ingredienser</h3><ul class="zebra-ingredients">';
    for (const ing of preparedIngredients) {
        if (checkedIds.includes(ing.id) && !usedAsInput.has(ing.id)) {
            // Find the recipe that produces this ingredient
            const recipe = recipes.find(r => r.outputIngredient.id === ing.id);
            // Try to get the unit from the recipe's output or fallback to empty string
            // Avoid showing a misleading amount; keep layout with empty amount span
            html += `<li><span class="ingredient-amount"></span><span class="ingredient-name">${ing.name}</span></li>`;
        }
    }
    html += '</ul>';
    $("#" + containerId).html(html);
}

function getBaseIngredients(ingredients, recipes) {
    const outputIds = recipes.map(r => r.outputIngredient.id);
    return ingredients.filter(ing => !outputIds.includes(ing.id));
}

function getPreparedIngredients(ingredients, recipes) {
    // Return the outputIngredient of each recipe in recipes
    return recipes.map(r => r.outputIngredient);
}

function getCheckedBaseIngredientTotals(recipes, checkedPreparedIds) {
    const amounts = {};
    const units = {};
    for (const rid of checkedPreparedIds) {
        const recipe = recipes.find(r => r.outputIngredient.id === rid);
        if (recipe) {
            for (const input of recipe.inputs) {
                if (!recipes.some(r => r.outputIngredient.id === input.ingredient.id)) {
                    amounts[input.ingredient.id] = (amounts[input.ingredient.id] || 0) + input.amount;
                    units[input.ingredient.id] = input.unit.abbreviation;
                }
            }
        }
    }
    return {amounts, units};
}

/**
 * Renders a schedule computed by Scheduler into the DOM.
 */
class ProcessVisualizer {
    /**
     * @param {Scheduler} scheduler
     */
    constructor(scheduler) {
        this.scheduler = scheduler;
    }

    /**
     * @param {string} containerId
     */
    render(containerId) {
        const { nodes, rows, totalTime, maxThreads, threads } = this.scheduler.getSchedule();
        const $container = $("#" + containerId);
        const rowHeight = 40;
        const $chart = $("<div>").addClass("process-chart").css({
            position: "relative",
            height: `${rows.length * rowHeight}px`
        });
        const THRESHOLD_PCT = 2;

        // Calculate prep completion time if prep-first is enabled
        let prepCompletionTime = null;
        if (this.scheduler.config.prepFirst) {
            prepCompletionTime = this.calculatePrepCompletionTime(nodes);
        }

        nodes.forEach(node => {
            const leftPct   = (node.start       / totalTime) * 100;
            const activePct = (node.activeDuration / totalTime) * 100;
            const totalPct  = (node.totalDuration   / totalTime) * 100;
            const waitPct   = totalPct - activePct;
            
            // Determine cook assignment class
            let cookClass = '';
            if (node.assignedCook) {
                cookClass = node.assignedCook === 'P1' ? 'cook-p1' : 'cook-p2';
            }
            
            const $wrapper = $("<div>")
                .addClass(`process-bar-wrapper ${cookClass}`)
                .css({
                    position: "absolute",
                    left:    `${leftPct}%`,
                    top:     `${node.row * rowHeight}px`,
                    width:   `${totalPct}%`,
                    height:  `${rowHeight}px`
                });

            $("<div>")
                .addClass(`process-bar active ${cookClass}`)
                .css({ width: `${(activePct / totalPct) * 100}%` })
                .appendTo($wrapper);

            if (waitPct >= THRESHOLD_PCT) {
                $("<div>")
                    .addClass("process-bar wait")
                    .css({
                        position: "absolute",
                        left:    `${(activePct / totalPct) * 100}%`,
                        width:   `${(waitPct / totalPct) * 100}%`,
                        height:  "100%"
                    })
                    .attr("title", `${node.recipe.name}: wait ${waitPct.toFixed(2)} min`)
                    .appendTo($wrapper);
            }

            // Title (include cook assignment if present)
            const titleText = node.assignedCook ? 
                `${node.assignedCook}: ${node.recipe.name}` : 
                node.recipe.name;
                
            $("<span>")
                .addClass("process-bar-label process-bar-title")
                .text(titleText)
                .css({
                    position:  "absolute",
                    top:       "-9px",
                    left:      "8px",
                    width:     "100%",
                    'font-size':'14px',
                    'font-weight':'bold',
                    color:     '#fff',
                    'text-shadow':'0 0 2px rgba(0,0,0,0.7)'
                })
                .appendTo($wrapper);

            // Duration
            $("<span>")
                .addClass("process-bar-label process-bar-duration")
                .text(
                    waitPct >= THRESHOLD_PCT
                        ? `${node.activeDuration} + ${node.totalDuration - node.activeDuration} min`
                        : `${node.activeDuration} min`
                )
                .css({
                    position:  "absolute",
                    top:       "9px",
                    left:      "8px",
                    width:     "100%",
                    'font-size':'0.9em',
                    color:     '#fff',
                    'text-shadow':'0 0 2px rgba(0,0,0,0.7)'
                })
                .appendTo($wrapper);

            $chart.append($wrapper);
        });

        // Add prep completion line if prep-first is enabled
        if (prepCompletionTime !== null && prepCompletionTime > 0) {
            this.addPrepCompletionLine($chart, prepCompletionTime, totalTime, rows.length * rowHeight);
        }
        
        // Always add total cooking time line
        this.addTotalCookingTimeLine($chart, totalTime, rows.length * rowHeight);

        // Time axis
        const $axis = $("<div>").addClass("process-time-axis").css({
            position:   "relative",
            height:     "30px",
            'margin-top':'4px',
            width:      '100%'
        });
        const tickInterval = 5;
        const tickCount = Math.floor(totalTime / tickInterval);

        for (let i = 0; i <= tickCount; i++) {
            const t = Math.round(i * tickInterval);
            const left = (t / totalTime) * 100;
            $("<div>").addClass("process-time-tick").css({
                position: "absolute",
                left:     `${left}%`,
                top:      0,
                height:   "10px",
                width:    "1px",
                'background-color':'#888',
                'z-index': 1
            }).appendTo($axis);

            $("<div>").addClass("process-time-label").css({
                position:  "absolute",
                left:      `calc(${left}% + 10px)`,
                top:       "16px",
                transform: "translateX(-50%)",
                'font-size':'12px',
                color:     '#333',
                'z-index': 2
            }).text(`${t} min`).appendTo($axis);
        }

        if (totalTime % tickInterval !== 0) {
            const left = 100;
            const t = Math.round(totalTime);
            $("<div>").addClass("process-time-tick").css({
                position: "absolute",
                left:     `${left}%`,
                top:      "-4px",
                height:   "16px",
                width:    "1px",
                'background-color':'#888',
                'z-index': 1
            }).appendTo($axis);

            $("<div>").addClass("process-time-label").css({
                position:  "absolute",
                left:      `calc(${left}% + 10px)`,
                top:       "16px",
                transform: "translateX(-50%)",
                'font-size':'12px',
                color:     '#333',
                'z-index': 2
            }).text(`${t} min`).appendTo($axis);
        }

        // Update title to include prep and cooking time if available
        let title = `Flödesdiagram - ${threads > 1 ? threads + ' kockar' : '1 kock'}`;
        if (prepCompletionTime !== null && prepCompletionTime > 0) {
            const cookingTime = Math.round(totalTime - prepCompletionTime);
            title += ` • Förberedelser: ${Math.round(prepCompletionTime)} min • Tillagning: ${cookingTime} min`;
        }

        $container.empty().append(
            $(`<h3>${title}</h3>`),
            $chart,
            $axis
        );
    }

    /**
     * Calculate when all prep work is completed
     */
    calculatePrepCompletionTime(nodes) {
        let maxPrepEndTime = 0;
        
        nodes.forEach(node => {
            // Check if this is a prep recipe or has prep activities
            const isPrep = node.recipe.hasTag && node.recipe.hasTag('prep');
            const hasEarlySteps = this.hasEarlyPrepSteps(node.recipe);
            
            if (isPrep || hasEarlySteps) {
                const prepEndTime = node.start + node.activeDuration;
                maxPrepEndTime = Math.max(maxPrepEndTime, prepEndTime);
            }
        });
        
        return maxPrepEndTime;
    }

    /**
     * Check if a recipe has early prep steps (cutting, chopping, etc.)
     */
    hasEarlyPrepSteps(recipe) {
        if (!recipe.steps) return false;
        
        return recipe.steps.some(step => {
            const stepText = (typeof step === 'string' ? step : step.text || '').toLowerCase();
            return stepText.includes('skär') || 
                   stepText.includes('hacka') || 
                   stepText.includes('skala') || 
                   stepText.includes('rensa') ||
                   stepText.includes('marinera') ||
                   stepText.includes('mät') ||
                   stepText.includes('väg');
        });
    }

    /**
     * Add a vertical line showing when prep is completed
     */
    addPrepCompletionLine($chart, prepCompletionTime, totalTime, chartHeight) {
        const leftPct = (prepCompletionTime / totalTime) * 100;
        
        // Add the vertical line
        const $prepLine = $("<div>")
            .addClass("prep-completion-line")
            .css({
                position: "absolute",
                left: `${leftPct}%`,
                top: 0,
                width: "2px",
                height: `${chartHeight}px`,
                'background-color': '#22c55e',
                'z-index': 10,
                'box-shadow': '0 0 4px rgba(34, 197, 94, 0.5)'
            });

        // Add a label for the line
        const $prepLabel = $("<div>")
            .addClass("prep-completion-label")
            .text(`Förb. klar (${Math.round(prepCompletionTime)} min)`)
            .css({
                position: "absolute",
                left: `${leftPct}%`,
                top: `${chartHeight + 5}px`, // Below the chart
                transform: "translateX(-50%)",
                'background-color': '#22c55e',
                color: 'white',
                padding: "2px 8px",
                'border-radius': "4px",
                'font-size': '11px',
                'font-weight': 'bold',
                'z-index': 11,
                'white-space': 'nowrap',
                'box-shadow': '0 2px 4px rgba(0,0,0,0.1)'
            });

        $chart.append($prepLine);
        $chart.append($prepLabel);
    }

    /**
     * Add a vertical line showing total cooking time at the end of the timeline
     */
    addTotalCookingTimeLine($chart, totalTime, chartHeight) {        
        // Add the vertical line at the end of the timeline (100%)
        const $cookingLine = $("<div>")
            .addClass("total-cooking-time-line")
            .css({
                position: "absolute",
                left: "100%", // At the end of the timeline
                top: 0,
                width: "2px",
                height: `${chartHeight}px`,
                'background-color': '#f59e0b',
                'z-index': 9,
                'box-shadow': '0 0 4px rgba(245, 158, 11, 0.5)',
                'border-left': '1px dashed rgba(245, 158, 11, 0.7)',
                transform: "translateX(-2px)" // Adjust to align properly at the edge
            });

        // Add a label for the total cooking time
        const $cookingLabel = $("<div>")
            .addClass("total-cooking-time-label")
            .text(`Total tid (${Math.round(totalTime)} min)`)
            .css({
                position: "absolute",
                left: "100%",
                top: `${chartHeight + 5}px`, // Below the chart
                transform: "translateX(-50%)",
                'background-color': '#f59e0b',
                color: 'white',
                padding: "2px 8px",
                'border-radius': "4px",
                'font-size': '11px',
                'font-weight': 'bold',
                'z-index': 10,
                'white-space': 'nowrap',
                'box-shadow': '0 2px 4px rgba(0,0,0,0.1)'
            });

        $chart.append($cookingLine);
        $chart.append($cookingLabel);
    }
}

/**
 * Generates an ordered step list based on the Gantt chart schedule
 */
function generateOrderedStepList(scheduler, checkedPreparedIds, completedSteps, onStepChange) {
    const { nodes } = scheduler.getSchedule();
    
    // Sort nodes by their start time to get the correct execution order
    const sortedNodes = [...nodes].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        // If start times are equal, prioritize prep tasks
        const aPrep = a.recipe.hasTag && a.recipe.hasTag("prep");
        const bPrep = b.recipe.hasTag && b.recipe.hasTag("prep");
        if (aPrep !== bPrep) return bPrep - aPrep;
        return 0;
    });
    
    const allSteps = [];
    let globalStepIndex = 0;
      sortedNodes.forEach(node => {
        const recipe = node.recipe;
        
        // Check if all input ingredients are available
        const areInputsAvailable = recipe.inputs.every(input => {
            // Check if it's a base ingredient (not produced by any recipe)
            const isBaseIngredient = !nodes.some(n => n.recipe.outputIngredient.id === input.ingredient.id);
            if (isBaseIngredient) {
                return true; // Base ingredients are always available
            }
            // Check if the required prepared ingredient is completed
            const isCompleted = checkedPreparedIds.includes(input.ingredient.id);
            return isCompleted;
        });
        
        // Add each step of this recipe
        recipe.steps.forEach((step, stepIndex) => {
            const stepKey = recipe.outputIngredient.id + ':' + stepIndex;
            const isCompleted = completedSteps[stepKey] || false;
            
            // Additional check: if this is not the first step of a recipe,
            // check if all previous steps of the same recipe are completed
            const isPreviousStepsCompleted = stepIndex === 0 || 
                Array.from({ length: stepIndex }, (_, i) => i).every(i => {
                    const prevStepKey = recipe.outputIngredient.id + ':' + i;
                    return completedSteps[prevStepKey];
                });
            
            const canComplete = areInputsAvailable && isPreviousStepsCompleted;
              allSteps.push({
                globalIndex: globalStepIndex++,
                recipeId: recipe.outputIngredient.id,
                recipeName: recipe.name,
                stepIndex: stepIndex,
                stepKey: stepKey,
                step: step,
                isCompleted: isCompleted,
                areInputsAvailable: canComplete,
                scheduledStart: node.start,
                duration: recipe.duration,
                wait: recipe.wait || 0,
                hasTimer: recipe.wait > 0,
                totalSteps: recipe.steps.length
            });
        });
    });
    
    return allSteps;
}

/**
 * Renders the ordered step list in the "Gör så här" section
 */
function renderOrderedStepList(scheduler, checkedPreparedIds, completedSteps, containerId, onStepChange) {
    const steps = generateOrderedStepList(scheduler, checkedPreparedIds, completedSteps, onStepChange);
    
    let html = '<h3>Gör så här</h3><ul id="steps-list">';
    
    // Group steps by recipe to create shared containers
    let currentRecipeId = null;
    
    // Determine the first actionable (enabled and incomplete) step to mark as current
    const firstCurrentIndex = steps.findIndex(s => !s.isCompleted && s.areInputsAvailable);

    steps.forEach((stepData, index) => {
        const { globalIndex, recipeId, recipeName, stepIndex, stepKey, step, isCompleted, areInputsAvailable, hasTimer, totalSteps } = stepData;
        
        // Get the recipe data to access inputs and outputs
        const { nodes } = scheduler.getSchedule();
        const node = nodes.find(n => n.recipe.outputIngredient.id === recipeId);
        const recipe = node ? node.recipe : null;
        
        // Determine if step should be disabled
    const isDisabled = !areInputsAvailable;
        const disabledAttr = isDisabled ? 'disabled' : '';
        const disabledClass = isDisabled ? 'disabled' : '';
        const checkedAttr = isCompleted ? 'checked' : '';
    const isCurrent = index === firstCurrentIndex && !isCompleted && !isDisabled;
    const currentClass = isCurrent ? 'current-step' : '';
        
        // Check if we're starting a new recipe group
        const isNewRecipe = currentRecipeId !== recipeId;
        if (isNewRecipe) {
            // Close previous recipe container if exists
            if (currentRecipeId !== null) {
                html += `</div></li>`; // Close previous recipe container
            }
            
            currentRecipeId = recipeId;
            
            // Start new recipe container
            html += `<li class="recipe-group ${disabledClass}" data-recipe="${recipeId}">`;
            
            // Add recipe header with inputs and outputs
            if (recipe) {
                html += `<div class="step-recipe-header">`;
                html += `<div class="step-recipe-title">${recipeName}</div>`;
                
                // Show inputs if any
                if (recipe.inputs && recipe.inputs.length > 0) {
                    html += `<div class="step-inputs">`;
                    html += `<span class="step-inputs-label">Behöver:</span>`;
                    html += `<ul class="step-ingredient-list">`;
                    recipe.inputs.forEach(input => {
                        const unit = input.unit ? input.unit.abbreviation : '';
                        const unitDisplay = unit ? ` ${unit}` : '';
                        html += `<li class="step-ingredient-item">`;
                        html += `<span class="step-ingredient-amount">${input.amount}${unitDisplay}</span>`;
                        html += `<span class="step-ingredient-name">${input.ingredient.name}</span>`;
                        html += `</li>`;
                    });
                    html += `</ul></div>`;
                }
                
                // Show output
                if (recipe.outputIngredient) {
                    html += `<div class="step-output">`;
                    html += `<span class="step-output-label">Skapar:</span>`;
                    html += `<span class="step-output-name">${recipe.outputIngredient.name}</span>`;
                    html += `</div>`;
                }
                
                html += `</div>`;
            }
            
            // Start steps container
            html += `<div class="recipe-steps-container">`;
        }
        
        // Add individual step within the recipe container
    html += `<div class="step-item ${disabledClass} ${currentClass}" data-recipe="${recipeId}" data-step="${stepIndex}">`;
        html += `<div class="step-description-row">`;
        html += `<input type="checkbox" class="step-checkbox" data-recipe="${recipeId}" data-step="${stepIndex}" ${checkedAttr} ${disabledAttr}>`;
        
        // Render the step content (no recipe context needed since it's grouped)
        html += `<span class="step-desc">${stringifyStep(step)}</span>`;        
        html += `</div>`;
          // Add timer only if this recipe has a wait duration, this is the last step, and recipe doesn't have no-timer tag
        const showTimer = hasTimer && stepIndex === totalSteps - 1 && !(recipe && recipe.hasTag && recipe.hasTag('no-timer'));
        if (showTimer) {
            // Use the recipe's wait duration
            const totalMinutes = Math.floor(stepData.wait);
            const seconds = Math.floor((stepData.wait - totalMinutes) * 60);
            const timerDuration = `00:${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
            html += `<div class="step-timer-row">`;
            html += `<button class="timer-minus">-</button>`;
            html += `<span class="step-timer">${timerDuration}</span>`;
            html += `<button class="timer-plus">+</button>`;
            html += `<button class="timer-start">Starta timer</button>`;
            html += `<button class="timer-reset" style="display:none;">Återställ timer</button>`;
            html += `<button class="timer-turnoff" style="display:none;">Stäng av timer</button>`;
            html += `</div>`;
        }
        
        html += `</div>`; // Close step-item
    });
    
    // Close the last recipe container
    if (currentRecipeId !== null) {
        html += `</div></li>`;
    }
    
    html += '</ul>';    $("#" + containerId).html(html);

    // Auto-scroll to current step if present
    if (firstCurrentIndex >= 0) {
        const $current = $(`#${containerId} .step-item.current-step`).first();
        if ($current.length) {
            const top = $current.offset().top - 140;
            $('html, body').stop(true).animate({ scrollTop: Math.max(top, 0) }, 250);
        }
    }

    // Initialize timer instances for any new timer rows
    Timer.initializeNew($("#" + containerId));

    // Attach event handlers for step checkboxes
    $(`#${containerId} .step-checkbox`).off('change').on('change', function() {
        if (!$(this).prop('disabled')) {
            const recipeId = $(this).attr('data-recipe');
            const stepIndex = $(this).attr('data-step');
            onStepChange(recipeId, stepIndex, this.checked);
        }
    });

    // Make the entire step item clickable (except timer buttons)
    $(`#${containerId} .step-item`).off('click').on('click', function(e) {
        // Don't trigger if clicking on timer buttons or if step is disabled
        if ($(e.target).closest('.step-timer-row button').length > 0 || $(this).hasClass('disabled')) {
            return;
        }
        
        // Don't trigger if clicking directly on the checkbox (it handles itself)
        if ($(e.target).is('.step-checkbox')) {
            return;
        }
        
        // Toggle the checkbox
        const checkbox = $(this).find('.step-checkbox');
        if (checkbox.length > 0 && !checkbox.prop('disabled')) {
            checkbox.prop('checked', !checkbox.prop('checked')).trigger('change');
        }
    });
}

/**
 * Checks if all steps of a recipe are completed
 */
function areAllStepsCompleted(recipeId, recipe, completedSteps) {
    return recipe.steps.every((_, stepIndex) => {
        const stepKey = recipeId + ':' + stepIndex;
        return completedSteps[stepKey];
    });
}

/**
 * Enhanced step change handler that automatically checks recipe boxes in the tree
 */
function createEnhancedStepChangeHandler(subtree, checkedPreparedIds, completedSteps, updateUICallback, recipeChangeHandler) {
    // Create a debounced version of the update function to prevent rapid calls
    const debouncedUpdate = debounce(updateUICallback, 50);
    
    // Track which checkbox initiated the change to prevent infinite loops
    let isUpdating = false;
      return (recipeId, stepIndex, isChecked) => {
        // Prevent infinite loops
        if (isUpdating) {
            return;
        }
        
        isUpdating = true;
        
        try {
            const stepKey = recipeId + ':' + stepIndex;
              // Update the step completion status
            if (isChecked) {
                completedSteps[stepKey] = true;
            } else {
                delete completedSteps[stepKey];
            }
            
            // Update the corresponding step checkbox in the debug tree
            const debugStepCheckbox = $(`#prepared-ingredients .step-checkbox[data-recipe="${recipeId}"][data-step="${stepIndex}"]`);
            if (debugStepCheckbox.length > 0 && debugStepCheckbox.prop('checked') !== isChecked) {
                debugStepCheckbox.prop('checked', isChecked);
            }
            
            // Update the corresponding step checkbox in the main steps list
            const mainStepCheckbox = $(`#recipe-steps .step-checkbox[data-recipe="${recipeId}"][data-step="${stepIndex}"]`);
            if (mainStepCheckbox.length > 0 && mainStepCheckbox.prop('checked') !== isChecked) {
                mainStepCheckbox.prop('checked', isChecked);            }
            
            // Find the recipe
            const recipe = subtree.find(r => r.outputIngredient.id === recipeId);
            if (!recipe) {
                console.warn(`Recipe not found: ${recipeId}`);
                updateUICallback();
                return;
            }
              // Check if all steps of this recipe are now completed
            const allStepsCompleted = areAllStepsCompleted(recipeId, recipe, completedSteps);
            
            // Check current state in the data array (not DOM)
            const isCurrentlyInArray = checkedPreparedIds.includes(recipeId);
            
            // Determine if we need to change the recipe state
            let shouldChangeRecipe = false;
            let newRecipeState = false;
              if (allStepsCompleted && !isCurrentlyInArray) {
                shouldChangeRecipe = true;
                newRecipeState = true;
            } else if (!allStepsCompleted && isCurrentlyInArray) {
                shouldChangeRecipe = true;
                newRecipeState = false;
            }
            
            if (shouldChangeRecipe) {
                // Update the data array first
                if (newRecipeState) {
                    if (!checkedPreparedIds.includes(recipeId)) {
                        checkedPreparedIds.push(recipeId);
                    }
                } else {
                    const index = checkedPreparedIds.indexOf(recipeId);
                    if (index > -1) {
                        checkedPreparedIds.splice(index, 1);
                    }
                }
                  // Update the checkbox to match the data
                const recipeCheckbox = $(`#prepared-ingredients input[data-id="${recipeId}"]`);
                if (recipeCheckbox.length > 0) {
                    recipeCheckbox.prop('checked', newRecipeState);
                }
            }
            
            // Run consistency check to fix any state issues
            ensureStateConsistency(subtree, checkedPreparedIds, completedSteps);
              // Always update the UI (debounced)
            debouncedUpdate();
        } finally {
            isUpdating = false;
        }
    };
}

/**
 * Ensures state consistency between step completion and recipe completion
 */
function ensureStateConsistency(subtree, checkedPreparedIds, completedSteps) {
    subtree.forEach(recipe => {
        const recipeId = recipe.outputIngredient.id;
        const allStepsCompleted = areAllStepsCompleted(recipeId, recipe, completedSteps);
        const isInCheckedArray = checkedPreparedIds.includes(recipeId);
        
        if (allStepsCompleted !== isInCheckedArray) {
            // Fix the inconsistency
            if (allStepsCompleted && !isInCheckedArray) {
                checkedPreparedIds.push(recipeId);
            } else if (!allStepsCompleted && isInCheckedArray) {
                const index = checkedPreparedIds.indexOf(recipeId);
                if (index > -1) {
                    checkedPreparedIds.splice(index, 1);
                }
            }
        }
    });
}

/**
 * Creates a debounced version of a function to prevent rapid calls
 */
function debounce(func, wait) {
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

// Export functions for use in index.js
window.ui = {
    getMainRecipes,
    renderIngredient,
    renderRecipeNode,
    displayIngredientTree,
    renderBaseIngredients,
    renderUsedBaseIngredients,
    renderBaseIngredientsLeft,
    renderPreparedIngredientTree,
    mountPreparedIngredientTree,
    renderCompletedPreparedIngredients,
    getBaseIngredients,
    getPreparedIngredients,
    getCheckedBaseIngredientTotals,
    ProcessVisualizer,    generateOrderedStepList,
    renderOrderedStepList,    areAllStepsCompleted,
    createEnhancedStepChangeHandler,    ensureStateConsistency,
    debounce
};
})();
