import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isFragment, sql, toMysql, toPg, toSqlite, type Fragment} from '../src/index.ts';
import {Identifier, Param} from '../src/parts.ts';

test('values become placeholders in each dialect', () => {
	const query = sql`SELECT * FROM users WHERE id = ${1} AND name = ${'Ada'}`;
	assert.deepEqual(toPg(query), {text: 'SELECT * FROM users WHERE id = $1 AND name = $2', values: [1, 'Ada']});
	assert.deepEqual(toSqlite(query), {sql: 'SELECT * FROM users WHERE id = ? AND name = ?', values: [1, 'Ada']});
	assert.deepEqual(toMysql(query), {sql: 'SELECT * FROM users WHERE id = ? AND name = ?', values: [1, 'Ada']});
});

test('a query with no values renders as its text', () => {
	assert.deepEqual(toPg(sql`SELECT 1`), {text: 'SELECT 1', values: []});
});

test('values are passed through untouched, objects and arrays included', () => {
	const date = new Date(0);
	const list = [1, 2];
	const {values} = toPg(sql`${null} ${undefined} ${date} ${list} ${{a: 1}}`);
	assert.equal(values[0], null);
	assert.equal(values[1], undefined);
	assert.equal(values[2], date);
	assert.equal(values[3], list);
	assert.deepEqual(values[4], {a: 1});
});

test('nested fragments compose and renumber', () => {
	const inner = sql`SELECT category FROM books WHERE name = ${'harry potter'}`;
	const query = sql`SELECT author FROM books WHERE id = ${1} AND category = (${inner}) AND author = ${'Rowling'}`;
	assert.deepEqual(toPg(query), {
		text: 'SELECT author FROM books WHERE id = $1 AND category = (SELECT category FROM books WHERE name = $2) AND author = $3',
		values: [1, 'harry potter', 'Rowling'],
	});
});

test('fragments nest several levels deep and can be reused', () => {
	const leaf = sql`x = ${1}`;
	const middle = sql`(${leaf} OR ${leaf})`;
	const query = sql`${middle} AND ${middle} AND ${sql`y = ${2}`}`;
	assert.equal(toPg(query).text, '(x = $1 OR x = $2) AND (x = $3 OR x = $4) AND y = $5');
	assert.deepEqual(toPg(query).values, [1, 1, 1, 1, 2]);
});

test('a fragment at the very start or end of the template keeps its text', () => {
	const query = sql`${sql`SELECT ${1}`} UNION ${sql`SELECT ${2}`}`;
	assert.equal(toPg(query).text, 'SELECT $1 UNION SELECT $2');
});

test('sql.empty adds nothing', () => {
	const query = sql`SELECT * FROM t${sql.empty} WHERE a = ${1}${sql.empty}`;
	assert.deepEqual(toPg(query), {text: 'SELECT * FROM t WHERE a = $1', values: [1]});
	assert.deepEqual(toPg(sql.empty), {text: '', values: []});
});

test('optional clauses with sql.empty', () => {
	const search = (name: string | undefined) => sql`SELECT * FROM users${name === undefined ? sql.empty : sql` WHERE name = ${name}`}`;
	assert.equal(toPg(search(undefined)).text, 'SELECT * FROM users');
	assert.equal(toPg(search('Ada')).text, 'SELECT * FROM users WHERE name = $1');
});

test('sql.raw inserts trusted text as it is', () => {
	const direction = sql.raw('DESC');
	assert.deepEqual(toPg(sql`SELECT * FROM t ORDER BY a ${direction} LIMIT ${5}`), {text: 'SELECT * FROM t ORDER BY a DESC LIMIT $1', values: [5]});
	assert.throws(() => sql.raw(5 as unknown as string), {name: 'TypeError', message: /needs a string, got number/});
});

test('sql.join uses ", " by default and composes fragments', () => {
	assert.deepEqual(toPg(sql`VALUES (${sql.join([1, 2, 3])})`), {text: 'VALUES ($1, $2, $3)', values: [1, 2, 3]});
	const conditions = [sql`a = ${1}`, sql`b = ${2}`, sql`c IS NULL`];
	assert.deepEqual(toPg(sql`WHERE ${sql.join(conditions, sql` AND `)}`), {text: 'WHERE a = $1 AND b = $2 AND c IS NULL', values: [1, 2]});
});

test('sql.join with one item has no separator, with none it is empty', () => {
	assert.equal(toPg(sql.join([sql`a = ${1}`], sql` AND `)).text, 'a = $1');
	assert.deepEqual(toPg(sql.join([], sql` AND `)), {text: '', values: []});
});

