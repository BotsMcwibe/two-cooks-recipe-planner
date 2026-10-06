export class Ingredient {
  constructor(json, id = null) {
    this.json = json;
    this.id = id;
  }

  get name() {
    return this.json.name;
  }

  get tags() {
    return this.json.tags || [];
  }

  /** Optional path relative to src/, e.g. assets/ingredients/<id>.png */
  get image() {
    return this.json.image || null;
  }

  get primaryTag() {
    return this.tags.length > 0 ? this.tags[0] : 'other';
  }

  get category() {
    return this.primaryTag;
  }

  hasTag(tag) {
    return this.tags.includes(tag);
  }
}
