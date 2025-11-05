/**
 * Simple in-memory cache for request-scoped data.
 * The cache lives for the duration of a single request/turn and is automatically
 * garbage collected when the request completes.
 */
export class RequestCache<T> {
	private cache = new Map<string, T>();

	/**
	 * Get a value from the cache
	 */
	get(key: string): T | undefined {
		return this.cache.get(key);
	}

	/**
	 * Set a value in the cache
	 */
	set(key: string, value: T): void {
		this.cache.set(key, value);
	}

	/**
	 * Check if a key exists in the cache
	 */
	has(key: string): boolean {
		return this.cache.has(key);
	}

	/**
	 * Get the number of items in the cache
	 */
	get size(): number {
		return this.cache.size;
	}

	/**
	 * Clear all items from the cache
	 */
	clear(): void {
		this.cache.clear();
	}
}
