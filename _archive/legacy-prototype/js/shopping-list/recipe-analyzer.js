/**
 * RecipeAnalyzer - Analyzes recipes to provide cooking time estimates, complexity analysis, and descriptions
 * Uses the same scheduling logic as the main app to provide accurate timing information
 */
class RecipeAnalyzer {
    constructor(allRecipes, unitMap, ingredientMap) {
        this.allRecipes = allRecipes;
        this.unitMap = unitMap;
        this.ingredientMap = ingredientMap;
    }

    /**
     * Analyze a recipe and provide comprehensive information
     * @param {Recipe} recipe - Recipe to analyze
     * @param {Object} options - Analysis options { cooks: number, prepFirst: boolean }
     * @returns {Object} Analysis results
     */
    analyzeRecipe(recipe, options = { cooks: 1, prepFirst: false }) {
        const analysis = {
            // Basic info
            name: recipe.name,
            id: recipe.id,
            
            // Timing analysis
            timing: this.analyzeTiming(recipe, options),
            
            // Complexity analysis
            complexity: this.analyzeComplexity(recipe),
            
            // Ingredient analysis
            ingredients: this.analyzeIngredients(recipe),
            
            // Cooking methods and equipment
            methods: this.analyzeCookingMethods(recipe),
            
            // Tags and categories
            tags: this.analyzeTags(recipe),
            
            // Generated descriptions
            shortDescription: '',
            detailedDescription: ''
        };

        // Generate descriptions based on analysis
        analysis.shortDescription = this.generateShortDescription(analysis);
        analysis.detailedDescription = this.generateDetailedDescription(analysis);

        return analysis;
    }

    /**
     * Analyze timing using the scheduler
     */
    analyzeTiming(recipe, options) {
        try {
            const scheduler = new Scheduler(recipe, this.allRecipes, options);
            const schedule = scheduler.getSchedule();
            
            const timing = {
                totalTime: Math.round(schedule.totalTime),
                activeTime: this.calculateActiveTime(schedule.nodes),
                waitTime: this.calculateWaitTime(schedule.nodes),
                threads: schedule.threads,
                maxThreads: schedule.maxThreads,
                parallelEfficiency: schedule.threads > 1 ? 
                    Math.round((schedule.totalTime / this.calculateSingleThreadTime(recipe)) * 100) : 100,
                steps: schedule.nodes.length
            };

            // Add prep time estimation if prep first is enabled
            if (options.prepFirst) {
                timing.prepTime = this.calculatePrepTime(recipe, schedule);
                timing.cookTime = timing.totalTime - timing.prepTime;
            }

            return timing;
        } catch (error) {
            console.warn('Failed to analyze timing for recipe:', recipe.name, error);
            const fallbackTiming = {
                totalTime: recipe.duration || 30,
                activeTime: recipe.duration || 30,
                waitTime: recipe.wait || 0,
                threads: 1,
                maxThreads: 1,
                parallelEfficiency: 100,
                steps: recipe.steps ? recipe.steps.length : 1
            };

            // Add prep estimation for fallback
            if (options.prepFirst) {
                fallbackTiming.prepTime = this.estimatePrepTimeFromSteps(recipe);
                fallbackTiming.cookTime = fallbackTiming.totalTime - fallbackTiming.prepTime;
            }

            return fallbackTiming;
        }
    }

    /**
     * Calculate active cooking time (excluding wait times)
     */
    calculateActiveTime(nodes) {
        return nodes.reduce((total, node) => total + (node.recipe.duration || 0), 0);
    }

    /**
     * Calculate total wait time
     */
    calculateWaitTime(nodes) {
        return nodes.reduce((total, node) => total + (node.recipe.wait || 0), 0);
    }

    /**
     * Calculate what the time would be with a single cook
     */
    calculateSingleThreadTime(recipe) {
        try {
            const singleCookScheduler = new Scheduler(recipe, this.allRecipes, { cooks: 1, prepFirst: false });
            return singleCookScheduler.getSchedule().totalTime;
        } catch (error) {
            return recipe.duration || 30;
        }
    }

