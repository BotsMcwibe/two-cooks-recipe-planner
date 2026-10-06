// ===================================================================
// SPINACH FETA PIROGER RECIPE COLLECTION
// ===================================================================
// Complete recipe collection for Spinach and Feta Piroger
// Reuses dough preparation from portionspajer but with different filling
// Automatically adds itself to the main recipesData array
// ===================================================================

// Spinach Feta Piroger Recipe Collection
const spinachFetaPirogerRecipes = [

  // Spinach and feta filling preparation
  new RecipeBuilder("chopped_onion", "Hacka Lök")
    .input("onion", 0.5, "st")
    .output("Finhackad lök")
    .step("Hacka {{onion}} fint.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("sauteed_onion", "Fräs Lök")
    .input("chopped_onion", 1, "st")
    .input("olive_oil", 1, "skvätt")
    .output("Fräst lök")
    .step("Hetta upp {{olive_oil}} i en stekpanna på medelhög värme.")
    .step("Fräs {{chopped_onion}} i {{olive_oil}} några minuter tills den mjuknar.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("wilted_spinach", "Fräs Spenat")
    .input("sauteed_onion", 1, "st")
    .input("baby_spinach", 65, "g")
    .output("Fräst Lök och Spenat")
    .step("Tillsätt {{baby_spinach}} till {{sauteed_onion}} och fräs tills mjuka.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("sliced_sun_dried_tomatoes", "Strimla Soltorkade Tomater")
    .input("sun_dried_tomatoes", 3, "st")
    .output("Strimlade soltorkade tomater")
    .step("Strimla {{sun_dried_tomatoes}} i tunna strimlor.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("spinach_tomato_mix", "Tillsätt Soltorkade Tomater")
    .input("wilted_spinach", 1, "st")
    .input("sliced_sun_dried_tomatoes", 1, "st")
    .input("salt", 1, "nypa")
    .input("pepper", 1, "nypa")
    .output("Spenat och tomatblandning")
    .step("Fräs {{sliced_sun_dried_tomatoes}} med {{wilted_spinach}} i 1 minut.")
    .step("Krydda med {{salt}} och {{pepper}}.")
    .step("Låt blandningen svalna något.")
    .tag("prep")
    .duration(4)
    .build(),

  new RecipeBuilder("spinach_feta_filling", "Gör Spenat- och Fetafyllning")
    .input("spinach_tomato_mix", 1, "st")
    .input("feta_cheese", 75, "g")
    .input("egg", 0.5, "st")
    .output("Spenat- och fetafyllning")
    .step("Smula {{feta_cheese}} och blanda med {{spinach_tomato_mix}} och {{egg}}.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("shaped_piroger", "Forma Piroger")
    .input("pirog_dough", 1, "st")
    .input("spinach_feta_filling", 1, "st")
    .output("Formade piroger")
    .step("Dela {{pirog_dough}} i 4-6 bitar.")
    .step("Kavla eller tryck ut rundlar, ca 15 cm i diameter, 0.5 cm tjocka.")
    .step("Lägg en klick {{spinach_feta_filling}} på ena halvan av varje degbit.")
    .step("Vik ihop degen till en halvmåne och nyp ihop kanterna ordentligt med en gaffel.")
    .step("Lägg pirogerna på en plåt med bakplåtspapper.")
    .duration(10)
    .build(),

  // Final assembly - MASTER RECIPE
  new RecipeBuilder("spinach_feta_piroger", "Piroger med Fetaost och Spenat")
    .input("preheated_oven_220", 1, "st")
    .input("shaped_piroger", 1, "st")
    .input("egg_wash", 1, "st")
    .input("sesame_seeds", 0.5, "msk")
    .output("Piroger med Spenat och Fetaost")
    .step("Pensla pirogerna med {{egg_wash}}.")
    .step("Strö över {{sesame_seeds}}.")
    .step("Grädda på nedersta valsen i {{preheated_oven_220}} i ca 12 minuter tills de fått fin färg.")
    .tip("Pirogerna är klara när de fått en gyllenbrun färg.")
    .duration(5)
    .wait(20)
    .tag("master")
    .build()
];

// Add recipes to the main collection
recipesData.push(...spinachFetaPirogerRecipes);
