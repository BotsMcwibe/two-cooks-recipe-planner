> **Obsolete (Oct 2026):** This document describes the March 2026 standalone shopping-list prototype.
> Those files now live under `_archive/legacy-prototype/`.
> Current shopping UI is part of the main app (`index.html` → Inköpslista tab).
> Kept for historical reference only.

# Shopping List Feature

## Overview

The shopping list feature allows users to select multiple main recipes (huvudrecept) and generates a consolidated shopping list with all required ingredients organized by category.

## Files Structure

```
shopping-list.html                          # Main shopping list page
css/shopping-list.css                       # Styles for shopping list
js/shopping-list/
  ├── shopping-list-app.js                  # Main application class
  ├── shopping-list-manager.js              # UI management and interactions
  └── ingredient-aggregator.js              # Ingredient consolidation logic
```

## Features

### Current Features (Skeleton Implementation)

1. **Recipe Selection**
   - Displays all main recipes (tagged with "master")
   - Checkbox selection interface
   - Recipe descriptions with main ingredients

2. **Ingredient Aggregation**
   - Combines ingredients from multiple recipes
   - Handles same ingredients with different units
   - Tracks which recipes each ingredient comes from

3. **Shopping List Display**
   - Organizes ingredients by categories:
     - Kött & Fisk (Meat & Fish)
     - Mejeri & Ägg (Dairy & Eggs)
     - Grönsaker & Frukt (Vegetables & Fruits)
     - Torrvaror (Dry Goods)
     - Kryddor & Såser (Spices & Sauces)
     - Övrigt (Other)
   - Shows ingredient amounts and sources
   - Checkboxes to mark ingredients as collected

4. **User Interface**
   - Clean, responsive design
   - Navigation between main app and shopping list
   - Print-friendly layout
   - Reset functionality

## How to Use

1. **Access the Shopping List**
   - From the main recipe app, click the "🛒 Inköpslista" button
   - Or navigate directly to `shopping-list.html`

2. **Select Recipes**
   - Check the boxes next to the recipes you want to cook
   - The "Skapa Inköpslista" button shows how many recipes are selected

3. **Generate Shopping List**
   - Click "Skapa Inköpslista" to generate the consolidated list
   - Ingredients are automatically categorized and combined

4. **Use the Shopping List**
   - Check off ingredients as you collect them
   - Print the list for offline use
   - Click "Börja om" to start over with new recipes

## Technical Implementation

### Data Flow

1. **Recipe Selection**: User selects master recipes from the UI
2. **Ingredient Extraction**: App extracts all ingredients from selected recipes
3. **Aggregation**: IngredientAggregator combines identical ingredients
4. **Categorization**: Ingredients are sorted into shopping categories
5. **Display**: UI renders the organized shopping list

### Key Classes

- **ShoppingListApp**: Main application initialization and data management
- **ShoppingListManager**: UI logic and user interaction handling
- **IngredientAggregator**: Ingredient consolidation and categorization

## Future Enhancements

Planned improvements for the shopping list feature:

1. **Portion Scaling**: Allow users to adjust portions for selected recipes
2. **Unit Conversion**: Smart conversion between compatible units (g/kg, ml/dl/l)
3. **Shopping Categories**: Customizable categories and store-specific layouts
4. **Save/Share Lists**: Export lists as PDF, email, or shareable links
5. **Shopping History**: Remember frequently used combinations
6. **Integration**: Deep linking from main app with pre-selected recipes
7. **Mobile Optimization**: Better mobile experience for in-store use

## Notes for Developers

- Recipe data is shared with the main application
- All main recipes should be tagged with "master" for proper filtering
- Ingredient categorization is based on ingredient IDs in `categorizeIngredient()`
- CSS is optimized for both screen and print media
- The app gracefully handles missing or malformed recipe data

## Navigation

- **From Main App**: Click "🛒 Inköpslista" in the header
- **To Main App**: Click "← Tillbaka till Recept" in the shopping list header
