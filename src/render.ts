import {Identifier, Param} from './parts.ts';

/** Named parameter values, looked up by name. Only own properties count, so `toString` or `constructor` are never picked up from the prototype. */
export type Params = Readonly<Record<string, unknown>>;

/** How one database writes placeholders and quotes identifiers. */
export type Dialect = {
	/** The placeholder for the value at a 1-based position in `values`. */
	readonly placeholder: (position: number) => string;
	/** Wraps one identifier in quotes, doubling any quote inside it. */
	readonly quote: (name: string) => string;
	/** Whether a named parameter used twice refers to one value (`$1` twice) instead of being repeated in `values`. */
	readonly reusesPositions: boolean;
};

export const doubleQuote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
export const backtickQuote = (name: string): string => `\`${name.replaceAll('`', '``')}\``;

export const pgDialect: Dialect = {placeholder: position => `$${position}`, quote: doubleQuote, reusesPositions: true};
export const sqliteDialect: Dialect = {placeholder: () => '?', quote: doubleQuote, reusesPositions: false};
export const mysqlDialect: Dialect = {placeholder: () => '?', quote: backtickQuote, reusesPositions: false};
/** For the `.sql` getter: MySQL and SQLite both read backtick-quoted identifiers, so one string works for both. */
export const questionMarkDialect: Dialect = mysqlDialect;

export type Rendered = {readonly query: string; readonly values: unknown[]};

export const missingParamError = (name: string): Error => new Error(`Missing a value for the named parameter "${name}". Pass it in the params object, for example {${JSON.stringify(name)}: value}.`);

const lookUp = (params: Params | undefined, name: string): unknown => {
	if (params === undefined || !Object.hasOwn(params, name)) {
		throw missingParamError(name);
	}

	return params[name];
};

/**
 * Builds the query text and the values array for a dialect.
 * The work happens in one pass over the parts, with local state only; the inputs are never changed.
 */
export const renderParts = (strings: readonly string[], parts: readonly unknown[], params: Params | undefined, dialect: Dialect): Rendered => {
	const values: unknown[] = [];
	// Created on the first named parameter, as most queries have none.
	let positions: Map<string, number> | undefined;
	let query = strings[0]!;
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		let text: string;
		if (part instanceof Identifier) {
			text = part.names.map(dialect.quote).join('.');
		} else if (part instanceof Param) {
			positions ??= new Map();
			const known = dialect.reusesPositions ? positions.get(part.name) : undefined;
			if (known === undefined) {
				values.push(lookUp(params, part.name));
				positions.set(part.name, values.length);
				text = dialect.placeholder(values.length);
			} else {
				text = dialect.placeholder(known);
			}
		} else {
			values.push(part);
			text = dialect.placeholder(values.length);
		}

		query += text + strings[index + 1]!;
	}

	return {query, values};
};
