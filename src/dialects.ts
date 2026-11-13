import {Fragment, fragmentParts, fragmentStrings} from './fragment.ts';
import {mysqlDialect, pgDialect, renderParts, sqliteDialect, type Dialect, type Params} from './render.ts';

/** A query for node-postgres (`pg`), PGlite or anything else that takes `$1` placeholders. */
export type PgQuery = {text: string; values: unknown[]};

/** A query for mysql2, better-sqlite3, node:sqlite or anything else that takes `?` placeholders. */
export type PlaceholderQuery = {sql: string; values: unknown[]};

/** The params argument: optional when the fragment has no open named parameters, required and checked when it has. */
export type ParamsArgument<Names extends string> = [Names] extends [never] ? [params?: Params] : [params: Readonly<Record<Names, unknown>>];

const renderFragment = (fragment: unknown, params: Params | undefined, dialect: Dialect) => {
	if (!(fragment instanceof Fragment)) {
		throw new TypeError(`Expected a fragment made with sql\`...\`, got ${typeof fragment}. A plain string is refused, so values cannot be pasted into the SQL text by mistake.`);
	}

	return renderParts(fragmentStrings(fragment), fragmentParts(fragment), params, dialect);
};

/** Renders a fragment with `$1, $2` placeholders and `"double quoted"` identifiers. A named parameter used twice is one placeholder. */
export const toPg = <Names extends string>(fragment: Fragment<Names>, ...params: ParamsArgument<Names>): PgQuery => {
	const {query, values} = renderFragment(fragment, params[0], pgDialect);
	return {text: query, values};
};

/** Renders a fragment with `?` placeholders and `"double quoted"` identifiers, for better-sqlite3 and node:sqlite. */
export const toSqlite = <Names extends string>(fragment: Fragment<Names>, ...params: ParamsArgument<Names>): PlaceholderQuery => {
	const {query, values} = renderFragment(fragment, params[0], sqliteDialect);
	return {sql: query, values};
};

/** Renders a fragment with `?` placeholders and `` `backtick quoted` `` identifiers, for mysql2 and mysql. */
export const toMysql = <Names extends string>(fragment: Fragment<Names>, ...params: ParamsArgument<Names>): PlaceholderQuery => {
	const {query, values} = renderFragment(fragment, params[0], mysqlDialect);
	return {sql: query, values};
};
