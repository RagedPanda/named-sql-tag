import {Param} from './parts.ts';
import {pgDialect, questionMarkDialect, renderParts, type Params} from './render.ts';

/**
 * The key of a fragment's contents. It is a module-private symbol and an own property, not a `#private` field, because
 * node-postgres copies a query config's own properties onto a new object with the same prototype before reading `text`.
 */
const contents = Symbol('named-sql-tag fragment contents');

type Contents = {
	/** The SQL text around the parts. Always one longer than `parts`. */
	readonly strings: readonly string[];
	/** Values, `Param`s and `Identifier`s, in order. Nested fragments are already flattened in. */
	readonly parts: readonly unknown[];
};

/**
 * An immutable piece of SQL: the text around each value, and the values, named parameters and identifiers between them.
 * `Names` lists the named parameters that still need a value, so TypeScript can check the params object.
 *
 * The fragment is frozen and its arrays are kept under a module-private symbol, so no public property can change
 * them, without the cost of freezing two arrays for every fragment.
 */
export class Fragment<Names extends string = never> {
	/** Type-only marker that carries `Names`; it never exists at runtime. */
	declare readonly paramNames?: Names;
	readonly [contents]: Contents;

	/** @internal Use the `sql` tag. The arrays must not be used again by the caller. */
	constructor(strings: readonly string[], parts: readonly unknown[]) {
		this[contents] = {strings, parts};
		Object.freeze(this);
	}

	/** A frozen copy of the SQL text around the parts, for debugging. Always one longer than `parts`. */
	get strings(): readonly string[] {
		return Object.freeze([...this[contents].strings]);
	}

	/** A frozen copy of the values, named parameters and identifiers, in order, for debugging. */
	get parts(): readonly unknown[] {
		return Object.freeze([...this[contents].parts]);
	}

	/** The query with `$1, $2` placeholders, for node-postgres. Throws while a named parameter has no value. */
	get text(): string {
		return renderParts(this[contents].strings, this[contents].parts, undefined, pgDialect).query;
	}

	/** The query with `?` placeholders and backtick-quoted identifiers, for mysql2, better-sqlite3 and node:sqlite. Throws while a named parameter has no value. */
	get sql(): string {
		return renderParts(this[contents].strings, this[contents].parts, undefined, questionMarkDialect).query;
	}

	/** The values for `text` or `sql`, in order. Throws while a named parameter has no value. */
	get values(): unknown[] {
		return renderParts(this[contents].strings, this[contents].parts, undefined, questionMarkDialect).values;
	}

	/**
	 * A new fragment with the named parameters in `params` replaced by their values. Names not in `params` stay open,
	 * and this fragment is left unchanged. Once a value is bound it is an ordinary value, so with pg a name used twice
	 * becomes two placeholders; pass the params to `toPg` instead to keep one.
	 */
	bind<const Bound extends Partial<Record<Names, unknown>>>(params: Bound): Fragment<Exclude<Names, keyof Bound>> {
		const bindPart = (part: unknown): unknown => (part instanceof Param && Object.hasOwn(params, part.name) ? (params as Params)[part.name] : part);
		return new Fragment(this[contents].strings, this[contents].parts.map(bindPart));
	}
}

/** A fragment's text pieces, for this library's own functions. */
export const fragmentStrings = (fragment: Fragment<string>): readonly string[] => fragment[contents].strings;

/** A fragment's parts, for this library's own functions. */
export const fragmentParts = (fragment: Fragment<string>): readonly unknown[] => fragment[contents].parts;

/** True for fragments made by this library. */
export const isFragment = (value: unknown): value is Fragment<string> => value instanceof Fragment;

/** The named parameters a template value brings in. `any` brings none, so untyped values do not demand a params object. */
type NamesOfValue<Value> = 0 extends 1 & Value ? never : Value extends Param<infer Name> ? Name : Value extends Fragment<infer Name> ? Name : never;

/** The named parameters that a list of template values brings in. */
export type NamesOf<Values extends readonly unknown[]> = NamesOfValue<Values[number]>;

/**
 * Builds a fragment from template strings and values, flattening nested fragments into it so their values are
 * renumbered with the outer query's. Local arrays only; the inputs are never changed.
 */
export const createFragment = (rawStrings: readonly string[], rawValues: readonly unknown[]): Fragment<string> => {
	const strings: string[] = [];
	const parts: unknown[] = [];
	let current = rawStrings[0]!;
	for (let index = 0; index < rawValues.length; index++) {
		const value = rawValues[index];
		if (value instanceof Fragment) {
			const childStrings = fragmentStrings(value);
			const childParts = fragmentParts(value);
			current += childStrings[0];
			for (let childIndex = 0; childIndex < childParts.length; childIndex++) {
				strings.push(current);
				parts.push(childParts[childIndex]);
				current = childStrings[childIndex + 1]!;
			}
		} else {
			strings.push(current);
			parts.push(value);
			current = '';
		}

		current += rawStrings[index + 1]!;
	}

	strings.push(current);
	return new Fragment(strings, parts);
};
