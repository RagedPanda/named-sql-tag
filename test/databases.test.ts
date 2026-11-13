// Runs the rendered queries against real databases: PGlite (PostgreSQL compiled to WASM, in process) for `$1`
// placeholders and node:sqlite for `?`. Nothing outside this process is touched.
import assert from 'node:assert/strict';
import {after, before, describe, test} from 'node:test';
import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {PGlite} from '@electric-sql/pglite';
import {sql, toPg, toSqlite, type Fragment, type PgQuery} from '../src/index.ts';

const injectionValues = [
	'\'; DROP TABLE users; --',
	'" OR 1=1 --',
	'\\\'; DROP TABLE users; --',
	'$1',
	'?',
	'Robert\'); DROP TABLE students;--',
	'\u0000',
] as const;

const injectionIdentifiers = [
	'users"; DROP TABLE users; --',
	'x" ("a',
	'a`b',
	'weird name',
	'$1',
	'?',
] as const;

describe('PostgreSQL (PGlite)', () => {
	let database: PGlite;
	const run = async <Row>(query: PgQuery) => (await database.query<Row>(query.text, query.values)).rows;

	before(async () => {
		database = await PGlite.create();
		await database.exec('CREATE TABLE users (id integer PRIMARY KEY, name text NOT NULL, team text)');
		await database.exec(`INSERT INTO users VALUES (1, 'Ada', 'core'), (2, 'Grace', 'core'), (3, 'Linus', 'kernel')`);
	});

	after(async () => {
		await database.close();
	});

	test('values are bound, so injection strings are stored as text', async () => {
		for (const [index, value] of injectionValues.filter(value => value !== '\u0000').entries()) {
			await run(toPg(sql`INSERT INTO users (id, name) VALUES (${100 + index}, ${value})`));
			const rows = await run<{name: string}>(toPg(sql`SELECT name FROM users WHERE id = ${100 + index}`));
			assert.deepEqual(rows, [{name: value}]);
		}

		const [count] = await run<{count: number}>(toPg(sql`SELECT count(*)::int AS count FROM users WHERE id < ${100}`));
		assert.equal(count?.count, 3);
	});

	test('identifiers with quotes and SQL in them are only names', async () => {
		for (const name of injectionIdentifiers) {
			const table = sql.id('public', name);
			await run(toPg(sql`CREATE TABLE ${table} (${sql.id(name)} text)`));
			await run(toPg(sql`INSERT INTO ${table} (${sql.id(name)}) VALUES (${name})`));
			const rows = await run<Record<string, string>>(toPg(sql`SELECT ${sql.id(name)} FROM ${table}`));
			assert.deepEqual(rows, [{[name]: name}]);
		}

		const rows = await run<{count: number}>(toPg(sql`SELECT count(*)::int AS count FROM ${sql.id('users')}`));
		assert.ok(rows[0]!.count >= 3);
	});

	test('IN lists, nested fragments and joins', async () => {
		const teams = sql`team IN ${sql.in(['core', 'nobody'])}`;
		const query = sql`SELECT name FROM users WHERE ${sql.join([teams, sql`id > ${1}`], sql` AND `)} ORDER BY id`;
		assert.deepEqual(await run(toPg(query)), [{name: 'Grace'}]);
	});

	test('a large IN list', async () => {
		const ids = Array.from({length: 1000}, (_, index) => index);
		const rows = await run<{count: number}>(toPg(sql`SELECT count(*)::int AS count FROM users WHERE id IN ${sql.in(ids)} AND id < ${100}`));
		assert.equal(rows[0]?.count, 3);
	});

	test('IN () is a syntax error, which is why sql.in([]) throws', async () => {
		await assert.rejects(database.query('SELECT 1 WHERE 1 IN ()'), /syntax error/);
	});

	test('= ANY with an array value matches nothing for an empty array', async () => {
		const byIds = (ids: number[]) => sql`SELECT name FROM users WHERE id = ANY(${ids}) ORDER BY id`;
		assert.deepEqual(await run(toPg(byIds([1, 3]))), [{name: 'Ada'}, {name: 'Linus'}]);
		assert.deepEqual(await run(toPg(byIds([]))), []);
	});

	test('a named parameter used twice is one $n with one value', async () => {
		const query = sql`SELECT name FROM users WHERE team = ${sql.param('team')} AND name <> ${sql.param('team')} AND id <= ${sql.param('max')} ORDER BY id`;
		const rendered = toPg(query, {team: 'core', max: 2});
		assert.deepEqual(rendered.values, ['core', 2]);
		assert.deepEqual(await run(rendered), [{name: 'Ada'}, {name: 'Grace'}]);
		assert.deepEqual(await run(toPg(query.bind({team: 'kernel', max: 9}))), [{name: 'Linus'}]);
	});

	test('the text and values getters work as a query config', async () => {
		const query: Fragment = sql`SELECT name FROM ${sql.id('users')} WHERE id = ${2}`;
		assert.deepEqual(await run(query), [{name: 'Grace'}]);
	});
});

