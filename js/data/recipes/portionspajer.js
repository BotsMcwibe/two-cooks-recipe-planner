import { RecipeBuilder } from '../../models/recipe.js';

export const portionspieRecipes = [
  new RecipeBuilder("preheated_oven_225", "Värm Ugnen")
    .output("Förvärmd ugn (225°C)")
    .step("Värm ugnen till 225°C, eller 200°C varmluft.")
    .tip("Ugnen tar vanligtvis 10-15 minuter att värmas upp.")
    .duration(1)
    .wait(12)
    .tag("prep")
    .tag("no-timer")
    .build(),

  new RecipeBuilder("warmed_milk_oil", "Värm Mjölk och Olja")
    .input("milk", 2, "dl")
    .input("oil", 1, "msk")
    .output("Uppvärmd mjölk och olja")
    .step("Värm {{oil}} och {{milk}} till 37°C i en kastrull eller mikrovågsugn.")
    .tip("Använd ett finger för att kontrollera temperaturen.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("pirog_dough", "Gör Pirogdeg")
    .input("warmed_milk_oil", 1, "st")
    .input("yeast", 25, "g")
    .input("salt", 0.5, "tsk")
    .input("flour", 6, "dl")
    .output("Pirogdeg")
    .step("Lös upp {{yeast}} och {{salt}} i {{warmed_milk_oil}}.")
    .step("Blanda i {{flour}} lite i taget tills en smidig deg bildas.")
    .step("Låt degen jäsa medan fyllningen förbereds.")
    .duration(5)
    .wait(20)
    .build(),

  new RecipeBuilder("chopped_broccoli", "Hacka Broccoli")
    .input("broccoli", 100, "g")
    .output("Hackad broccoli")
    .step("Tina och hacka {{broccoli}} grovt.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("chopped_ham", "Hacka Skinka")
    .input("ham", 100, "g")
    .output("Hackad skinka")
    .step("Hacka {{ham}} i små bitar.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("pie_filling_broccoli_ham_cheese", "Gör Pirogfyllning")
    .input("chopped_broccoli", 1, "st")
    .input("chopped_ham", 1, "st")
    .input("grated_cheese", 100, "g")
    .input("egg", 0.5, "st")
    .input("pepper", 1, "nypa")
    .output("Pirogfyllning")
    .step("Blanda {{chopped_broccoli}}, {{chopped_ham}}, {{grated_cheese}}, {{egg}} och {{pepper}} i en skål.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("shaped_pies", "Forma Piroger")
    .input("pirog_dough", 1, "st")
    .input("pie_filling_broccoli_ham_cheese", 1, "st")
    .output("Formade piroger")
    .step("Dela {{pirog_dough}} i 4-6 delar.")
    .step("Kavla ut varje del till ca 0,5 cm tjocklek.")
    .step("Klicka på {{pie_filling_broccoli_ham_cheese}} på ena halvan av varje degbit.")
    .step("Vik ihop degen till en halvmåne och nyp kanterna ordentligt med en gaffel.")
    .step("Lägg pajerna på en plåt med bakplåtspapper.")
    .duration(10)
    .build(),

  new RecipeBuilder("egg_wash", "Gör Äggpensel")
    .input("egg", 0.5, "st")
    .output("Äggpensel")
    .step("Vispa {{egg}} lätt i en liten skål.")
    .tag("prep")
    .duration(1)
    .build(),

  new RecipeBuilder("piroger_ham_broccoli", "Piroger med Skinka och Broccoli")
    .input("preheated_oven_225", 1, "st")
    .input("shaped_pies", 1, "st")
    .input("egg_wash", 1, "st")
    .input("sesame_seeds", 1, "msk")
    .output("Piroger med Skinka och Broccoli")
    .step("Pensla pirogerna med {{egg_wash}}.")
    .step("Strö över {{sesame_seeds}}.")
    .step("Låt {{shaped_pies}} jäsa i ca 5 minuter.")
    .step("Grädda på nedersta valsen i {{preheated_oven_225}} i ca 12 minuter tills gyllene.")
    .duration(5)
    .wait(15)
    .tag("master")
    .build(),
];
