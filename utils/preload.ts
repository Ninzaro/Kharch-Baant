/**
 * Fire-and-forget dynamic import to warm a lazy chunk before it is needed.
 * Call on onPointerEnter of trigger buttons so the module is cached by the
 * time the user clicks.
 *
 * @example
 *   <button onPointerEnter={() => preloadComponent(() => import('./components/TransactionFormModal'))}>
 *     Add Expense
 *   </button>
 */
export const preloadComponent = (factory: () => Promise<unknown>): void => {
    factory();
};
