/** A named placeholder made with `sql.param(name)`. It gets its value by name when the query is rendered or bound. */
export class Param<Name extends string = string> {
	readonly name: Name;

	constructor(name: Name) {
		this.name = name;
		Object.freeze(this);
	}
}

/** A table, column or other name made with `sql.id(...)`, quoted for the dialect when the query is rendered. */
export class Identifier {
	readonly names: readonly string[];

	constructor(names: readonly string[]) {
		this.names = Object.freeze([...names]);
		Object.freeze(this);
	}
}

/** Why a name cannot be a parameter name, or undefined when it can. */
export const paramNameProblem = (name: unknown): string | undefined => {
	if (typeof name !== 'string') {
		return `sql.param() needs a string name, got ${typeof name}`;
	}

	return name === '' ? 'sql.param() needs a non-empty name' : undefined;
};

/**
 * Why a name cannot be quoted as an identifier, or undefined when it can.
 * A NUL character is rejected because no database accepts it in an identifier and quoting cannot make it safe.
 */
export const identifierProblem = (name: unknown): string | undefined => {
	if (typeof name !== 'string') {
		return `sql.id() needs string names, got ${typeof name}`;
	}

	if (name === '') {
		return 'sql.id() needs non-empty names';
	}

	return name.includes('\0') ? 'sql.id() names cannot contain a NUL character' : undefined;
};
