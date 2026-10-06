import { RecipeBuilder } from '../../models/recipe.js';

export const basilikakycklingRecipes = [
  new RecipeBuilder("chopped_potato_carrot", "Skär Potatis och Morötter")
    .input("potato", 1000, "g")
    .input("carrot", 4, "st")
    .output("Skuren potatis och morötter")
    .step("Skala {{potato}} och {{carrot}}.")
    .step("Skär {{potato}} och {{carrot}} i 2 cm stora bitar.")
    .tag("prep")
    .duration(8)
    .build(),

  new RecipeBuilder("boiled_potato_carrot", "Koka Potatis och Morötter")
    .input("chopped_potato_carrot", 1, "st")
    .input("water", 1, "l")
    .output("Kokt potatis och morötter")
    .step("Lägg {{chopped_potato_carrot}} i en kastrull och täck med kallt {{water}}.")
    .step("Koka upp, sänk värmen och sjud i 10–12 minuter tills de är mjuka.")
    .duration(2)
    .wait(12)
    .build(),

  new RecipeBuilder("fried_chicken", "Stek Kyckling")
    .input("chicken_inner_fillet", 560, "g")
    .input("olive_oil", 1, "skvätt")
    .output("Stekt kyckling")
    .step("Hetta upp {{olive_oil}} i en stor stekpanna på medelhög värme.")
    .step("Bryn {{chicken_inner_fillet}} 4–5 minuter tills gyllene.")
    .duration(6)
    .build(),

  new RecipeBuilder("chopped_basil", "Hacka Basilika")
    .input("fresh_basil", 1, "kruka")
    .output("Grovhackad basilika")
    .step("Grovhacka {{fresh_basil}}.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("basil_chicken_sauce", "Gör Basilikasås")
    .input("fried_chicken", 1, "st")
    .input("creme_fraiche", 2, "burk")
    .input("soy_sauce", 50, "ml")
    .input("honey", 25, "g")
    .input("chopped_basil", 1, "st")
    .input("salt", 1, "nypa")
    .input("pepper", 1, "nypa")
    .output("Basilikakyckling med sås")
    .step("Sänk till låg värme i pannan med {{fried_chicken}}.")
    .step("Tillsätt {{creme_fraiche}}, {{soy_sauce}} och {{honey}}.")
    .step("Krydda med {{salt}} och {{pepper}}.")
    .step("Låt sjuda i 8–10 minuter tills kycklingen är genomlagad.")
    .step("Rör ner {{chopped_basil}} i pannan.")
    .tip("Tillsätt vatten om såsen blir för tjock.")
    .duration(12)
    .tag("protein")
    .build(),

  new RecipeBuilder("grated_zucchini", "Riv Zucchini")
    .input("zucchini", 1, "st")
    .output("Riven zucchini")
    .step("Riv {{zucchini}} grovt.")
    .step("Krama ur vätskan från den rivna zucchinin.")
    .tag("prep")
    .duration(4)
    .build(),

  new RecipeBuilder("sliced_apple", "Skiva Äpplen")
    .input("apple", 2, "st")
    .output("Skivade äpplen")
    .step("Skiva {{apple}} i tunna skivor.")
    .tag("prep")
    .duration(3)
    .build(),

  new RecipeBuilder("lemon_wedges", "Skär Citronklyftor")
    .input("organic_lemon", 1, "st")
    .output("Citronklyftor och citronsaft")
    .step("Skär {{organic_lemon}} i klyftor.")
    .step("Spara lite citronsaft för salladen.")
    .tag("prep")
    .duration(2)
    .build(),

  new RecipeBuilder("zucchini_salad", "Gör Zucchinisallad")
    .input("grated_zucchini", 1, "st")
    .input("sliced_apple", 1, "st")
    .input("lemon_wedges", 1, "st")
    .input("olive_oil", 1, "skvätt")
    .input("salt", 1, "nypa")
    .input("pepper", 1, "nypa")
    .output("Zucchinisallad")
    .step("Blanda {{grated_zucchini}}, {{sliced_apple}}, en skvätt citronsaft från {{lemon_wedges}}, {{olive_oil}}, {{salt}} och {{pepper}} i en skål.")
    .duration(3)
    .tag("salad")
    .build(),

  new RecipeBuilder("root_vegetable_mash", "Gör Rotmos")
    .input("boiled_potato_carrot", 1, "st")
    .input("butter", 1, "klick")
    .input("salt", 1, "nypa")
    .input("pepper", 1, "nypa")
    .output("Rotmos")
    .step("Häll av vattnet från kastrullen med {{boiled_potato_carrot}}.")
    .step("Mosa potatis och morot tillsammans med en klick {{butter}} till mos.")
    .step("Smaka av med {{salt}} och {{pepper}}.")
    .duration(5)
    .tag("carbs")
    .build(),

  new RecipeBuilder("basil_chicken_root_mash", "Basilikakyckling med Rotmos och Zucchinisallad")
    .input("root_vegetable_mash", 1, "st")
    .input("basil_chicken_sauce", 1, "st")
    .input("zucchini_salad", 1, "st")
    .input("lemon_wedges", 1, "st")
    .output("Basilikakyckling med rotmos och zucchinisallad")
    .step("Lägg upp {{root_vegetable_mash}} på tallrikar.")
    .step("Toppa med {{basil_chicken_sauce}}.")
    .step("Servera med {{zucchini_salad}} och {{lemon_wedges}} på sidan.")
    .duration(2)
    .tag("master")
    .build(),
];
