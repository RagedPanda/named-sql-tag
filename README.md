# named-sql-tag

A zero-dependency SQL tagged template for Node.js. Values become bound parameters, fragments nest and renumber, and on top of that you get **named parameters**, **`IN` lists** and **identifier quoting per dialect**. One query renders for:

- **pg** (node-postgres), PGlite and anything else with `$1` placeholders, as `{text, values}`;
- **better-sqlite3**, **node:sqlite** and **mysql2**, with `?` placeholders, as `{sql, values}`.

```js
import {sql, toPg} from 'named-sql-tag';

const query = sql`
	SELECT * FROM ${sql.id('public', 'posts')}
	WHERE (author = ${sql.param('user')} OR reviewer = ${sql.param('user')})
	  AND status IN ${sql.in(['draft', 'review'])}
	LIMIT ${10}`;

await client.query(toPg(query, {user: 42}));
// text:   SELECT * FROM "public"."posts" WHERE (author = $1 OR reviewer = $1) AND status IN ($2, $3) LIMIT $4
// values: [42, 'draft', 'review', 10]
```

## Why

Writing SQL by hand with string concatenation invites SQL injection, and writing `$1, $2, $3` by hand means counting placeholders and keeping a values array in the same order. Tagged templates fix both: `` SQL`... WHERE id = ${id}` `` keeps the SQL readable and sends `id` as a bound parameter.

