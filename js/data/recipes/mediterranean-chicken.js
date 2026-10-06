import { RecipeBuilder } from '../../models/recipe.js';

export const mediterraneanChickenRecipes = [
  new RecipeBuilder("preheated_oven_220", "Värm Ugnen")
    .output("Förvärmd ugn (220°C)")
    .step("Värm ugnen till 220°C, eller 200°C varmluft.")
    .tip("Ugnen tar vanligtvis 10-15 minuter att värmas upp.")
    .duration(1)
    .wait(12)
    .tag("prep")
    .tag("no-timer")
    .build(),

  new RecipeBuilder("diced_vegetables", "Tärna Grönsaker")
    .input("tomato", 4, "st")
    .input("paprika", 2, "st")
    .output("Tärnade grönsaker")
    .step("Tärna {{paprika}} och {{tomato}} i 2 cm stora bitar.")
    .tag("prep")
    .duration(10)
    .build(),

  new RecipeBuilder("red_onion_wedges", "Skär Rödlöksklyftor")
    .input("red_onion", 2, "st")
    .output("Rödlöksklyftor")
    .step("Skär {{red_onion}} i 2 cm tjocka klyftor.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("roasted_vegetables", "Rosta Grönsaker")
    .input("preheated_oven_220", 1, "st")
    .input("diced_vegetables", 1, "st")
    .input("red_onion_wedges", 1, "st")
    .input("olive_oil", 1, "skvätt")
    .input("salt", 0.5, "tsk")
    .input("pepper", 1, "nypa")
    .input("vegetable_bouillon", 8, "g")
    .input("spicemix_pearl", 4, "g")
    .output("Rostade Grönsaker")
    .step("Placera {{diced_vegetables}} och {{red_onion_wedges}} på en plåt med bakplåtspapper. Blanda med {{olive_oil}}, {{spicemix_pearl}}, {{vegetable_bouillon}}, {{salt}} och en nypa {{pepper}}.")
    .step("Rosta i {{preheated_oven_220}} i 10-15 minuter, eller tills mjuka.")
    .tip("Använd fler plåtar om det blir för trångt.")
    .duration(5)
    .wait(10)
    .build(),

  new RecipeBuilder("boiled_bulgur", "Koka Bulgur")
    .input("bulgur", 170, "g")
    .input("water", 4.5, "dl")
    .input("salt", 0.5, "tsk")
    .output("Kokad Bulgur")
    .step("Koka upp en kastrull med {{water}}.")
    .step('Rör i bulgur och salt, sänk till medellåg värme. Sjud under lock i 9-10 minuter, eller tills "al dente".')
    .duration(2)
    .wait(9)
    .build(),

  new RecipeBuilder("chopped_parsley", "Hackad Persilja")
    .input("parsley", 1, "st")
    .output("Finhackad persilja")
    .step("Skölj {{parsley}} under kallt vatten.")
    .step("Hacka {{parsley}} fint med en vass kniv.")
    .tip("Använd en stor kniv och samla ihop persiljan till en hög för att underlätta hackningen.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("bulgur_with_roasted_vegetables", "Blanda Bulgur och Rostade Grönsaker")
    .input("boiled_bulgur", 1, "st")
    .input("roasted_vegetables", 1, "st")
    .input("chopped_parsley", 1, "st")
    .input("olive_oil", 1, "skvätt")
    .input("salt", 0.5, "tsk")
    .input("pepper", 0.25, "tsk")
    .output("Bulgur med Rostade Grönsaker")
    .step("Rör ned {{roasted_vegetables}}, {{chopped_parsley}}, {{olive_oil}}, {{salt}} och {{pepper}} i {{boiled_bulgur}}.")
    .duration(5)
    .tag("carbs")
    .build(),

  new RecipeBuilder("chopped_chicken", "Skär Kyckling")
    .input("chicken_breast_bbq", 600, "g")
    .output("Kyckling i bitar")
    .step("Skär varje {{chicken_breast_bbq}} i 3 delar på en separat skärbräda.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("grilled_chicken", "Stek Kyckling")
    .input("chopped_chicken", 1, "st")
    .input("olive_oil", 1, "skvätt")
    .input("garlic", 1, "st")
    .input("salt", 0.5, "tsk")
    .input("pepper", 0.25, "tsk")
    .output("Stekt Kyckling")
    .step("Hetta upp {{olive_oil}} i en stor stekpanna på medelhög värme.")
    .step("Stek {{chopped_chicken}} med {{salt}} i 3 min på varje sida, eller tills gylllene och genomstekt.")
    .tip("Kyckling är färdiglagad när köttet inte längre är rosa i mitten.")
    .tag("protein")
    .duration(9)
    .build(),

  new RecipeBuilder("lemon_juice", "Pressa Citronsaft")
    .input("lemon", 1, "st")
    .output("Citronsaft")
    .step("Skölj {{lemon}} under kallt vatten.")
    .step("Dela {{lemon}} på mitten och pressa ur saften.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("lemon_yoghurt", "Blanda Citronyoghurt")
    .input("yoghurt", 150, "g")
    .input("lemon_juice", 1, "skvätt")
    .input("salt", 1, "nypa")
    .input("pepper", 1, "nypa")
    .output("Citronyoghurt")
    .step("Blanda {{yoghurt}}, {{lemon_juice}}, {{salt}} och {{pepper}} i en liten skål.")
    .tip("Smaka av.")
    .tag("prep")
    .tag("sauce")
    .duration(3)
    .build(),

  new RecipeBuilder("chicken_bulgur_mediterranean", "Medelhavs-inspirerad Kyckling")
    .input("bulgur_with_roasted_vegetables", 1, "st")
    .input("grilled_chicken", 1, "st")
    .input("lemon_yoghurt", 1, "st")
    .input("pumpkin_seeds", 20, "g")
    .output("Medelhavs-inspirerad kyckling")
    .step("Lägg upp {{bulgur_with_roasted_vegetables}} i djupa tallrikar.")
    .step("Toppa med {{grilled_chicken}} och {{lemon_yoghurt}}.")
    .step("Strö över {{pumpkin_seeds}}.")
    .duration(2)
    .tag("master")
    .build(),
];
