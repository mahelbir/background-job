/**
 * Throws to signal an abstract method that a subclass must override.
 * @param {string} method - Name of the method that must be implemented
 * @returns {never}
 */
export function notImplemented(method) {
    throw new Error(`${method}() must be implemented by a subclass`);
}