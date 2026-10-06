// units.json
const unitsJson = {
  "st": { "name": "styck", "type": "count", "baseUnit": "st", "conversionFactor": 1 },
  "g": { "name": "gram", "type": "weight", "baseUnit": "g", "conversionFactor": 1 },
  "kg": { "name": "kilogram", "type": "weight", "baseUnit": "g", "conversionFactor": 1000 },
  "tsk": { "name": "tesked", "type": "volume", "baseUnit": "ml", "conversionFactor": 5 },
  "msk": { "name": "matsked", "type": "volume", "baseUnit": "ml", "conversionFactor": 15 },
  "ml": { "name": "milliliter", "type": "volume", "baseUnit": "ml", "conversionFactor": 1 },
  "dl": { "name": "deciliter", "type": "volume", "baseUnit": "ml", "conversionFactor": 100 },
  "l": { "name": "liter", "type": "volume", "baseUnit": "ml", "conversionFactor": 1000 },
  "skvätt": { "name": "skvätt", "type": "volume", "baseUnit": "ml", "conversionFactor": 10 }, // 2 tsk
  "nypa": { "name": "nypa", "type": "volume", "baseUnit": "ml", "conversionFactor": 1 }, // ~1ml, 1/5 tsk
  "klick": { "name": "klick", "type": "volume", "baseUnit": "ml", "conversionFactor": 5 }, // ~5ml, 1 tsk, more than nypa
  "skiva": { "name": "skiva", "type": "count", "baseUnit": "st", "conversionFactor": 1 },
  "huvud": { "name": "huvud", "type": "count", "baseUnit": "st", "conversionFactor": 1 },
  "pkt": { "name": "paket", "type": "count", "baseUnit": "st", "conversionFactor": 1 },
  "burk": { "name": "burk", "type": "count", "baseUnit": "st", "conversionFactor": 1 },
  "kruka": { "name": "kruka", "type": "count", "baseUnit": "st", "conversionFactor": 1 }
};

const ingredientTagsJSON = {
  "dairy": { "displayName": "Mejeri", "color": "#87CEEB" },
  "eggs": { "displayName": "Ägg", "color": "#FFF8DC" },
  "meat": { "displayName": "Kött", "color": "#CD5C5C" },
  "fish": { "displayName": "Fisk", "color": "#20B2AA" },
  "processed_meat": { "displayName": "Chark", "color": "#A0522D" },
  "vegetables": { "displayName": "Grönsaker", "color": "#90EE90" },
  "fruits": { "displayName": "Frukt", "color": "#FFB6C1" },
  "herbs": { "displayName": "Kryddor & Örter", "color": "#9ACD32" },
  "spices": { "displayName": "Kryddor", "color": "#DDA0DD" },
  "sauces": { "displayName": "Såser", "color": "#F4A460" },
  "grains": { "displayName": "Spannmål", "color": "#DEB887" },
  "legumes": { "displayName": "Baljväxter", "color": "#8FBC8F" },
  "nuts_seeds": { "displayName": "Nötter & Frön", "color": "#D2691E" },
  "oils": { "displayName": "Oljor", "color": "#FFD700" },
  "basic": { "displayName": "Grundläggande", "color": "#C0C0C0" },
  "baking": { "displayName": "Bakning", "color": "#F5DEB3" },
  "frozen": { "displayName": "Fryst", "color": "#B0E0E6" },
  "canned": { "displayName": "Konserv", "color": "#D3D3D3" },
  "fresh": { "displayName": "Färsk", "color": "#98FB98" },
  "organic": { "displayName": "Ekologisk", "color": "#32CD32" }
};

