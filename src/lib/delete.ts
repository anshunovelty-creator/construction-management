/** Typed names are compared loosely: spaces at the ends and capitals do not matter. */
export const sameName = (typed: string, name: string) => typed.trim().toLowerCase() === name.trim().toLowerCase();

/** Setup lists where a delete asks for the record's name to be typed first. Firms are never deleted. */
export const TYPE_TO_DELETE = new Set(['sites', 'parties', 'workers', 'money-accounts']);