test('sql.join separators can carry values', () => {
	assert.deepEqual(toPg(sql.join([1, 2], sql` || ${'-'} || `)), {text: '$1 || $2 || $3', values: [1, '-', 2]});
});

test('sql.join refuses a string separator', () => {
	assert.throws(() => sql.join([1, 2], ' AND ' as unknown as Fragment), {name: 'TypeError', message: /separator/});
});

test('sql.in makes a parenthesized list', () => {
	assert.deepEqual(toPg(sql`WHERE id IN ${sql.in([4, 5, 6])}`), {text: 'WHERE id IN ($1, $2, $3)', values: [4, 5, 6]});
	assert.deepEqual(toSqlite(sql`WHERE id IN ${sql.in(['a'])}`), {sql: 'WHERE id IN (?)', values: ['a']});
	assert.deepEqual(toPg(sql`WHERE (a, b) IN ${sql.in([sql`(${1}, ${2})`, sql`(${3}, ${4})`])}`), {text: 'WHERE (a, b) IN (($1, $2), ($3, $4))', values: [1, 2, 3, 4]});
});

test('sql.in refuses an empty array and anything that is not an array', () => {
	assert.throws(() => sql.in([]), {name: 'RangeError', message: /empty array/});
	assert.throws(() => sql.in('abc' as unknown as string[]), {name: 'TypeError', message: /needs an array, got string/});
});

test('sql.id quotes identifiers for each dialect', () => {
	const query = sql`SELECT ${sql.id('first name')} FROM ${sql.id('public', 'users')}`;
	assert.equal(toPg(query).text, 'SELECT "first name" FROM "public"."users"');
	assert.equal(toSqlite(query).sql, 'SELECT "first name" FROM "public"."users"');
	assert.equal(toMysql(query).sql, 'SELECT `first name` FROM `public`.`users`');
	assert.deepEqual(toPg(query).values, []);
});

test('sql.id doubles quote characters, so a name cannot close the quotes', () => {
	const query = sql`SELECT * FROM ${sql.id('a"b`c')}`;
	assert.equal(toPg(query).text, 'SELECT * FROM "a""b`c"');
	assert.equal(toMysql(query).sql, 'SELECT * FROM `a"b``c`');
});

test('sql.id keeps dots inside one name', () => {
	assert.equal(toPg(sql`${sql.id('a.b')}`).text, '"a.b"');
});

test('sql.id refuses empty, non-string and NUL names', () => {
	assert.throws(() => sql.id(), {name: 'TypeError', message: /at least one name/});
	assert.throws(() => sql.id(''), {name: 'TypeError', message: /non-empty/});
	assert.throws(() => sql.id('public', ''), {name: 'TypeError', message: /non-empty/});
	assert.throws(() => sql.id(1 as unknown as string), {name: 'TypeError', message: /string names, got number/});
	assert.throws(() => sql.id('a\0b'), {name: 'TypeError', message: /NUL/});
});

test('named parameters bind by name and reuse one pg placeholder', () => {
	const query = sql`SELECT * FROM posts WHERE author = ${sql.param('user')} OR reviewer = ${sql.param('user')} LIMIT ${10}`;
	assert.deepEqual(toPg(query, {user: 7}), {text: 'SELECT * FROM posts WHERE author = $1 OR reviewer = $1 LIMIT $2', values: [7, 10]});
	assert.deepEqual(toSqlite(query, {user: 7}), {sql: 'SELECT * FROM posts WHERE author = ? OR reviewer = ? LIMIT ?', values: [7, 7, 10]});
	assert.deepEqual(toMysql(query, {user: 7}), {sql: 'SELECT * FROM posts WHERE author = ? OR reviewer = ? LIMIT ?', values: [7, 7, 10]});
});

test('named parameters inside nested fragments share their position', () => {
	const owned = sql`owner = ${sql.param('user')}`;
	const query = sql`${sql.param('limit')} ${owned} OR ${sql`editor = ${sql.param('user')}`}`;
	assert.deepEqual(toPg(query, {user: 'u', limit: 3}), {text: '$1 owner = $2 OR editor = $2', values: [3, 'u']});
});

test('a named parameter can hold null, undefined or an array', () => {
	assert.deepEqual(toPg(sql`${sql.param('a')} ${sql.param('b')} ${sql.param('c')}`, {a: null, b: undefined, c: [1]}).values, [null, undefined, [1]]);
});

