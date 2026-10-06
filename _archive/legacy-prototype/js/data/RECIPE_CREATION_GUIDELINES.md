# Recipe Naming Guidelines

## Overview
This document provides guidelines for naming recipes in the HTML Proto Recipe application to ensure consistency and clarity.

## Recipe Name Convention

### Action-Oriented Names (PREFERRED)
Recipe names should describe the **action or procedure** being performed, not the resulting ingredient. This makes it clear what the user is supposed to do.

#### Examples of Good Names:
- ✅ `"Värm Ugnen"` (Heat the Oven)
- ✅ `"Gör Köttfärssås"` (Make Meat Sauce)
- ✅ `"Koka Pasta"` (Cook Pasta)
- ✅ `"Hacka Broccoli"` (Chop Broccoli)
- ✅ `"Rosta Grönsaker"` (Roast Vegetables)
- ✅ `"Stek Kyckling"` (Fry Chicken)
- ✅ `"Forma Pajer"` (Shape Pies)
- ✅ `"Gör Pajdeg"` (Make Pie Dough)

#### Examples of Names to Avoid:
- ❌ `"Köttfärssås"` (Meat Sauce) - describes the output, not the action
- ❌ `"Pajdeg"` (Pie Dough) - describes the output, not the action
- ❌ `"Äggpensel"` (Egg Wash) - describes the output, not the action

### Master Recipe Names
For the final, main recipes that combine all sub-recipes, use descriptive names that clearly identify the dish:
- ✅ `"Spaghetti Bolognese"`
- ✅ `"Portionspajer med Skinka och Broccoli"`
- ✅ `"Medelhavs-inspirerad Kyckling"`

### When sauté or similar 
Make sure to mention the amount of heat needed. hög-medelhög-medel-medellåg-låg
For example:
.step("Hetta upp {{olive_oil}} i en stekpanna på medelhög värme.")

### Make chopping into a separate recipe
Instead of just making it a step, this way we can more easily sort the prep steps later.

### Re-use Recipes When Able
All recipes should be made to 4 portions by default. If another recipe already has outlined a given output the recipe should be used again in future recipes.

## Implementation Pattern

```javascript
new RecipeBuilder("recipe_id", "Action-Oriented Name")
  .input("ingredient", amount, "unit")
  // ... other methods
  .output("Resulting Product Name")
  .build()
```

## Why This Convention?

1. **Clarity**: Users immediately understand what they need to do
2. **Consistency**: All recipes follow the same naming pattern
3. **User Experience**: Instructions feel like steps in a process rather than just ingredient names
4. **Internationalization**: Verb-based names translate more naturally across languages
