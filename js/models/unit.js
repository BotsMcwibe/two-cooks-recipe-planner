export class Unit {
  constructor(name, abbreviation, type = "other", baseUnit = null, conversionFactor = 1) {
    this.name = name;
    this.abbreviation = abbreviation;
    this.type = type;
    this.baseUnit = baseUnit || abbreviation;
    this.conversionFactor = conversionFactor;
  }

  toBaseUnit(amount) {
    return amount * this.conversionFactor;
  }

  fromBaseUnit(baseAmount) {
    return baseAmount / this.conversionFactor;
  }

  isCompatibleWith(otherUnit) {
    return this.type === otherUnit.type && this.baseUnit === otherUnit.baseUnit;
  }
}
