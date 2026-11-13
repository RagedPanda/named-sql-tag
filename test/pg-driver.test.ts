// Sends queries through the real node-postgres driver to PGlite, served on a Unix socket in a temporary folder.
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import pg from 'pg';
import {sql, toPg} from '../src/index.ts';

const folder = mkdtempSync(join(tmpdir(), 'named-sql-tag-'));
let database: PGlite;
let server: PGLiteSocketServer;
let client: pg.Client;

before(async () => {
	database = await PGlite.create();
	server = new PGLiteSocketServer({db: database, path: join(folder, '.s.PGSQL.5432')});
	await server.start();
	client = new pg.Client({host: folder, port: 5432, user: 'postgres', database: 'postgres'});
	await client.connect();
	await client.query('CREATE TABLE books (id integer PRIMARY KEY, name text, author text)');
	await client.query(`INSERT INTO books VALUES (1, 'Dune', 'Herbert'), (2, 'Emma', 'Austen'), (3, 'Persuasion', 'Austen')`);
});

after(async () => {
	await client.end();
	await server.stop();
	await database.close();
	rmSync(folder, {recursive: true, force: true});
});

test('pg takes a fragment directly, like an sql-template-strings statement', async () => {
	const result = await client.query<{name: string}>(sql`SELECT name FROM books WHERE author = ${'Austen'} ORDER BY id`);
	assert.deepEqual(result.rows, [{name: 'Emma'}, {name: 'Persuasion'}]);
});

test('pg takes toPg output, with a named statement spread in', async () => {
	const query = sql`SELECT name FROM ${sql.id('books')} WHERE id IN ${sql.in([1, 3])} AND author = ${sql.param('author')} ORDER BY id`;
	const result = await client.query<{name: string}>({...toPg(query, {author: 'Austen'}), name: 'books-by-author'});
	assert.deepEqual(result.rows, [{name: 'Persuasion'}]);
});

test('an injection string in a value is only data', async () => {
	const name = '\'; DROP TABLE books; --';
	await client.query(sql`INSERT INTO books (id, name) VALUES (${4}, ${name})`);
	const result = await client.query<{name: string}>(sql`SELECT name FROM books WHERE id = ${4}`);
	assert.deepEqual(result.rows, [{name}]);
});
