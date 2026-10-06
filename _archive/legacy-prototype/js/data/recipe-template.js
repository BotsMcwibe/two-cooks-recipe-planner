// ===================================================================
// SIMPLE RECIPE TEMPLATE - Copy and add directly to recipesData array
// ===================================================================
// 
// Instructions:
// 1. Copy the recipes below directly into the recipesData array in data.js
// 2. Replace "RECIPE_NAME" with your recipe name
// 3. Replace all placeholder values with actual ingredients/steps
// 4. Add any new ingredients to ingredientsJSON in data.js
// 5. Use comments to organize recipes by dish
// 6. Mark final dishes with .tag("master")
//
// ===================================================================

/*
  // ===================================================================
  // YOUR RECIPE NAME HERE
  // ===================================================================

  // Prep sub-recipes
  new RecipeBuilder("prep_ingredient_1", "Preparation Name")
    .input("ingredient_name", quantity, "unit")
    .output("Prepared ingredient")
    .step("Preparation instruction for {{ingredient_name}}.")
    .tag("prep")
    .duration(minutes)
    .build(),

  // Cooking sub-recipes
  new RecipeBuilder("cooked_component", "Cooking Name")
    .input("ingredient_name", quantity, "unit")
    .input("prep_ingredient_1", 1, "st")
    .output("Cooked component")
    .step("Cooking instruction.")
    .step("Another cooking step.")
    .tip("Optional cooking tip.")
    .duration(active_minutes)
    .wait(passive_minutes)  // Optional: for waiting/baking time
    .build(),

  // Final assembly - MASTER RECIPE
  new RecipeBuilder("recipe_name_final", "Recipe Display Name")
    .input("cooked_component", 1, "st")
    .input("garnish_ingredient", quantity, "unit")
    .output("Final dish name")
    .step("Assembly instruction.")
    .step("Serving instruction.")
    .duration(minutes)
    .tag("master")  // Important: mark main dishes with this tag
    .build(),
*/

// ===================================================================
// COMMON INGREDIENT SUGGESTIONS
// ===================================================================
// Here are some common ingredients you might want to add to ingredientsJSON:

/*
"potato": { "name": "Potatis" },
"carrot": { "name": "Morot" },
"celery": { "name": "Selleri" },
"mushroom": { "name": "Svamp" },
"spinach": { "name": "Spenat" },
"cream": { "name": "Grädde" },
"white_wine": { "name": "Vitt vin" },
"chicken_stock": { "name": "Kycklingbuljong" },
"beef_stock": { "name": "Köttbuljong" },
"thyme": { "name": "Timjan" },
"rosemary": { "name": "Rosmarin" },
"bay_leaves": { "name": "Lagerblad" },
"paprika_powder": { "name": "Paprikapulver" },
"cumin": { "name": "Spiskummin" },
"oregano": { "name": "Oregano" },
"baking_powder": { "name": "Bakpulver" },
"vanilla": { "name": "Vanilj" },
"cinnamon": { "name": "Kanel" }
*/

// ===================================================================
// COMMON UNIT SUGGESTIONS
// ===================================================================
// These units are already available in unitsJson:
// "st", "g", "tsk", "skiva", "ml", "skvätt", "nypa", "huvud", "msk", "dl", "l", "kg", "pkt"