const ingredientsJSON = {
  "egg": { "name": "Ägg", "tags": ["eggs", "basic", "fresh"] },
  "butter": { "name": "Smör", "tags": ["dairy", "basic"] },
  "salt": { "name": "Salt", "tags": ["basic", "spices"] },
  "pepper": { "name": "Peppar", "tags": ["basic", "spices"] },
  "bacon": { "name": "Bacon", "tags": ["processed_meat", "meat"] },
  "bread": { "name": "Bröd", "tags": ["grains", "baking"] },
  "cheese": { "name": "Ost", "tags": ["dairy"] },
  "water": { "name": "Vatten", "tags": ["basic"] },
  "bulgur": { "name": "Bulgur", "tags": ["grains"] },
  "chicken_breast_bbq": { "name": "Kycklingbröstfilé, BBQ-Marinerad", "tags": ["meat", "fresh"] },
  "olive_oil": { "name": "Olivolja", "tags": ["oils", "basic"] },
  "garlic": { "name": "Vitlöksklyfta", "tags": ["vegetables", "herbs", "fresh"] },
  "lettuce": { "name": "Sallad", "tags": ["vegetables", "fresh"] },
  "tomato": { "name": "Tomat", "tags": ["vegetables", "fresh"] },
  "paprika": { "name": "Paprika", "tags": ["vegetables", "fresh"] },
  "cucumber": { "name": "Gurka", "tags": ["vegetables", "fresh"] },
  "milk": { "name": "Mjölk", "tags": ["dairy", "basic"] },
  "flour": { "name": "Vetemjöl", "tags": ["grains", "baking", "basic"] },
  "sugar": { "name": "Socker", "tags": ["basic", "baking"] },
  "yeast": { "name": "Jäst", "tags": ["baking"] },
  "oil": { "name": "Matolja", "tags": ["oils", "basic"] },
  "rice": { "name": "Ris", "tags": ["grains"] },
  "red_onion": { "name": "Rödlök", "tags": ["vegetables", "fresh"] },
  "vegetable_bouillon": { "name": "Grönsaksbuljong", "tags": ["basic", "sauces"] },
  "spicemix_pearl": { "name": "Medelhavets Pärla", "tags": ["spices"] },
  "yoghurt": { "name": "Yoghurt", "tags": ["dairy"] },
  "lemon": { "name": "Citron", "tags": ["fruits", "fresh"] },
  "parsley": { "name": "Persilja", "tags": ["herbs", "fresh"] },
  "pumpkin_seeds": { "name": "Pumpakärnor", "tags": ["nuts_seeds"] },
  // Add more ingredients here as needed for new recipes
  "pasta": { "name": "Pasta", "tags": ["grains"] },
  "ground_beef": { "name": "Köttfärs", "tags": ["meat", "fresh"] },
  "onion": { "name": "Gul lök", "tags": ["vegetables", "fresh", "basic"] },
  "canned_tomatoes": { "name": "Krossade tomater", "tags": ["vegetables", "canned"] },
  "basil": { "name": "Basilika", "tags": ["herbs", "spices"] },
  "parmesan": { "name": "Parmesan", "tags": ["dairy"] },
  "broccoli": { "name": "Broccoli", "tags": ["vegetables", "fresh"] },
  "ham": { "name": "Skinka", "tags": ["processed_meat", "meat"] },
  "grated_cheese": { "name": "Riven ost", "tags": ["dairy"] },
  "baby_spinach": { "name": "Färsk babyspenat", "tags": ["vegetables", "fresh"] },
  "sun_dried_tomatoes": { "name": "Soltorkade tomater", "tags": ["vegetables"] },
  "feta_cheese": { "name": "Fetaost", "tags": ["dairy"] },
  "sesame_seeds": { "name": "Sesamfrön", "tags": ["nuts_seeds"] },
  "potato": { "name": "Potatis", "tags": ["vegetables", "fresh", "basic"] },
  "carrot": { "name": "Morot", "tags": ["vegetables", "fresh"] },
  "chicken_inner_fillet": { "name": "Kycklinginnerfilé", "tags": ["meat", "fresh"] },
  "creme_fraiche": { "name": "Crème fraiche", "tags": ["dairy"] },
  "soy_sauce": { "name": "Sojasås", "tags": ["sauces"] },
  "honey": { "name": "Honung", "tags": ["basic"] },
  "zucchini": { "name": "Zucchini", "tags": ["vegetables", "fresh"] },
  "apple": { "name": "Äpple", "tags": ["fruits", "fresh"] },
  "organic_lemon": { "name": "Ekologisk citron", "tags": ["fruits", "fresh", "organic"] },
  "fresh_basil": { "name": "Färsk basilika", "tags": ["herbs", "spices", "fresh"] }
}

// ===================================================================
// MAIN RECIPE DATA ARRAY
// ===================================================================
// This array will be populated by individual recipe files
// Each recipe collection adds itself using: recipesData.push(...recipes)
// ===================================================================

const recipesData = [];

// ===================================================================
// RECIPE FILES STRUCTURE
// ===================================================================
// Recipe files are organized in js/data/recipes/ folder:
// - mediterranean-chicken.js - Mediterranean chicken with bulgur
// - spaghetti-bolognese.js   - Classic spaghetti bolognese
// - portionspajer.js         - Swedish portion pies
// - spinach-feta-piroger.js  - Spinach and feta piroger
//
// To add new recipes:
// 1. Create a new file in js/data/recipes/
// 2. Define your recipe collection array
// 3. Add: recipesData.push(...yourRecipeArray);
// 4. Include the file in index.html after data.js
// ===================================================================

// ===================================================================
// UTILITY FUNCTIONS FOR INGREDIENT TAGS
// ===================================================================

/**
 * Get all ingredients that have a specific tag
 * @param {string} tag - The tag to filter by
 * @returns {Array} Array of ingredient objects with the specified tag
 */
function getIngredientsByTag(tag) {
  return Object.entries(ingredientsJSON)
    .filter(([key, ingredient]) => ingredient.tags.includes(tag))
    .map(([key, ingredient]) => ({ id: key, ...ingredient }));
}

/**
 * Get all basic ingredients (tagged with 'basic')
 * @returns {Array} Array of basic ingredient objects
 */
function getBasicIngredients() {
  return getIngredientsByTag('basic');
}

/**
 * Sort ingredients by priority (basic ingredients first, then alphabetically)
 * @param {Array} ingredients - Array of ingredient objects
 * @returns {Array} Sorted array of ingredients
 */
function sortIngredientsByPriority(ingredients) {
  return ingredients.sort((a, b) => {
    const aIsBasic = a.tags.includes('basic');
    const bIsBasic = b.tags.includes('basic');
    
    // Basic ingredients first
    if (aIsBasic && !bIsBasic) return -1;
    if (!aIsBasic && bIsBasic) return 1;
    
    // Then alphabetically by name
    return a.name.localeCompare(b.name, 'sv');
  });
}

/**
 * Get ingredients grouped by their primary tag (first tag in the array)
 * @returns {Object} Object with tag names as keys and ingredient arrays as values
 */
function getIngredientsGroupedByPrimaryTag() {
  const grouped = {};
  
  Object.entries(ingredientsJSON).forEach(([key, ingredient]) => {
    const primaryTag = ingredient.tags[0];
    if (!grouped[primaryTag]) {
      grouped[primaryTag] = [];
    }
    grouped[primaryTag].push({ id: key, ...ingredient });
  });
  
  return grouped;
}

/**
 * Get all unique tags used by ingredients
 * @returns {Array} Array of tag names
 */
function getAllIngredientTags() {
  const allTags = new Set();
  Object.values(ingredientsJSON).forEach(ingredient => {
    ingredient.tags.forEach(tag => allTags.add(tag));
  });
  return Array.from(allTags).sort();
}