    /**
     * Analyze recipe complexity
     */
    analyzeComplexity(recipe) {
        const complexity = {
            level: 'Easy',
            score: 0,
            factors: []
        };

        // Count sub-recipes
        const subRecipes = this.getSubRecipes(recipe);
        if (subRecipes.length > 0) {
            complexity.score += subRecipes.length * 2;
            complexity.factors.push(`${subRecipes.length} komponenter`);
        }

        // Count steps
        const stepCount = recipe.steps ? recipe.steps.length : 1;
        if (stepCount > 5) {
            complexity.score += Math.floor(stepCount / 3);
            complexity.factors.push(`${stepCount} steg`);
        }

        // Check for advanced techniques
        const techniques = this.getAdvancedTechniques(recipe);
        complexity.score += techniques.length;
        complexity.factors.push(...techniques);

        // Check cooking time
        const totalTime = recipe.duration || 0;
        if (totalTime > 60) {
            complexity.score += 2;
            complexity.factors.push('Lång tillagningstid');
        }

        // Determine level
        if (complexity.score <= 2) complexity.level = 'Lätt';
        else if (complexity.score <= 5) complexity.level = 'Medel';
        else complexity.level = 'Svår';

        return complexity;
    }

    /**
     * Get sub-recipes for this recipe
     */
    getSubRecipes(recipe) {
        if (!recipe.inputs) return [];
        
        return recipe.inputs.filter(input => {
            return this.allRecipes.some(r => r.outputIngredient.id === input.ingredient.id);
        }).map(input => {
            return this.allRecipes.find(r => r.outputIngredient.id === input.ingredient.id);
        });
    }

    /**
     * Identify advanced cooking techniques
     */
    getAdvancedTechniques(recipe) {
        const techniques = [];
        const allSteps = recipe.steps ? recipe.steps.map(step => 
            typeof step === 'string' ? step : step.text || ''
        ).join(' ').toLowerCase() : '';

        const techniqueMap = {
            'temperatur': 'Temperaturkontroll',
            'timers': 'Tajming',
            'marinera': 'Marinering',
            'form': 'Formning',
            'ugn': 'Ugnsbakning',
            'stek': 'Stekning',
            'karamellisera': 'Karamellisering',
            'reducera': 'Reduktion',
            'emulgera': 'Emulgering'
        };

        Object.entries(techniqueMap).forEach(([keyword, technique]) => {
            if (allSteps.includes(keyword)) {
                techniques.push(technique);
            }
        });

        return techniques;
    }

    /**
     * Analyze ingredients
     */
    analyzeIngredients(recipe) {
        const ingredients = this.getBaseIngredients(recipe);
        const tagCounts = {};
        const categories = new Set();

        ingredients.forEach(ingredient => {
            if (ingredient.tags) {
                ingredient.tags.forEach(tag => {
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    if (this.ingredientMap[ingredient.id]) {
                        categories.add(this.ingredientMap[ingredient.id].primaryTag);
                    }
                });
            }
        });

        return {
            total: ingredients.length,
            categories: Array.from(categories),
            tagCounts,
            hasBasicIngredients: ingredients.some(ing => 
                this.ingredientMap[ing.id] && this.ingredientMap[ing.id].hasTag('basic')
            ),
            hasFreshIngredients: ingredients.some(ing => 
                this.ingredientMap[ing.id] && this.ingredientMap[ing.id].hasTag('fresh')
            )
        };
    }

    /**
     * Get all base ingredients for a recipe (recursive)
     */
    getBaseIngredients(recipe, visited = new Set()) {
        if (visited.has(recipe.id)) return [];
        visited.add(recipe.id);

        const baseIngredients = [];
        
        if (recipe.inputs) {
            recipe.inputs.forEach(input => {
                const subRecipe = this.allRecipes.find(r => r.outputIngredient.id === input.ingredient.id);
                if (subRecipe) {
                    baseIngredients.push(...this.getBaseIngredients(subRecipe, visited));
                } else {
                    baseIngredients.push(input.ingredient);
                }
            });
        }

        return baseIngredients;
    }

