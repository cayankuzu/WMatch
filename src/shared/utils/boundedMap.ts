export class BoundedMap<K, V> {
  private readonly values = new Map<K, V>();

  constructor(private readonly maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('BoundedMap maxEntries must be a positive integer.');
    }
  }

  get size() {
    return this.values.size;
  }

  get(key: K) {
    const value = this.values.get(key);
    if (value === undefined) {
      return undefined;
    }

    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    this.values.delete(key);
    this.values.set(key, value);

    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.values.delete(oldestKey);
    }

    return this;
  }

  has(key: K) {
    return this.values.has(key);
  }

  delete(key: K) {
    return this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}