test('a missing named parameter throws, and inherited properties do not count', () => {
	const query = sql`SELECT ${sql.param('constructor')}`;
	assert.throws(() => toPg(query as never, {} as never), {message: /Missing a value for the named parameter "constructor"/});
	assert.throws(() => (toSqlite as (fragment: unknown) => unknown)(query), {message: /"constructor"/});
	assert.deepEqual(toPg(query, {constructor: 1}).values, [1]);
});

test('extra keys in the params object are ignored', () => {
	assert.deepEqual(toPg(sql`${sql.param('a')}`, {a: 1, b: 2} as {a: number}).values, [1]);
});

test('sql.param refuses empty and non-string names', () => {
	assert.throws(() => sql.param(''), {name: 'TypeError', message: /non-empty/});
	assert.throws(() => sql.param(1 as unknown as string), {name: 'TypeError', message: /string name, got number/});
});

test('bind returns a new fragment and leaves the original open', () => {
	const query = sql`a = ${sql.param('a')} AND b = ${sql.param('b')} AND a2 = ${sql.param('a')}`;
	const halfBound = query.bind({a: 1});
	assert.deepEqual(toPg(halfBound, {b: 2}), {text: 'a = $1 AND b = $2 AND a2 = $3', values: [1, 2, 1]});
	const bound = halfBound.bind({b: 2});
	assert.equal(bound.text, 'a = $1 AND b = $2 AND a2 = $3');
	assert.deepEqual(bound.values, [1, 2, 1]);
	assert.throws(() => query.text, {message: /"a"/});
	assert.deepEqual(toPg(query, {a: 1, b: 2}).values, [1, 2]);
});

test('bind leaves values and identifiers alone', () => {
	const query = sql`${sql.id('t')} ${5} ${sql.param('x')}`.bind({x: 'y'});
	assert.equal(toPg(query).text, '"t" $1 $2');
	assert.deepEqual(toPg(query).values, [5, 'y']);
});

test('getters render pg text, and ? text with backtick identifiers', () => {
	const query = sql`SELECT * FROM ${sql.id('users')} WHERE id = ${1} AND name = ${'Ada'}`;
	assert.equal(query.text, 'SELECT * FROM "users" WHERE id = $1 AND name = $2');
	assert.equal(query.sql, 'SELECT * FROM `users` WHERE id = ? AND name = ?');
	assert.deepEqual(query.values, [1, 'Ada']);
});

test('fragments, their arrays and the tag are frozen', () => {
	const query = sql`a = ${1}`;
	assert.ok(Object.isFrozen(query));
	assert.ok(Object.isFrozen(query.strings));
	assert.ok(Object.isFrozen(query.parts));
	assert.ok(Object.isFrozen(sql));
	assert.throws(() => {
		(query.parts as unknown[]).push(2);
	}, TypeError);
	assert.deepEqual(query.strings, ['a = ', '']);
	assert.deepEqual(query.parts, [1]);
	assert.notEqual(query.parts, query.parts);
});

test('composing never changes the fragments it is made from', () => {
	const base = sql`SELECT * FROM books`;
	const first = sql`${base} WHERE id = ${1}`;
	const second = sql`${base} WHERE id = ${2}`;
	assert.equal(toPg(base).text, 'SELECT * FROM books');
	assert.deepEqual(toPg(first), {text: 'SELECT * FROM books WHERE id = $1', values: [1]});
	assert.deepEqual(toPg(second), {text: 'SELECT * FROM books WHERE id = $1', values: [2]});
});

test('the tag refuses to be called as a function', () => {
	const tag = sql as unknown as (...args: unknown[]) => unknown;
	assert.throws(() => tag('SELECT 1'), {name: 'TypeError', message: /template tag/});
	assert.throws(() => tag(['SELECT 1']), {name: 'TypeError', message: /template tag/});
});

test('renderers refuse strings and other objects', () => {
	for (const render of [toPg, toSqlite, toMysql]) {
		assert.throws(() => render('SELECT 1' as unknown as Fragment), {name: 'TypeError', message: /plain string is refused/});
		assert.throws(() => render({text: 'x', values: []} as unknown as Fragment), {name: 'TypeError', message: /got object/});
	}
});

test('isFragment and the part classes', () => {
	assert.equal(isFragment(sql`x`), true);
	assert.equal(isFragment({strings: [], parts: []}), false);
	assert.ok(sql.param('p').parts[0] instanceof Param);
	assert.ok(sql.id('p').parts[0] instanceof Identifier);
	assert.ok(Object.isFrozen(sql.id('a', 'b').parts[0]));
});
