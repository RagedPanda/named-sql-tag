import {createFragment, Fragment, type NamesOf} from './fragment.ts';
import {Identifier, identifierProblem, Param, paramNameProblem} from './parts.ts';

const isTemplateStrings = (strings: unknown): strings is TemplateStringsArray => Array.isArray(strings) && Object.hasOwn(strings, 'raw');

/**
 * The tag: every `${value}` becomes a bound parameter, and every nested fragment, `sql.param()`, `sql.id()` or
 * `sql.in()` is composed in.
 */
const tag = <const Values extends readonly unknown[]>(strings: TemplateStringsArray, ...values: Values): Fragment<NamesOf<Values>> => {
	if (!isTemplateStrings(strings)) {
		throw new TypeError('sql must be used as a template tag: sql`SELECT ...`, not sql(...). For trusted SQL text, use sql.raw().');
	}

	return createFragment(strings, values) as Fragment<NamesOf<Values>>;
};

/** A fragment with no SQL and no values, for optional parts of a query. */
const empty: Fragment = createFragment([''], []) as Fragment;

const comma: Fragment = createFragment([', '], []) as Fragment;

/**
 * Joins items with a separator fragment (`, ` by default). Fragments are composed in and anything else becomes a
 * bound parameter. An empty list gives `sql.empty`.
 */
const join = <const Items extends readonly unknown[], SeparatorNames extends string = never>(items: Items, separator: Fragment<SeparatorNames> = comma): Fragment<NamesOf<Items> | SeparatorNames> => {
	if (!(separator instanceof Fragment)) {
		throw new TypeError('sql.join() needs a fragment as its separator, such as sql` AND `, so text from a variable is never pasted into the SQL.');
	}

	const values: unknown[] = items.length === 0 ? [] : [items[0]];
	for (let index = 1; index < items.length; index++) {
		values.push(separator, items[index]);
	}

	const strings = new Array<string>(values.length + 1).fill('');
	return createFragment(strings, values) as Fragment<NamesOf<Items> | SeparatorNames>;
};

/**
 * A parenthesized list for `IN`: `(?, ?, ?)`. An empty list throws, because `IN ()` is a syntax error in PostgreSQL
 * and no list of placeholders means "no rows" in every database. Handle the empty case in your code.
 */
const inList = <const Items extends readonly unknown[]>(items: Items): Fragment<NamesOf<Items>> => {
	if (!Array.isArray(items)) {
		throw new TypeError(`sql.in() needs an array, got ${typeof items}`);
	}

	if (items.length === 0) {
		throw new RangeError('sql.in() got an empty array. "IN ()" is a syntax error in PostgreSQL, so check for an empty list first, for example: ids.length === 0 ? sql`FALSE` : sql`id IN ${sql.in(ids)}`');
	}

	return createFragment(['(', ')'], [join(items)]) as Fragment<NamesOf<Items>>;
};

/** A quoted identifier. Several names make a dotted path: `sql.id('public', 'users')` is `"public"."users"`. */
const id = (...names: readonly string[]): Fragment => {
	if (names.length === 0) {
		throw new TypeError('sql.id() needs at least one name');
	}

	const problem = names.map(identifierProblem).find(found => found !== undefined);
	if (problem !== undefined) {
		throw new TypeError(problem);
	}

	return createFragment(['', ''], [new Identifier(names)]) as Fragment;
};

/** A named parameter, bound later by name with `toPg(query, {name: value})` or `query.bind({name: value})`. */
const param = <const Name extends string>(name: Name): Fragment<Name> => {
	const problem = paramNameProblem(name);
	if (problem !== undefined) {
		throw new TypeError(problem);
	}

	return createFragment(['', ''], [new Param(name)]) as Fragment<Name>;
};

/** UNSAFE: puts the text into the SQL as it is, with no escaping. Never pass anything a user can influence. */
const raw = (text: string): Fragment => {
	if (typeof text !== 'string') {
		throw new TypeError(`sql.raw() needs a string, got ${typeof text}`);
	}

	return createFragment([text], []) as Fragment;
};

/** The `sql` tag with its helpers. */
export type Sql = typeof tag & {
	readonly in: typeof inList;
	readonly id: typeof id;
	readonly param: typeof param;
	readonly join: typeof join;
	readonly raw: typeof raw;
	readonly empty: Fragment;
};

export const sql: Sql = Object.freeze(Object.assign(tag, {in: inList, id, param, join, raw, empty}));