    /**
     * Analyze cooking methods
     */
    analyzeCookingMethods(recipe) {
        const methods = new Set();
        const equipment = new Set();

        if (recipe.steps) {
            recipe.steps.forEach(step => {
                // Handle both string steps and object steps with text property
                const stepText = (typeof step === 'string' ? step : step.text || '').toLowerCase();
                
                // Cooking methods
                if (stepText.includes('stek')) methods.add('Stekning');
                if (stepText.includes('koka') || stepText.includes('sjud')) methods.add('Kokning');
                if (stepText.includes('ugn') || stepText.includes('grädda')) methods.add('Ugnsbakning');
                if (stepText.includes('blanda') || stepText.includes('röra')) methods.add('Blandning');
                if (stepText.includes('form') || stepText.includes('rulla')) methods.add('Formning');
                if (stepText.includes('hacka') || stepText.includes('skär')) methods.add('Förberedelse');

                // Equipment
                if (stepText.includes('panna')) equipment.add('Stekpanna');
                if (stepText.includes('ugn')) equipment.add('Ugn');
                if (stepText.includes('form')) equipment.add('Formar');
                if (stepText.includes('mixer') || stepText.includes('visp')) equipment.add('Visp/Mixer');
            });
        }

        return {
            methods: Array.from(methods),
            equipment: Array.from(equipment)
        };
    }

    /**
     * Analyze recipe tags
     */
    analyzeTags(recipe) {
        const tags = recipe.tags || [];
        const analysis = {
            isMaster: tags.includes('master'),
            isPrep: tags.includes('prep'),
            difficulty: tags.find(tag => ['easy', 'medium', 'hard'].includes(tag)) || 'medium',
            cuisine: tags.find(tag => ['swedish', 'italian', 'asian', 'mediterranean'].includes(tag)),
            mealType: tags.find(tag => ['breakfast', 'lunch', 'dinner', 'snack'].includes(tag)),
            dietary: tags.filter(tag => ['vegetarian', 'vegan', 'gluten-free'].includes(tag))
        };

        return analysis;
    }

    /**
     * Generate a short description
     */
    generateShortDescription(analysis) {
        const parts = [];

        // Time with prep breakdown if prep first is enabled
        if (analysis.timing.prepTime !== undefined) {
            parts.push(`${analysis.timing.totalTime} min (${analysis.timing.prepTime} min förb.)`);
            if (analysis.timing.threads > 1) {
                parts.push(`${analysis.timing.threads} kockar`);
            }
        } else if (analysis.timing.threads > 1) {
            parts.push(`${analysis.timing.totalTime} min (${analysis.timing.threads} kockar)`);
        } else {
            parts.push(`${analysis.timing.totalTime} min`);
        }

        // Complexity
        parts.push(analysis.complexity.level.toLowerCase());

        // Main characteristics
        if (analysis.methods.methods.length > 0) {
            parts.push(analysis.methods.methods[0].toLowerCase());
        }

        if (analysis.ingredients.categories.length > 0) {
            const primaryCategory = analysis.ingredients.categories[0];
            if (primaryCategory === 'meat') parts.push('kött');
            else if (primaryCategory === 'vegetables') parts.push('vegetarisk');
            else if (primaryCategory === 'fish') parts.push('fisk');
        }

        return parts.join(' • ');
    }