The usual choice is [`sql-template-strings`](https://github.com/felixfbecker/node-sql-template-strings), with about 553,000 downloads a week, whose last release (2.2.2) was in September 2016. Its open issues show where it stops:

- A statement inside another is sent as a value, not composed in as a subquery ([#184](https://github.com/felixfbecker/node-sql-template-strings/issues/184), [#30](https://github.com/felixfbecker/node-sql-template-strings/issues/30)). The way to compose is `.append()`, which **changes the statement in place**, so a shared base query grows on every request ([#71](https://github.com/felixfbecker/node-sql-template-strings/issues/71), [#164](https://github.com/felixfbecker/node-sql-template-strings/issues/164), [#44](https://github.com/felixfbecker/node-sql-template-strings/issues/44)).
- An array is one value, so `IN (${list})` does not expand ([#96](https://github.com/felixfbecker/node-sql-template-strings/issues/96), [#42](https://github.com/felixfbecker/node-sql-template-strings/issues/42), [#34](https://github.com/felixfbecker/node-sql-template-strings/issues/34)).
- There is no join helper ([#32](https://github.com/felixfbecker/node-sql-template-strings/issues/32)), no safe way to put in a table or column name ([#58](https://github.com/felixfbecker/node-sql-template-strings/issues/58), [#123](https://github.com/felixfbecker/node-sql-template-strings/issues/123)) and no named parameters ([#174](https://github.com/felixfbecker/node-sql-template-strings/issues/174)).

Named parameters are something drivers will not add. node-postgres closed the request for `:name` parameters because "PostgreSQL itself does not allow for this, and I'm trying to keep this driver as close to PostgreSQL as possible", and that it "will never be added as a feature of node-postgres directly" ([brianc/node-postgres#268](https://github.com/brianc/node-postgres/issues/268)). The same thread shows why parsing `:name` out of SQL text is fragile: a maintainer points out that the suggested regex "will interfere with casts" such as `::int`. A 2026 proposal to put a `sql` tag into pg itself was closed with the view that "tightly-scoped composable packages are good practice" ([brianc/node-postgres#3745](https://github.com/brianc/node-postgres/issues/3745)).

So named-sql-tag is that small package:

- **Named parameters without parsing.** `${sql.param('user')}` marks a named value in the template; you bind it by name when you render (`toPg(query, {user: 42})`) or earlier (`query.bind({user: 42})`). Nothing scans the SQL text, so casts, strings and comments are never misread. In pg a name used twice is **one** `$n` and one value. In TypeScript the params object is checked: a missing name is a compile error.
- **Fragments compose and never change.** Nest a fragment anywhere and its values are renumbered with the outer query's; there is no `append`, and a fragment is frozen.
- **`sql.in(list)`** expands to `($1, $2, $3)`, and throws on an empty list instead of sending `IN ()`.
- **`sql.id(...)`** quotes identifiers for the dialect: `"name"` for PostgreSQL and SQLite, `` `name` `` for MySQL.
- ESM and CommonJS builds with types, no dependencies.

## Install

```sh
npm install named-sql-tag
```

It has no dependencies, not even on a database driver. It needs Node.js 22 or later; CI tests Node.js 22 and 24 on Linux, macOS and Windows.

## Usage

### Values

Every `${value}` becomes a bound parameter. Values are passed to the driver untouched, so dates, buffers, `null` and arrays work as the driver handles them.

```js
import {sql, toPg, toSqlite, toMysql} from 'named-sql-tag';

const query = sql`SELECT * FROM users WHERE email = ${email} AND active = ${true}`;

toPg(query);     // {text: 'SELECT * FROM users WHERE email = $1 AND active = $2', values: [email, true]}
toSqlite(query); // {sql: 'SELECT * FROM users WHERE email = ? AND active = ?', values: [email, true]}
toMysql(query);  // {sql: 'SELECT * FROM users WHERE email = ? AND active = ?', values: [email, true]}
```

### With each driver

```js
// pg (node-postgres): a fragment is also a query config, as with sql-template-strings
await client.query(sql`SELECT * FROM users WHERE id = ${id}`);
await client.query(toPg(query, params));
await client.query({...toPg(query, params), name: 'user-by-id'}); // a prepared statement

// PGlite
const {text, values} = toPg(query, params);
await db.query(text, values);

// node:sqlite and better-sqlite3
const {sql: text, values} = toSqlite(query, params);
db.prepare(text).all(...values);

// mysql2
const {sql: text, values} = toMysql(query, params);
await connection.execute(text, values);
```

pg, PGlite and node:sqlite are tested against real databases in this repository. better-sqlite3 and mysql2 are not (see [Good to know](#good-to-know)).

### Composing fragments

A fragment can go anywhere a value can. Its SQL is put in place and its values are renumbered. Fragments are frozen, so a base query can be shared and reused.

```js
const byName = sql`SELECT category FROM books WHERE name = ${'Dune'}`;
const query = sql`SELECT author FROM books WHERE category = (${byName}) AND year > ${1960}`;
toPg(query);
// {text: 'SELECT author FROM books WHERE category = (SELECT category FROM books WHERE name = $1) AND year > $2',
//  values: ['Dune', 1960]}
```

Optional parts use `sql.empty`:

```js
const search = (name) => sql`SELECT * FROM users${name === undefined ? sql.empty : sql` WHERE name = ${name}`}`;
```

### Joining conditions and lists

```js
const conditions = [sql`team = ${team}`, sql`age > ${18}`];
if (onlyActive) {
	conditions.push(sql`active`);
}

const query = sql`SELECT * FROM users WHERE ${sql.join(conditions, sql` AND `)}`;
// SELECT * FROM users WHERE team = $1 AND age > $2 AND active

sql`INSERT INTO tags (name, color) VALUES (${sql.join(['red', '#f00'])})`;
// INSERT INTO tags (name, color) VALUES ($1, $2)
```

The separator is a fragment (`` sql` AND ` ``), not a string, so text from a variable can never slip into the SQL through it. Plain items become parameters and fragments are composed in. `sql.join([])` is `sql.empty`.

### `IN` lists

```js
sql`SELECT * FROM users WHERE id IN ${sql.in([4, 5, 6])}`;
// SELECT * FROM users WHERE id IN ($1, $2, $3)

sql`SELECT * FROM t WHERE (a, b) IN ${sql.in([sql`(${1}, ${2})`, sql`(${3}, ${4})`])}`;
// SELECT * FROM t WHERE (a, b) IN (($1, $2), ($3, $4))
```

**An empty array throws a `RangeError`.** `IN ()` is a syntax error in PostgreSQL, and there is no placeholder list that means "no rows" in every database (`IN (NULL)` matches nothing, but `NOT IN (NULL)` matches nothing too, the opposite of what an empty `NOT IN` should do). So decide in your code:

```js
const query = ids.length === 0 ? sql`SELECT * FROM users WHERE FALSE` : sql`SELECT * FROM users WHERE id IN ${sql.in(ids)}`;
```

With PostgreSQL you can also pass the whole array as one value, which handles the empty case by itself:

```js
sql`SELECT * FROM users WHERE id = ANY(${ids})`; // one $1 holding the array; [] matches no rows
```

### Identifiers

```js
sql`SELECT ${sql.id('first name')} FROM ${sql.id('public', 'users')}`;
// toPg and toSqlite: SELECT "first name" FROM "public"."users"
// toMysql:           SELECT `first name` FROM `public`.`users`
```

Quote characters inside a name are doubled, so a name cannot close its quotes: `sql.id('users"; DROP TABLE users; --')` is one strange table name. This is tested against PostgreSQL and SQLite. Names that are empty, not strings or contain a NUL character throw a `TypeError`. A dot inside one name stays part of the name; pass the schema and the table as separate arguments.

Quoting makes an identifier safe to put in SQL, but it does not decide which tables a user may read. If a user picks a column to sort by, check it against an allowlist too.

### Named parameters

Put `${sql.param('name')}` where a value goes and bind it by name:

```js
const postsFor = sql`
	SELECT * FROM posts
	WHERE author = ${sql.param('user')} OR reviewer = ${sql.param('user')}
	LIMIT ${sql.param('limit')}`;

toPg(postsFor, {user: 42, limit: 10});
// {text: '... WHERE author = $1 OR reviewer = $1 LIMIT $2', values: [42, 10]}

toSqlite(postsFor, {user: 42, limit: 10});
// {sql: '... WHERE author = ? OR reviewer = ? LIMIT ?', values: [42, 42, 10]}
```

- With `$n` placeholders a name used twice is one placeholder and one value. With `?` placeholders the value is repeated, as `?` has no position.
- Names inside nested fragments, `sql.join` and `sql.in` count too, and the same name is the same value everywhere in the query.
- A missing name throws. Only the object's own properties count, so a parameter called `constructor` is not filled from `Object.prototype`. Extra keys are ignored.
- In TypeScript the fragment's type lists its open names, so `toPg(postsFor)` without params, or with `limit` missing, does not compile.

`query.bind(params)` returns a new fragment with some or all names filled in, and leaves the original open for reuse:

```js
const mine = postsFor.bind({user: 42}); // still needs limit
await client.query(toPg(mine, {limit: 10}));
```

A bound value becomes an ordinary value, so with pg a name used twice is then two placeholders. Pass the params to `toPg` when you want one.

Why not `:name` in the SQL text? Finding `:name` means parsing SQL: telling it apart from `::int` casts, string literals, comments, `$$` bodies and array slices like `a[1:2]`. A marker in the template has no such edge cases.

### Trusted raw SQL

`sql.raw(text)` puts text into the query as it is, with **no escaping**. It is for SQL your code writes, such as a sort direction picked from two constants. Never pass anything a user can influence.

```js
const direction = descending ? sql.raw('DESC') : sql.raw('ASC');
sql`SELECT * FROM posts ORDER BY created_at ${direction}`;
```

## Migrating from sql-template-strings

| sql-template-strings | named-sql-tag |
| --- | --- |
| `` import SQL from 'sql-template-strings' `` | `` import {sql as SQL} from 'named-sql-tag' `` |
| `` pg.query(SQL`... ${value}`) `` | the same: a fragment has `text` and `values` |
| `` mysql.query(SQL`... ${value}`) `` | the same: a fragment has `sql` and `values` |
| `` query.append(SQL` AND b = ${b}`) `` | `` query = SQL`${query} AND b = ${b}` `` |
| `query.append(' LIMIT 1')` | `` query = SQL`${query}${SQL.raw(' LIMIT 1')}` `` |
| `` IN (${list}) `` (did not expand) | `` IN ${SQL.in(list)} `` |
| a nested `` SQL`...` `` (sent as a value) | composed in as SQL |
| `query.setName('name')` | `{...toPg(query), name: 'name'}` |
| `query.useBind()` (Sequelize) | `toPg(query)` gives `$n` text and the values |

For a template with plain values, the `text`, `sql` and `values` getters return the same strings and values as sql-template-strings; [`test/migration.test.ts`](test/migration.test.ts) checks it. Two differences to look for:

- **There is no `append`**, on purpose. Code that called `query.append(...)` and ignored the result relied on it changing the query in place; an `append` that returns a new fragment would silently drop those clauses. Without the method, such code fails loudly (a type error in TypeScript, "query.append is not a function" in JavaScript) so each call site gets rewritten as `query = SQL`${query} ...``.
- **The `sql` getter quotes identifiers with backticks.** MySQL and SQLite both read backticks as identifier quotes, so the same `.sql` string works for mysql2, better-sqlite3 and node:sqlite. Use `toSqlite` if you prefer standard double quotes.

The getters throw while a named parameter has no value; bind it first with `.bind()`, or use `toPg`, `toSqlite` or `toMysql` with a params object.

## API

```ts
import {sql, toPg, toSqlite, toMysql, isFragment, type Fragment} from 'named-sql-tag';
```

### `` sql`...` ``

The tag. Returns a `Fragment`. Each `${value}` becomes a bound parameter, except a fragment (from `sql`, `sql.param`, `sql.id`, `sql.in`, `sql.join`, `sql.raw` or `sql.empty`), which is composed in. Calling `sql` as a plain function (`sql('SELECT ...')`) throws a `TypeError`.

### `sql.param(name)`

A named parameter. `name` is a non-empty string. It gets its value by name from `toPg`/`toSqlite`/`toMysql` or `fragment.bind()`.

### `sql.in(items)`

`(item, item, ...)` for `IN`. Items are values or fragments. Throws a `RangeError` for an empty array and a `TypeError` for anything that is not an array.

### `sql.id(...names)`

A quoted identifier. Several names make a dotted path: `sql.id('schema', 'table')`, `sql.id('table', 'column')`. Throws a `TypeError` for no names, an empty name, a name that is not a string, or a NUL character.

### `sql.join(items, separator?)`

Joins `items` with `separator`, a fragment that defaults to `` sql`, ` ``. Items are values or fragments. An empty list gives `sql.empty`. A separator that is not a fragment throws a `TypeError`.

### `sql.raw(text)`

**Unsafe**: `text` goes into the SQL unescaped. Throws a `TypeError` if `text` is not a string.

### `sql.empty`

A fragment with no SQL and no values.

### `toPg(fragment, params?)` &rarr; `{text, values}`

`$1, $2` placeholders and `"double quoted"` identifiers, for pg and PGlite. A named parameter used more than once is one placeholder.

### `toSqlite(fragment, params?)` &rarr; `{sql, values}`

`?` placeholders and `"double quoted"` identifiers, for node:sqlite and better-sqlite3.

### `toMysql(fragment, params?)` &rarr; `{sql, values}`

`?` placeholders and `` `backtick quoted` `` identifiers, for mysql2.

For all three, `params` is an object of named parameter values. It is required (and checked by TypeScript) when the fragment has open named parameters. A missing name throws an `Error`; passing anything that is not a fragment, such as a string, throws a `TypeError`.

### `Fragment`

The immutable result of `sql` and the helpers. `Fragment<'a' | 'b'>` has the open named parameters `a` and `b`; `Fragment` (that is, `Fragment<never>`) has none.

- `fragment.bind(params)`: a new fragment with the given names filled in. The fragment it was called on is unchanged.
- `fragment.text`, `fragment.sql`, `fragment.values`: getters for the sql-template-strings style (`$n` text, `?` text with backtick identifiers, and the values). They throw while a named parameter is open.
- `fragment.strings`, `fragment.parts`: frozen copies of the SQL pieces and the values between them, for debugging.

### `isFragment(value)`

`true` for fragments made by this library.

### Types

`Fragment<Names>`, `PgQuery` (`{text, values}`), `PlaceholderQuery` (`{sql, values}`), `Params` (`Readonly<Record<string, unknown>>`), `NamesOf<Values>`, `ParamsArgument<Names>`, `Sql` (the type of `sql`).

## Security

- Values are never written into the SQL text; they always go to the driver as bound parameters. The tests insert strings such as `'; DROP TABLE users; --`, `Robert'); DROP TABLE students;--`, `$1` and `?` into PostgreSQL (through PGlite, and through node-postgres over a socket) and SQLite, read them back unchanged and check the table is still there.
- `sql.id` doubles the dialect's quote character, and the tests create, fill and read tables and columns named `users"; DROP TABLE users; --`, `` a`b ``, `x" ("a` and others in both databases, with double quotes and with backticks in SQLite.
- `toPg` and the other renderers refuse plain strings, so `` client.query(toPg(`SELECT ${id}`)) `` (a forgotten tag) throws instead of running.
- `sql.join` takes only a fragment as its separator. `sql.raw` is the one way to put text into the SQL, and it is named and documented as unsafe.

## Benchmarks

Time to build a query and render it to `{text, values}` for pg, against the other tagged-template libraries. Each library must produce the same SQL text and values, which the script checks before timing. In the third row the others send the user id three times as `$1, $2, $3`, while named-sql-tag sends it once as `$1`.

```sh
npm run bench
```

Node.js v24.17.0 on an Apple M5 (10 cores), macOS (Darwin 27.0.0). 100,000 queries per run, median of 7 runs after 2 warmup runs. Lower is better.

| Query | named-sql-tag | sql-template-strings 2.2.2 | sql-template-tag 5.2.1 | @databases/sql 3.3.0 |
| --- | ---: | ---: | ---: | ---: |
| Simple: 2 values | 72 ns | 356 ns | 42 ns | 194 ns |
| Composed: 3 conditions, IN list of 10, ORDER BY | 796 ns | 3,982 ns | 479 ns | 1,358 ns |
| Reused value: one user id in 3 places | 299 ns | 414 ns | 55 ns | 215 ns |

named-sql-tag is faster than sql-template-strings on all three queries and faster than @databases/sql on the first two. It is slower than @databases/sql on the third, and slower than sql-template-tag on all three, which does the least work: no identifier or named-parameter handling and no frozen fragments. Every number here is below a microsecond, far below a database round trip.

## Good to know

- **Driver coverage.** The tests run queries through PGlite (PostgreSQL 17 compiled to WebAssembly), through the real `pg` driver talking to PGlite over a Unix socket, and through `node:sqlite`. better-sqlite3 and mysql2 take the same `{sql, values}` shape but are not run in the tests, and the MySQL backtick quoting is checked only as text (and through SQLite, which also reads backticks).
- **Values are not converted.** `undefined`, booleans, dates and objects go to the driver as they are, and each driver has its own rules for which types it accepts.
- **Placeholders only replace values.** You cannot use `${value}` for a table name, a keyword or a sort direction; use `sql.id`, or a fragment you choose in code.
- **The `.sql` getter uses backticks.** It suits MySQL and SQLite. PostgreSQL code should use `.text` or `toPg`.
- **No dialect detection.** You pick the renderer; the fragment does not know which database it is for.
- **Large IN lists** make one placeholder per item. Databases cap the number of parameters (65,535 in PostgreSQL), so for very large lists use `= ANY(${array})` in PostgreSQL or a temporary table.
- **No query execution, pooling or prepared-statement caching.** This package only builds `{text, values}`.

## Related

- [sql-template-strings](https://github.com/felixfbecker/node-sql-template-strings): the original. Fine for flat queries with a fixed shape; see above for where it stops.
- [sql-template-tag](https://github.com/blakeembrey/sql-template-tag): maintained, fast, with nesting, `join`, `bulk`, `raw` and `empty`. A good pick if you do not need named parameters or identifier quoting. It is ESM only, and `join([])` throws.
- [@databases/sql](https://github.com/ForbesLindesay/atdatabases/tree/master/packages/sql): nesting, `sql.ident` and `sql.join`, rendered through the `@databases/pg`, `mysql` or `sqlite` drivers or a format function you write. A good pick if you use those drivers. It has no named parameters or IN-list helper.
- [yesql](https://github.com/pihvi/yesql): named `:params` parsed out of plain SQL strings, for SQL kept in `.sql` files.
- [slonik](https://github.com/gajus/slonik) and [postgres](https://github.com/porsager/postgres): PostgreSQL clients with their own tagged templates, if you want the client too.

## Dependencies

None at runtime. The dev dependencies, and why each one is there:

| Package | Why |
| --- | --- |
| `typescript`, `@types/node` | Type checking and the ESM and CommonJS builds. |
| `@electric-sql/pglite` | A real PostgreSQL in WebAssembly, so the tests run queries without a database server. |
| `@electric-sql/pglite-socket`, `pg`, `@types/pg` | Serves PGlite on a Unix socket in a temp folder, so the tests also go through the real node-postgres driver. |
| `sql-template-strings` | The migration tests check our output matches it, and the benchmark compares against it. |
| `sql-template-tag`, `@databases/sql` | Benchmark comparisons. |

node:sqlite tests use the SQLite built into Node.js.

## License

MIT