describe('SQLite (node:sqlite)', () => {
	const database = new DatabaseSync(':memory:');
	const all = (query: {sql: string; values: unknown[]}) => database.prepare(query.sql).all(...(query.values as SQLInputValue[]));

	before(() => {
		database.exec('CREATE TABLE users (id integer PRIMARY KEY, name text NOT NULL, team text)');
		database.exec(`INSERT INTO users VALUES (1, 'Ada', 'core'), (2, 'Grace', 'core'), (3, 'Linus', 'kernel')`);
	});

	after(() => {
		database.close();
	});

	test('values are bound, so injection strings are stored as text', () => {
		// Older node:sqlite builds cut a bound string at a NUL byte, so it is left out here as it is for PostgreSQL.
		for (const [index, value] of injectionValues.filter(value => value !== '\u0000').entries()) {
			all(toSqlite(sql`INSERT INTO users (id, name) VALUES (${100 + index}, ${value})`));
			assert.deepEqual(all(toSqlite(sql`SELECT name FROM users WHERE id = ${100 + index}`)).map(row => ({...row})), [{name: value}]);
		}

		assert.deepEqual({...all(toSqlite(sql`SELECT count(*) AS count FROM users WHERE id < ${100}`))[0]}, {count: 3});
	});

	test('identifiers with quotes and SQL in them are only names, with double quotes and with backticks', () => {
		for (const [index, name] of injectionIdentifiers.entries()) {
			const table = sql.id('main', name);
			all(toSqlite(sql`CREATE TABLE ${table} (${sql.id(name)} text)`));
			all(toSqlite(sql`INSERT INTO ${table} (${sql.id(name)}) VALUES (${name})`));
			assert.deepEqual(all(toSqlite(sql`SELECT ${sql.id(name)} FROM ${table}`)).map(row => ({...row})), [{[name]: name}]);
			// The .sql getter quotes with backticks, which SQLite also reads as identifier quotes.
			const backtickQuery = sql`SELECT ${sql.id(name)} AS value FROM ${table} WHERE ${index} >= ${0}`;
			assert.deepEqual(all(backtickQuery).map(row => ({...row})), [{value: name}]);
		}

		assert.equal(all(toSqlite(sql`SELECT * FROM ${sql.id('users')} WHERE id < ${100}`)).length, 3);
	});

	test('IN lists, nested fragments and joins', () => {
		const teams = sql`team IN ${sql.in(['core', 'nobody'])}`;
		const query = sql`SELECT name FROM users WHERE ${sql.join([teams, sql`id > ${1}`], sql` AND `)} ORDER BY id`;
		assert.deepEqual(all(toSqlite(query)).map(row => ({...row})), [{name: 'Grace'}]);
	});

	test('a named parameter used twice repeats its value', () => {
		const query = sql`SELECT name FROM users WHERE team = ${sql.param('team')} AND name <> ${sql.param('team')} ORDER BY id`;
		const rendered = toSqlite(query, {team: 'core'});
		assert.deepEqual(rendered.values, ['core', 'core']);
		assert.deepEqual(all(rendered).map(row => ({...row})), [{name: 'Ada'}, {name: 'Grace'}]);
	});
});