    /**
     * Generate a detailed description
     */
    generateDetailedDescription(analysis) {
        const parts = [];

        // Timing details with prep breakdown
        if (analysis.timing.prepTime !== undefined) {
            parts.push(`Förberedelsetid: ${analysis.timing.prepTime} min`);
            parts.push(`Lagtime: ${analysis.timing.cookTime} min`);
            parts.push(`Totaltid: ${analysis.timing.totalTime} min`);
            
            if (analysis.timing.threads > 1) {
                parts.push(`(${analysis.timing.threads} kockar)`);
            }
        } else {
            // Regular timing without prep breakdown
            if (analysis.timing.threads > 1) {
                const timeSaved = this.calculateSingleThreadTime({duration: analysis.timing.totalTime}) - analysis.timing.totalTime;
                parts.push(`Lagtime: ${analysis.timing.totalTime} min med ${analysis.timing.threads} kockar`);
                if (timeSaved > 0) {
                    parts.push(`(sparar ${Math.round(timeSaved)} min)`);
                }
            } else {
                parts.push(`Lagtime: ${analysis.timing.totalTime} min`);
            }
        }

        if (analysis.timing.waitTime > 0) {
            parts.push(`Väntetid: ${analysis.timing.waitTime} min`);
        }

        // Complexity details
        if (analysis.complexity.factors.length > 0) {
            parts.push(`Komplexitet: ${analysis.complexity.factors.join(', ')}`);
        }

        // Methods
        if (analysis.methods.methods.length > 0) {
            parts.push(`Metoder: ${analysis.methods.methods.join(', ')}`);
        }

        // Equipment
        if (analysis.methods.equipment.length > 0) {
            parts.push(`Utrustning: ${analysis.methods.equipment.join(', ')}`);
        }

        // Ingredients
        parts.push(`${analysis.ingredients.total} ingredienser`);
        if (analysis.ingredients.hasFreshIngredients) {
            parts.push('färska råvaror');
        }

        return parts.join(' • ');
    }

    /**
     * Calculate prep time when prep first is enabled
     */
    calculatePrepTime(recipe, schedule) {
        let prepTime = 0;
        
        // Find all prep recipes in the schedule
        schedule.nodes.forEach(node => {
            if (node.recipe.hasTag && node.recipe.hasTag('prep')) {
                prepTime += node.recipe.duration || 0;
            } else {
                // For non-prep recipes, estimate prep time from prep-related steps
                prepTime += this.estimatePrepTimeFromSteps(node.recipe);
            }
        });

        // Add base prep time for ingredient preparation (chopping, measuring, etc.)
        const baseIngredients = this.getBaseIngredients(recipe);
        const ingredientPrepTime = Math.min(baseIngredients.length * 0.5, 10); // 30 seconds per ingredient, max 10 min
        
        return Math.max(Math.round(prepTime + ingredientPrepTime), 5); // Minimum 5 minutes prep
    }

    /**
     * Estimate prep time from recipe steps
     */
    estimatePrepTimeFromSteps(recipe) {
        if (!recipe.steps) return 0;
        
        let prepTime = 0;
        
        recipe.steps.forEach(step => {
            const stepText = (typeof step === 'string' ? step : step.text || '').toLowerCase();
            
            // Prep-related activities and their estimated times
            if (stepText.includes('skär') || stepText.includes('hacka')) {
                prepTime += 2; // 2 minutes for chopping
            }
            if (stepText.includes('skala') || stepText.includes('rensa')) {
                prepTime += 1.5; // 1.5 minutes for peeling/cleaning
            }
            if (stepText.includes('marinera')) {
                prepTime += 3; // 3 minutes for marinating setup
            }
            if (stepText.includes('blanda') && !stepText.includes('stek') && !stepText.includes('koka')) {
                prepTime += 1; // 1 minute for mixing (if not during cooking)
            }
            if (stepText.includes('mät') || stepText.includes('väg')) {
                prepTime += 0.5; // 30 seconds for measuring
            }
            if (stepText.includes('form') && !stepText.includes('ugn')) {
                prepTime += 2; // 2 minutes for shaping (if not in oven)
            }
        });
        
        return Math.round(prepTime);
    }
}
